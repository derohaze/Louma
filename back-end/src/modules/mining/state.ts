import type { Collections } from "../../infrastructure/mongodb/collections.js";
import type { AppConfig } from "../../config/env.js";
import { formatMoney } from "../ledger/money.js";
import { accruedMinorFor, totalAccrualMinor } from "./rate.js";
import { loadMiningSettings } from "./settings.js";
import { loadDeviceQuota } from "./quota-store.js";
import {
  MINING_DAILY_QUOTA_SECONDS,
  MINING_QUOTA_WINDOW_MS,
  MINING_QUOTA_WINDOW_SECONDS,
  accountConsumedSeconds,
  accountWindowStartOf,
  currentAccountWindowStart,
  remainingSeconds,
} from "./quota.js";
import type { CacheContext } from "../../infrastructure/redis/cache.js";
import { notFound } from "../../shared/errors.js";
// One definition of "holds a room": the live-hold predicate lives with the membership it reads.
import { loadPoolId } from "./pools.js";
import type {
  LedgerAccountRecord,
  MiningEffectiveStatus,
  MiningQuotaView,
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
  const window = { startedAtMs, endsAtMs, durationSeconds: Math.max(0, record.durationSeconds) };
  const rate = { rateUnits: record.rateUnits, rateScale: record.rateScale };

  // A zero-length segment (stop in the same second as start) accrues nothing;
  // the rate math requires a positive duration, so short-circuit instead.
  const accruedMinor = window.durationSeconds <= 0 ? 0 : accruedMinorFor({ ...rate, ...window, nowMs });
  const totalAccruedMinor = window.durationSeconds <= 0 ? 0 : totalAccrualMinor(rate, window);
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
    progress: record.durationSeconds <= 0 ? 1 : Math.min(1, elapsedSeconds / record.durationSeconds),
    canSettle: accruedMinor > record.settledMinor,
    lastSettledAt: record.lastSettledAt?.toISOString() ?? null,
    // Filled by the history reader, which loads each cycle's posted payouts in one batch; the live
    // state path has no page of settlements to attach.
    settlements: [],
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

export async function loadWalletAndAccount(
  collections: Collections,
  ownerUserId: string,
  walletId?: string,
  walletAccountId?: string,
): Promise<{ wallet: WalletRecord; walletAccount: LedgerAccountRecord }> {
  const wallet = await collections.wallets.findOne(walletId ? { ownerUserId, publicId: walletId } : { ownerUserId, isPrimary: true });
  if (!wallet) throw notFound();
  const walletAccount = await collections.ledgerAccounts.findOne({
    walletId: wallet.publicId,
    ...(walletAccountId ? { publicId: walletAccountId } : {}),
    accountType: "wallet",
    currency: "LMA",
  });
  // A wallet without its ledger account is a data-integrity fault, not a zero balance.
  if (!walletAccount) throw new Error(`Wallet ${wallet.publicId} has no LMA ledger account`);
  if (walletAccountId && walletAccount.publicId !== walletAccountId) throw new Error(`Mining session ledger account does not match wallet ${wallet.publicId}`);
  return { wallet, walletAccount };
}

/**
 * Server-computed account quota for `stateFromRecord` when the caller already
 * summed the window. Pure and exported for testing: `windowSessions` are the
 * account's segments whose effective window is the current one.
 */
export function quotaFromSessions(
  windowSessions: MiningSessionRecord[],
  windowStartMs: number | null,
  nowMs: number,
): MiningQuotaView {
  if (windowStartMs === null) {
    return {
      dailyQuotaSeconds: MINING_DAILY_QUOTA_SECONDS,
      windowSeconds: MINING_QUOTA_WINDOW_SECONDS,
      consumedSeconds: 0,
      remainingSeconds: MINING_DAILY_QUOTA_SECONDS,
      windowEndsAt: null,
    };
  }
  const consumed = accountConsumedSeconds(windowSessions, windowStartMs, nowMs);
  return {
    dailyQuotaSeconds: MINING_DAILY_QUOTA_SECONDS,
    windowSeconds: MINING_QUOTA_WINDOW_SECONDS,
    consumedSeconds: consumed,
    remainingSeconds: remainingSeconds(consumed),
    windowEndsAt: new Date(windowStartMs + MINING_QUOTA_WINDOW_MS).toISOString(),
  };
}

/** Projects a stored cycle (or its absence) into the customer-facing state. Exported for testing. */
export function stateFromRecord(
  record: MiningSessionRecord | null,
  nowMs: number,
  enabled: boolean,
  settlementEnabled: boolean,
  cycleDurationSeconds: number,
  poolId: string | null = null,
  poolRequired = false,
  quota: MiningQuotaView | null = null,
): PublicMiningState {
  const session = record ? toPublicSession(record, nowMs) : null;
  // Capability flags mirror what the write paths will actually accept: settlement refuses while
  // paused, and a start past an expired-but-unsettled cycle needs a settlement first.
  if (session) session.canSettle = enabled && settlementEnabled && session.canSettle;
  const status: MiningEffectiveStatus = session?.status ?? "idle";
  const needsClose = status === "completed";
  const quotaView: MiningQuotaView = quota ?? {
    dailyQuotaSeconds: MINING_DAILY_QUOTA_SECONDS,
    windowSeconds: MINING_QUOTA_WINDOW_SECONDS,
    // Without a window sum the caller could not prove exhaustion, so default to
    // full quota: writes re-check authoritatively and refuse when exhausted.
    consumedSeconds: 0,
    remainingSeconds: MINING_DAILY_QUOTA_SECONDS,
    windowEndsAt: record ? new Date(accountWindowStartOf(record) + MINING_QUOTA_WINDOW_MS).toISOString() : null,
  };
  const quotaExhausted = quotaView.remainingSeconds <= 0;
  return {
    status,
    serverNow: new Date(nowMs).toISOString(),
    enabled,
    // A new segment may start whenever the account has no running one, holds pool
    // membership, and still owns quota in its 24h window. An expired-but-unsettled
    // segment is `completed`, and `start` settles it before opening the next, so
    // nothing is stranded — which is why a `completed` state additionally requires
    // settlement to be enabled.
    canStart: enabled && !poolRequired && !quotaExhausted && status !== "active" && (settlementEnabled || !needsClose),
    cycleDurationSeconds,
    session,
    poolId,
    poolRequired,
    quota: quotaView,
  };
}

/**
 * Reads the authoritative mining state for one account. Two indexed reads on the common path.
 *
 * With `cache`, the pool membership goes through cache-aside: it changes only via join/leave,
 * which invalidate eagerly, so the TTL only bounds a lost-invalidation race. The cycle itself is
 * never cached — settlement and start decisions always read the stored row.
 */
/**
 * Loads the account's segments inside its current quota window for the state
 * view. Membership is by stored anchor (see `loadAccountQuota`), plus the
 * legacy `startedAt` fallback for pre-quota rows; a window holds at most a
 * handful of stop/resume segments, never history.
 */
export async function loadAccountWindowSessions(
  collections: Collections,
  ownerUserId: string,
  windowStartMs: number,
): Promise<MiningSessionRecord[]> {
  const windowStart = new Date(windowStartMs);
  const [anchored, legacy] = await Promise.all([
    collections.miningSessions.find({ ownerUserId, accountWindowStart: windowStart }).toArray(),
    collections.miningSessions
      .find({
        ownerUserId,
        accountWindowStart: { $exists: false },
        startedAt: { $gte: windowStart, $lt: new Date(windowStartMs + MINING_QUOTA_WINDOW_MS) },
      })
      .toArray(),
  ]);
  return [...anchored, ...legacy];
}

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
  // Server-side quota: current anchor from the newest segment, consumed as the
  // actual-mining sum in-window. No client value participates.
  let quota: MiningQuotaView;
  if (!record) {
    quota = quotaFromSessions([], null, nowMs);
  } else {
    const latestWindowMs = accountWindowStartOf(record);
    const current = currentAccountWindowStart(latestWindowMs, nowMs);
    if (current.isNewWindow) {
      quota = quotaFromSessions([], current.windowStartMs, nowMs);
      // A fresh window has no segments yet; still report its anchor so `canStart`
      // reflects the reset instead of the previous window's exhaustion.
      quota.windowEndsAt = new Date(current.windowStartMs + MINING_QUOTA_WINDOW_MS).toISOString();
    } else {
      // A failed window sum is a failed read, never an empty window: swallowing it here would
      // report zero consumption and a full 10 hours remaining, i.e. `canStart: true` for an
      // account that has already used its quota. The neighbouring reads in this function are
      // not caught either, so a database that cannot answer this one has already failed the
      // request above; letting it surface keeps the state honest instead of inventing one.
      const windowSessions = await loadAccountWindowSessions(input.collections, input.ownerUserId, current.windowStartMs);
      quota = quotaFromSessions(windowSessions, current.windowStartMs, nowMs);
    }
  }
  if (record?.deviceQuotaKey) {
    const deviceQuota = await loadDeviceQuota(input.collections, record.deviceQuotaKey, nowMs);
    if (deviceQuota.remainingSeconds < quota.remainingSeconds) {
      quota = {
        ...quota,
        consumedSeconds: deviceQuota.consumedSeconds,
        remainingSeconds: deviceQuota.remainingSeconds,
        windowEndsAt: new Date(deviceQuota.windowStartMs + MINING_QUOTA_WINDOW_MS).toISOString(),
      };
    }
  }
  return stateFromRecord(record, nowMs, live.mining.enabled, live.mining.settlementEnabled, live.mining.cycleDurationSeconds, poolId, poolId === null, quota);
}
