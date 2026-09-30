import { randomUUID } from "node:crypto";
import { ObjectId, type ClientSession, type MongoClient } from "mongodb";
import type { Collections } from "../../infrastructure/mongodb/collections.js";
import type { AppConfig } from "../../config/env.js";
import { assertBalanced, formatMoney } from "../ledger/money.js";
import { ensureTreasuryAccount } from "../wallets/service.js";
import { recordSecurityEvent } from "../security/audit.js";
import { accruedMinorFor, pickRateUnits, rateToString, totalAccrualMinor } from "./rate.js";
import { conflict, notFound, serviceUnavailable } from "../../shared/errors.js";
import { LEDGER_BALANCE_MAX_MINOR } from "../../shared/types.js";
import type {
  LedgerAccountRecord,
  MiningEffectiveStatus,
  MiningSessionRecord,
  MiningSessionStatus,
  MiningSettlementRecord,
  PublicMiningSession,
  PublicMiningState,
  WalletRecord,
} from "../../shared/types.js";

/**
 * Mining use-cases: start, read state, settle, and list history.
 *
 * Mining is a persisted cycle plus a pure function of the clock — there is no timer, no job, and no
 * in-memory session anywhere in this module. A cycle's reward is always recomputed from its stored
 * rate and window against the server's current time, so the same account sees the same cycle from
 * every device, a process restart loses nothing, and any number of API processes read the same
 * state. Settlement is the only write, and it is a compare-and-set on the cycle plus a balanced
 * ledger transaction, which makes it idempotent under duplicate, concurrent, and replayed requests.
 */

/** A compare-and-set refused because another settlement won the race; the caller re-reads and retries. */
class ConcurrentSettlementError extends Error {
  constructor() {
    super("Another mining settlement committed first");
    this.name = "ConcurrentSettlementError";
  }
}

const MAX_SETTLE_ATTEMPTS = 4;
const RETRY_BACKOFF_BASE_MS = 20;

/** Retryable driver/server codes, mirroring the transfer service's conservative fallback set. */
const TRANSIENT_ERROR_CODES = new Set([6, 7, 63, 64, 89, 91, 134, 189, 197, 216, 226, 241, 251, 256, 261, 262, 276, 286, 9001]);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function hasErrorLabel(error: unknown, label: string): boolean {
  if (typeof error !== "object" || error === null) return false;
  const labels = (error as { errorLabels?: unknown }).errorLabels;
  return Array.isArray(labels) && labels.includes(label);
}

function isTransientTransactionError(error: unknown): boolean {
  if (hasErrorLabel(error, "TransientTransactionError")) return true;
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "number" && TRANSIENT_ERROR_CODES.has(code);
}

function isDuplicateKeyError(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === 11000;
}

export interface MiningSettlementInput {
  collections: Collections;
  mongoClient: MongoClient;
  config: Pick<AppConfig, "mining">;
  session: MiningSessionRecord;
  wallet: WalletRecord;
  walletAccount: LedgerAccountRecord;
  correlationId: string;
}

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
function loadActiveSession(collections: Collections, ownerUserId: string): Promise<MiningSessionRecord | null> {
  return collections.miningSessions.findOne({ ownerUserId, status: "active" });
}

function loadLatestSession(collections: Collections, ownerUserId: string): Promise<MiningSessionRecord | null> {
  // Ordered by creation, not by cycle number: the same order, because cycles are created one at a
  // time, and served by `mining_sessions_owner_history` instead of an in-memory sort.
  return collections.miningSessions.findOne({ ownerUserId }, { sort: { createdAt: -1, publicId: -1 } });
}

async function loadWalletAndAccount(collections: Collections, ownerUserId: string): Promise<{ wallet: WalletRecord; walletAccount: LedgerAccountRecord }> {
  const wallet = await collections.wallets.findOne({ ownerUserId });
  if (!wallet) throw notFound();
  const walletAccount = await collections.ledgerAccounts.findOne({ walletId: wallet.publicId, accountType: "wallet", currency: "LMA" });
  // A wallet without its ledger account is a data-integrity fault, not a zero balance.
  if (!walletAccount) throw new Error(`Wallet ${wallet.publicId} has no LMA ledger account`);
  return { wallet, walletAccount };
}

