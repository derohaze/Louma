import type { Collections } from "../../infrastructure/mongodb/collections.js";
import type { AppConfig } from "../../config/env.js";
import { formatMoney } from "../ledger/money.js";
import { accruedMinorFor, totalAccrualMinor } from "./rate.js";
import { loadMiningSettings } from "./settings.js";
import { poolMembershipKey, readThrough, type CacheContext } from "../../infrastructure/redis/cache.js";
import { notFound } from "../../shared/errors.js";
import type {
  LedgerAccountRecord,
  MiningEffectiveStatus,
  MiningSessionRecord,
  PublicMiningSession,
  PublicMiningState,
  WalletRecord,
} from "../../shared/types.js";

/**
 * The effective lifecycle the customer sees, derived from what is stored and the server clock.
 *
 * A persisted `active` cycle whose window has passed is `completed`, not `active`: the transition is
 * a fact about time, not something a scheduled write has to record. `settled` is stored, because it
 * is the outcome of a write (the reward reached the ledger) rather than of the clock.
 */
function effectiveStatus(record: MiningSessionRecord, nowMs: number): MiningEffectiveStatus {
  if (record.status === "settled") return "settled";
  return nowMs >= record.endsAt.getTime() ? "completed" : "active";
}

/** Projects a stored cycle into the authoritative state the API returns. Exported for testing. */
export function toPublicSession(record: MiningSessionRecord, nowMs: number): PublicMiningSession {
  const startedAtMs = record.startedAt.getTime();
  const endsAtMs = record.endsAt.getTime();
  const window = { startedAtMs, endsAtMs, durationSeconds: record.durationSeconds };
  const rate = { rateUnits: record.rateUnits, rateScale: record.rateScale };

  const accruedMinor = accruedMinorFor({ ...rate, ...window, nowMs });
  const totalAccruedMinor = totalAccrualMinor(rate, window);
  const elapsedSeconds = Math.max(
    0,
    Math.min(Math.floor((Math.min(nowMs, endsAtMs) - startedAtMs) / 1000), record.durationSeconds),
  );

  return {
    id: record.publicId,
    poolId: record.poolId ?? null,
    status: effectiveStatus(record, nowMs),
    cycleNumber: record.cycleNumber,
    startedAt: record.startedAt.toISOString(),
    endsAt: record.endsAt.toISOString(),
    durationSeconds: record.durationSeconds,
    rate: record.rate,
    rateUnit: record.rateUnit,
    rateUnits: record.rateUnits,
    rateScale: record.rateScale,
    serverNow: new Date(nowMs).toISOString(),
    elapsedSeconds,
    remainingSeconds: Math.max(0, record.durationSeconds - elapsedSeconds),
    accruedMinor,
    accrued: formatMoney(accruedMinor),
    settledMinor: record.settledMinor,
    settled: formatMoney(record.settledMinor),
    totalAccruedMinor,
    totalAccrued: formatMoney(totalAccruedMinor),
    progress: Math.min(1, elapsedSeconds / record.durationSeconds),
    canSettle: accruedMinor > record.settledMinor,
    lastSettledAt: record.lastSettledAt?.toISOString() ?? null,
  };
}

/** The one open cycle for an account, if there is one. Served by `mining_sessions_one_active_per_user`. */
export function loadActiveSession(collections: Collections, ownerUserId: string): Promise<MiningSessionRecord | null> {
  return collections.miningSessions.findOne({ ownerUserId, status: "active" });
}

function loadLatestSession(collections: Collections, ownerUserId: string): Promise<MiningSessionRecord | null> {
  // Ordered by creation, not by cycle number: the same order, because cycles are created one at a
  // time, and served by `mining_sessions_owner_history` instead of an in-memory sort.
  return collections.miningSessions.findOne({ ownerUserId }, { sort: { createdAt: -1, publicId: -1 } });
}