function stateFromRecord(record: MiningSessionRecord | null, nowMs: number, enabled: boolean, cycleDurationSeconds: number): PublicMiningState {
  const session = record ? toPublicSession(record, nowMs) : null;
  const status: MiningEffectiveStatus = session?.status ?? "idle";
  return {
    status,
    serverNow: new Date(nowMs).toISOString(),
    enabled,
    // A new cycle may start whenever the account has no running one. An expired-but-unsettled cycle
    // is `completed`, and `start` settles it before opening the next, so nothing is stranded.
    canStart: enabled && status !== "active",
    cycleDurationSeconds,
    session,
  };
}

/** Reads the authoritative mining state for one account. Two indexed reads on the common path. */
export async function getMiningState(input: {
  collections: Collections;
  config: Pick<AppConfig, "mining">;
  ownerUserId: string;
}): Promise<PublicMiningState> {
  const nowMs = Date.now();
  if (!input.config.mining.enabled) {
    return stateFromRecord(null, nowMs, false, input.config.mining.cycleDurationSeconds);
  }
  // One read in the running case. Only an idle account pays for the second, to show its last cycle.
  const active = await loadActiveSession(input.collections, input.ownerUserId);
  const record = active ?? (await loadLatestSession(input.collections, input.ownerUserId));
  return stateFromRecord(record, nowMs, true, input.config.mining.cycleDurationSeconds);
}

/**
 * Opens a new mining cycle for the account.
 *
 * The window and the rate are chosen here, on the server, and are never accepted from the caller:
 * `startedAt` is the server clock, `endsAt` is exactly one configured cycle later, and the rate is a
 * cryptographically drawn integer inside the configured band. A running cycle blocks a second one —
 * through the unique index as much as through the check — and an expired-but-unsettled cycle is
 * settled first so its reward is never stranded and the one-active slot is freed.
 */
export async function startMining(input: {
  collections: Collections;
  mongoClient: MongoClient;
  config: Pick<AppConfig, "mining">;
  ownerUserId: string;
  correlationId: string;
}): Promise<PublicMiningState> {
  const { collections, config } = input;
  if (!config.mining.enabled) {
    throw serviceUnavailable("mining_disabled", "Mining is temporarily unavailable.");
  }

  const { wallet, walletAccount } = await loadWalletAndAccount(collections, input.ownerUserId);

  const active = await loadActiveSession(collections, input.ownerUserId);
  if (active) {
    if (Date.now() < active.endsAt.getTime()) {
      await recordSecurityEvent({
        collections,
        ownerUserId: input.ownerUserId,
        sessionId: null,
        eventType: "mining_rejected",
        outcome: "failure",
        correlationId: input.correlationId,
        metadata: { reason: "cycle_active", sessionId: active.publicId },
      }).catch(() => undefined);
      throw conflict("mining_cycle_active", "A mining cycle is already running for this account.");
    }
    // The window closed: close the cycle out before opening the next one. Closing it means paying it,
    // so a paused settlement is refused outright rather than left as an open cycle that would strand
    // its reward and then collide with the one-cycle index.
    if (!config.mining.settlementEnabled) {
      throw serviceUnavailable("mining_settlement_disabled", "Mining settlement is temporarily paused; the finished cycle must be closed before a new one can start.");
    }
    await settleSession({ collections, mongoClient: input.mongoClient, config, session: active, wallet, walletAccount, correlationId: input.correlationId });
  }

  const previous = await collections.miningSessions.findOne(
    { ownerUserId: input.ownerUserId },
    { sort: { createdAt: -1, publicId: -1 }, projection: { publicId: 1, cycleNumber: 1 } },
  );

  const now = new Date();
  const startedAtMs = now.getTime();
  const rateUnits = pickRateUnits(config.mining.rate);
  const session: Omit<MiningSessionRecord, "_id"> = {
    publicId: randomUUID(),
    ownerUserId: input.ownerUserId,
    walletId: wallet.publicId,
    ledgerAccountId: walletAccount.publicId,
    status: "active",
    cycleNumber: (previous?.cycleNumber ?? 0) + 1,
    startedAt: now,
    endsAt: new Date(startedAtMs + config.mining.cycleDurationSeconds * 1000),
    durationSeconds: config.mining.cycleDurationSeconds,
    rateUnits,
    rateScale: config.mining.rate.scale,
    rateDecimals: config.mining.rate.decimals,
    rate: rateToString(rateUnits, config.mining.rate.scale, config.mining.rate.decimals),
    rateUnit: "LMA/hour",
    settledMinor: 0,
    settlementSequence: 0,
    lastSettledAt: null,
    createdAt: now,
    updatedAt: now,
  };

  try {
    await collections.miningSessions.insertOne({ _id: new ObjectId(), ...session } as MiningSessionRecord);
  } catch (error) {
    // A concurrent start won the one-active index. That is the API working as designed: converge on
    // the cycle that exists rather than surfacing a duplicate-key fault to the customer.
    if (isDuplicateKeyError(error)) return getMiningState({ collections, config, ownerUserId: input.ownerUserId });
    throw error;
  }

  await recordSecurityEvent({
    collections,
    ownerUserId: input.ownerUserId,
    sessionId: null,
    eventType: "mining_started",
    outcome: "success",
    correlationId: input.correlationId,
    metadata: { sessionId: session.publicId, cycleNumber: session.cycleNumber, rate: session.rate, endsAt: session.endsAt.toISOString() },
  });

  return getMiningState({ collections, config, ownerUserId: input.ownerUserId });
}

/**
 * Posts whatever a cycle has accrued since its last settlement, if anything.
 *
 * Settlement is a compare-and-set: the update only lands while `settledMinor` still holds the value
 * this attempt read, and only while the cycle is still `active`. Two devices settling together
 * therefore produce exactly one transaction — the loser's update matches nothing, it re-reads, sees
 * the reward already posted, and returns. Because the amount is derived from the stored rate and
 * clamped to the window, even an unbounded number of retries can never credit more than the 24-hour
 * accrual.
 */
async function settleSession(input: MiningSettlementInput): Promise<{ postedMinor: number; session: MiningSessionRecord }> {
  const { collections, config } = input;
  if (!config.mining.settlementEnabled) return { postedMinor: 0, session: input.session };

  let current = input.session;
  for (let attempt = 1; attempt <= MAX_SETTLE_ATTEMPTS; attempt += 1) {
    const now = new Date();
    const nowMs = now.getTime();
    const window = {
      startedAtMs: current.startedAt.getTime(),
      endsAtMs: current.endsAt.getTime(),
      durationSeconds: current.durationSeconds,
    };
    const accrued = accruedMinorFor({ rateUnits: current.rateUnits, rateScale: current.rateScale, ...window, nowMs });
    const expired = nowMs >= window.endsAtMs;

    if (accrued <= current.settledMinor) {
      // Nothing new to post. If the window closed, still close the cycle so a fresh one can start.
      if (expired && current.status !== "settled") {
        const closed = await collections.miningSessions.updateOne(
          { _id: current._id, status: "active", settledMinor: current.settledMinor },
          { $set: { status: "settled", updatedAt: now } },
        );
        if (closed.modifiedCount === 1) {
          await recordSecurityEvent({
            collections,
            ownerUserId: current.ownerUserId,
            sessionId: null,
            eventType: "mining_completed",
            outcome: "success",
            correlationId: input.correlationId,
            metadata: { sessionId: current.publicId, settledMinor: current.settledMinor },
          }).catch(() => undefined);
        }
      }
      return { postedMinor: 0, session: current };
    }

    const delta = accrued - current.settledMinor;
    const nextSequence = current.settlementSequence + 1;
    const settlementPublicId = randomUUID();
    const idempotencyKey = `mining:${current.publicId}:${nextSequence}`;
    const nextStatus: MiningSessionStatus = expired ? "settled" : "active";

    const treasuryAccountId = await ensureTreasuryAccount(collections);
    const treasury = await collections.ledgerAccounts.findOne({ publicId: treasuryAccountId, accountType: "system_treasury", currency: "LMA" });
    if (!treasury) throw new Error("System treasury ledger account is missing");

    const mongoSession: ClientSession = input.mongoClient.startSession();
    try {
      await mongoSession.withTransaction(
        async () => {
          // The compare-and-set: identical concurrent attempts cannot both see this succeed.
          const cas = await collections.miningSessions.updateOne(
            { _id: current._id, ownerUserId: current.ownerUserId, status: "active", settledMinor: current.settledMinor },
            { $inc: { settledMinor: delta, settlementSequence: 1 }, $set: { lastSettledAt: now, updatedAt: now, status: nextStatus } },
            { session: mongoSession },
          );
          if (cas.modifiedCount !== 1) throw new ConcurrentSettlementError();

          // Issuance is balanced: the treasury's asset side is debited, the wallet's is credited, so
          // the ledger stays balanced and the treasury projection never goes negative.
          const walletCredit = await collections.ledgerAccounts.updateOne(
            { _id: input.walletAccount._id, accountType: "wallet", balanceMinor: { $lte: LEDGER_BALANCE_MAX_MINOR - delta } },
            { $inc: { balanceMinor: delta } },
            { session: mongoSession },
          );
          if (walletCredit.modifiedCount !== 1) throw new Error("The mining reward would exceed the wallet's LMA ceiling");

          const treasuryDebit = await collections.ledgerAccounts.updateOne(
            { _id: treasury._id, accountType: "system_treasury" },
            { $inc: { balanceMinor: delta } },
            { session: mongoSession },
          );
          if (treasuryDebit.modifiedCount !== 1) throw new Error("Failed to debit the system treasury for a mining reward");

          const lines = [
            { ledgerAccountId: treasury.publicId, walletId: null, side: "debit" as const, amountMinor: delta },
            { ledgerAccountId: input.walletAccount.publicId, walletId: input.wallet.publicId, side: "credit" as const, amountMinor: delta },
          ];
          assertBalanced(lines);
          await collections.ledgerEntries.insertMany(
            lines.map((line, index) => ({
              publicId: randomUUID(),
              transactionId: settlementPublicId,
              lineNumber: index + 1,
              walletId: line.walletId,
              ledgerAccountId: line.ledgerAccountId,
              side: line.side,
              amountMinor: line.amountMinor,
              currency: "LMA" as const,
              correlationId: input.correlationId,
              createdAt: now,
            })) as never,
            { session: mongoSession, ordered: true },
          );

          const settlement: Omit<MiningSettlementRecord, "_id"> = {
            publicId: settlementPublicId,
            ownerUserId: current.ownerUserId,
            walletId: current.walletId,
            sessionPublicId: current.publicId,
            sequenceNumber: nextSequence,
            amountMinor: delta,
            treasuryAccountId: treasury.publicId,
            walletAccountId: input.walletAccount.publicId,
            correlationId: input.correlationId,
            idempotencyKey,
            createdAt: now,
          };
          await collections.miningSettlements.insertOne({ _id: new ObjectId(), ...settlement } as MiningSettlementRecord, { session: mongoSession });

          // The journal header, so every ledger line resolves to a transaction the way reconciliation
          // requires. It is typed `mining` and carries no sender/receiver, so it can never surface in
          // a customer's transfer history.
          await collections.transactions.insertOne(
            {
              _id: new ObjectId(),
              publicId: settlementPublicId,
              type: "mining",
              currency: "LMA",
              status: "completed",
              ownerUserId: current.ownerUserId,
              walletId: current.walletId,
              miningSessionId: current.publicId,
              sequenceNumber: nextSequence,
              amountMinor: delta,
              treasuryAccountId: treasury.publicId,
              idempotencyKey,
              correlationId: input.correlationId,
              createdAt: now,
              completedAt: now,
            } as never,
            { session: mongoSession },
          );

          await recordSecurityEvent({
            collections,
            ownerUserId: current.ownerUserId,
            sessionId: null,
            eventType: expired ? "mining_completed" : "mining_settled",
            outcome: "success",
            correlationId: input.correlationId,
            metadata: { sessionId: current.publicId, amountMinor: delta, sequenceNumber: nextSequence },
            mongoSession,
          });
        },
        { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" } },
      );

      const updated = await collections.miningSessions.findOne({ _id: current._id });
      return { postedMinor: delta, session: updated ?? current };
    } catch (error) {
      // A lost race, a transient fault, or an ambiguous commit all mean the same thing here: re-read
      // the cycle and decide again. The compare-and-set makes re-deciding safe — a reward already
      // posted is never posted twice.
      if (error instanceof ConcurrentSettlementError || isDuplicateKeyError(error) || isTransientTransactionError(error)) {
        const reloaded = await collections.miningSessions.findOne({ _id: current._id });
        if (!reloaded) return { postedMinor: 0, session: current };
        current = reloaded;
        if (attempt < MAX_SETTLE_ATTEMPTS) {
          await sleep(RETRY_BACKOFF_BASE_MS * 2 ** (attempt - 1));
          continue;
        }
        return { postedMinor: 0, session: current };
      }
      throw error;
    } finally {
      await mongoSession.endSession();
    }
  }

  return { postedMinor: 0, session: current };
}

/** Explicit settlement for the account's running cycle. Idempotent: nothing to post means no write. */
export async function settleMining(input: {
  collections: Collections;
  mongoClient: MongoClient;
  config: Pick<AppConfig, "mining">;
  ownerUserId: string;
  correlationId: string;
}): Promise<PublicMiningState> {
  const { collections, config } = input;
  if (!config.mining.enabled) {
    throw serviceUnavailable("mining_disabled", "Mining is temporarily unavailable.");
  }
  if (!config.mining.settlementEnabled) {
    throw serviceUnavailable("mining_settlement_disabled", "Mining settlement is temporarily paused.");
  }
  const active = await loadActiveSession(collections, input.ownerUserId);
  if (active) {
    const { wallet, walletAccount } = await loadWalletAndAccount(collections, input.ownerUserId);
    await settleSession({ collections, mongoClient: input.mongoClient, config, session: active, wallet, walletAccount, correlationId: input.correlationId });
  }
  return getMiningState({ collections, config, ownerUserId: input.ownerUserId });
}

/**
 * Settles the account's running cycle as a side effect of another financial operation.
 *
 * A transfer spends the wallet's balance, and the balance only reflects mining once a settlement has
 * posted it. The caller supplies the wallet and its account it has already resolved, so this costs
 * one indexed read of the cycle on the common path and opens a transaction only when there is
 * something to post.
 */
export async function settleMiningForOwner(input: {
  collections: Collections;
  mongoClient: MongoClient;
  config: Pick<AppConfig, "mining">;
  ownerUserId: string;
  wallet: WalletRecord;
  walletAccount: LedgerAccountRecord;
  correlationId: string;
}): Promise<{ postedMinor: number }> {
  const { collections, config } = input;
  if (!config.mining.enabled || !config.mining.settlementEnabled) return { postedMinor: 0 };

  const active = await loadActiveSession(collections, input.ownerUserId);
  if (!active) return { postedMinor: 0 };

  const nowMs = Date.now();
  const accrued = accruedMinorFor({
    rateUnits: active.rateUnits,
    rateScale: active.rateScale,
    startedAtMs: active.startedAt.getTime(),
    endsAtMs: active.endsAt.getTime(),
    durationSeconds: active.durationSeconds,
    nowMs,
  });
  const closedButUnmarked = nowMs >= active.endsAt.getTime() && active.status !== "settled";
  if (accrued <= active.settledMinor && !closedButUnmarked) return { postedMinor: 0 };

  const result = await settleSession({
    collections,
    mongoClient: input.mongoClient,
    config,
    session: active,
    wallet: input.wallet,
    walletAccount: input.walletAccount,
    correlationId: input.correlationId,
  });
  return { postedMinor: result.postedMinor };
}

const MAX_PAGE_SIZE = 50;

/** One page of the account's cycles, newest first, cursor-paged on (createdAt, publicId). */
export async function listMiningHistory(input: {
  collections: Collections;
  config: Pick<AppConfig, "mining">;
  ownerUserId: string;
  cursor: string | undefined;
  limit: number | undefined;
}): Promise<{ sessions: PublicMiningSession[]; nextCursor: string | null }> {
  const limit = Math.min(Math.max(input.limit ?? 20, 1), MAX_PAGE_SIZE);
  const filter: Record<string, unknown> = { ownerUserId: input.ownerUserId };
  if (input.cursor) {
    const cursor = await input.collections.miningSessions.findOne(
      { publicId: input.cursor, ownerUserId: input.ownerUserId },
      { projection: { createdAt: 1, publicId: 1 } },
    );
    if (!cursor) throw notFound();
    filter["$and"] = [
      { ownerUserId: input.ownerUserId },
      { $or: [{ createdAt: { $lt: cursor.createdAt } }, { createdAt: cursor.createdAt, publicId: { $lt: cursor.publicId } }] },
    ];
  }
  const sessions = await input.collections.miningSessions
    .find(filter)
    .sort({ createdAt: -1, publicId: -1 })
    .limit(limit + 1)
    .toArray();
  const hasMore = sessions.length > limit;
  const page = sessions.slice(0, limit);
  const nowMs = Date.now();
  return {
    sessions: page.map((record) => toPublicSession(record, nowMs)),
    nextCursor: hasMore ? (page.at(-1)?.publicId ?? null) : null,
  };
}