export async function loadWalletAndAccount(collections: Collections, ownerUserId: string): Promise<{ wallet: WalletRecord; walletAccount: LedgerAccountRecord }> {
  const wallet = await collections.wallets.findOne({ ownerUserId });
  if (!wallet) throw notFound();
  const walletAccount = await collections.ledgerAccounts.findOne({ walletId: wallet.publicId, accountType: "wallet", currency: "LMA" });
  // A wallet without its ledger account is a data-integrity fault, not a zero balance.
  if (!walletAccount) throw new Error(`Wallet ${wallet.publicId} has no LMA ledger account`);
  return { wallet, walletAccount };
}

/** Projects a stored cycle (or its absence) into the customer-facing state. Exported for testing. */
export function stateFromRecord(record: MiningSessionRecord | null, nowMs: number, enabled: boolean, settlementEnabled: boolean, cycleDurationSeconds: number, poolId: string | null = null, poolRequired = false): PublicMiningState {
  const session = record ? toPublicSession(record, nowMs) : null;
  // Capability flags mirror what the write paths will actually accept: settlement refuses while
  // paused, and a start past an expired-but-unsettled cycle needs a settlement first.
  if (session) session.canSettle = enabled && settlementEnabled && session.canSettle;
  const status: MiningEffectiveStatus = session?.status ?? "idle";
  const needsClose = status === "completed";
  return {
    status,
    serverNow: new Date(nowMs).toISOString(),
    enabled,
    // A new cycle may start whenever the account has no running one — and only from inside a
    // pool. An expired-but-unsettled cycle is `completed`, and `start` settles it before opening
    // the next, so nothing is stranded — which is why a `completed` state additionally requires
    // settlement to be enabled.
    canStart: enabled && !poolRequired && status !== "active" && (settlementEnabled || !needsClose),
    cycleDurationSeconds,
    session,
    poolId,
    poolRequired,
  };
}

/**
 * Reads the authoritative mining state for one account. Two indexed reads on the common path.
 *
 * With `cache`, the pool membership goes through cache-aside: it changes only via join/leave,
 * which invalidate eagerly, so the TTL only bounds a lost-invalidation race. The cycle itself is
 * never cached — settlement and start decisions always read the stored row.
 */
export async function getMiningState(input: {
  collections: Collections;
  config: Pick<AppConfig, "mining" | "miningPools">;
  ownerUserId: string;
  cache?: CacheContext | undefined;
  membershipCache?: CacheContext | undefined;
}): Promise<PublicMiningState> {
  const nowMs = Date.now();
  // Reads stay available while mining is disabled: an account with an accrued-but-unsettled reward
  // must still see its cycle. Disabling stops writes (start/settle refuse), never visibility.
  // One read in the running case. Only an idle account pays for the second, to show its last cycle.
  // Live values: stored `mining_settings` keys win, the env-derived config stays the default.
  const live = await loadMiningSettings(input.collections, input.config, input.cache);
  const active = await loadActiveSession(input.collections, input.ownerUserId);
  const record = active ?? (await loadLatestSession(input.collections, input.ownerUserId));
  const poolId = await loadPoolId(input.collections, input.ownerUserId, input.membershipCache);
  return stateFromRecord(record, nowMs, live.mining.enabled, live.mining.settlementEnabled, live.mining.cycleDurationSeconds, poolId, poolId === null);
}

/** One account's pool room, cached: join/leave are the only writers and invalidate eagerly. */
export async function loadPoolId(
  collections: Collections,
  ownerUserId: string,
  cache?: CacheContext | undefined,
): Promise<string | null> {
  if (!cache) {
    const membership = await collections.miningPoolMembers.findOne({ ownerUserId });
    return (membership?.poolId as string | undefined) ?? null;
  }
  const read = await readThrough({
    redis: cache.redis,
    key: poolMembershipKey(cache.redis, ownerUserId),
    ttlSeconds: cache.ttlSeconds,
    load: () => collections.miningPoolMembers.findOne({ ownerUserId }, { projection: { poolId: 1 } }),
  });
  const poolId = (read.value as { poolId?: unknown } | null)?.poolId;
  return typeof poolId === "string" ? poolId : null;
}
