import { randomUUID } from "node:crypto";
import { type ClientSession, type MongoClient } from "mongodb";
import type { Collections } from "../../infrastructure/mongodb/collections.js";
import type { AppConfig } from "../../config/env.js";
import { postBalancedJournal } from "../../infrastructure/mongodb/repositories.js";
import type { CacheContext } from "../../infrastructure/redis/cache.js";
import { ensureTreasuryAccount } from "../wallets/service.js";
import { recordSecurityEvent } from "../security/audit.js";
import { readFinancialControls } from "../financial-controls/service.js";
import { accruedMinorFor } from "./rate.js";
import { loadMiningSettings } from "./settings.js";
import { serviceUnavailable } from "../../shared/errors.js";
import { LEDGER_BALANCE_MAX_MINOR } from "../../shared/types.js";
import {
  RETRY_BACKOFF_BASE_MS,
  isDuplicateKeyError,
  isTransientTransactionError,
  sleep,
} from "../../shared/mongo-retry.js";
import { getMiningState, loadActiveSession, loadWalletAndAccount } from "./state.js";
import type {
  LedgerAccountRecord,
  MiningSessionRecord,
  MiningSessionStatus,
  MiningTransactionRecord,
  PublicMiningState,
  WalletRecord,
} from "../../shared/types.js";

/** A compare-and-set refused because another settlement won the race; the caller re-reads and retries. */
class ConcurrentSettlementError extends Error {
  constructor() {
    super("Another mining settlement committed first");
    this.name = "ConcurrentSettlementError";
  }
}

const MAX_SETTLE_ATTEMPTS = 4;

export interface MiningSettlementInput {
  collections: Collections;
  mongoClient: MongoClient;
  config: Pick<AppConfig, "mining" | "miningPools">;
  session: MiningSessionRecord;
  wallet: WalletRecord;
  walletAccount: LedgerAccountRecord;
  correlationId: string;
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
export async function settleSession(input: MiningSettlementInput): Promise<{ postedMinor: number; session: MiningSessionRecord; confirmed: boolean }> {
  const { collections, config } = input;
  if (!config.mining.settlementEnabled) return { postedMinor: 0, session: input.session, confirmed: true };
  /**
   * Issuance stops when an operator pauses payouts (see financial-controls). Settlement is the only
   * path that creates LMA, so it is the payout surface: while the control is on, nothing is posted
   * and the result is reported as *unconfirmed* — never as a successful settlement of zero, which a
   * caller could mistake for "the reward was smaller than expected". The cycle is left open exactly
   * as it was, so no reward is stranded: the moment the pause is lifted, the next settle posts it.
   */
  if ((await readFinancialControls(collections)).payoutsPaused) return { postedMinor: 0, session: input.session, confirmed: false };

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
          const reloaded = await collections.miningSessions.findOne({ _id: current._id });
          return { postedMinor: 0, session: reloaded ?? current, confirmed: true };
        }
        // Lost the close race: re-read and re-decide instead of reporting a close that never
        // landed — the winner's write is the one that counts.
        const reloaded = await collections.miningSessions.findOne({ _id: current._id });
        if (!reloaded) return { postedMinor: 0, session: current, confirmed: false };
        current = reloaded;
        if (attempt < MAX_SETTLE_ATTEMPTS) {
          await sleep(RETRY_BACKOFF_BASE_MS * 2 ** (attempt - 1));
          continue;
        }
        return { postedMinor: 0, session: current, confirmed: false };
      }
      return { postedMinor: 0, session: current, confirmed: true };
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

          // The journal header is the single authoritative financial record of this reward (see
          // ADR-003): every ledger line resolves to it the way reconciliation requires, and no
          // second settlement document is written anywhere. It is typed `mining` and carries no
          // sender/receiver, so it can never surface in a customer's transfer history. Posted
          // through the repository so the header↔entries pairing and the balance assertion live
          // in one place no future money path can forget.
          await postBalancedJournal(
            collections,
            {
              header: {
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
                walletAccountId: input.walletAccount.publicId,
                idempotencyKey,
                correlationId: input.correlationId,
                createdAt: now,
                completedAt: now,
              } satisfies Omit<MiningTransactionRecord, "_id">,
              lines: [
                { ledgerAccountId: treasury.publicId, walletId: null, side: "debit", amountMinor: delta, correlationId: input.correlationId, createdAt: now },
                { ledgerAccountId: input.walletAccount.publicId, walletId: input.wallet.publicId, side: "credit", amountMinor: delta, correlationId: input.correlationId, createdAt: now },
              ],
              linePublicIds: [randomUUID(), randomUUID()],
            },
            mongoSession,
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
      return { postedMinor: delta, session: updated ?? current, confirmed: true };
    } catch (error) {
      // A lost race, a transient fault, or an ambiguous commit all mean the same thing here: re-read
      // the cycle and decide again. The compare-and-set makes re-deciding safe — a reward already
      // posted is never posted twice.
      if (error instanceof ConcurrentSettlementError || isDuplicateKeyError(error) || isTransientTransactionError(error)) {
        const reloaded = await collections.miningSessions.findOne({ _id: current._id });
        if (!reloaded) return { postedMinor: 0, session: current, confirmed: false };
        current = reloaded;
        if (attempt < MAX_SETTLE_ATTEMPTS) {
          await sleep(RETRY_BACKOFF_BASE_MS * 2 ** (attempt - 1));
          continue;
        }
        // Retries exhausted with the outcome still uncertain: report failure, never success.
        await recordSecurityEvent({
          collections,
          ownerUserId: current.ownerUserId,
          sessionId: null,
          eventType: "mining_settlement_unconfirmed",
          outcome: "failure",
          correlationId: input.correlationId,
          metadata: { sessionId: current.publicId },
        }).catch(() => undefined);
        return { postedMinor: 0, session: current, confirmed: false };
      }
      throw error;
    } finally {
      await mongoSession.endSession();
    }
  }

  return { postedMinor: 0, session: current, confirmed: false };
}

/** Explicit settlement for the account's running cycle. Idempotent: nothing to post means no write. */
export async function settleMining(input: {
  collections: Collections;
  mongoClient: MongoClient;
  config: Pick<AppConfig, "mining" | "miningPools">;
  ownerUserId: string;
  correlationId: string;
  cache?: CacheContext | undefined;
  membershipCache?: CacheContext | undefined;
}): Promise<PublicMiningState> {
  const { collections, config } = input;
  const live = await loadMiningSettings(collections, config, input.cache);
  const liveConfig = { ...config, mining: live.mining };
  if (!live.mining.enabled) {
    throw serviceUnavailable("mining_disabled", "Mining is temporarily unavailable.");
  }
  if (!live.mining.settlementEnabled) {
    throw serviceUnavailable("mining_settlement_disabled", "Mining settlement is temporarily paused.");
  }
  const active = await loadActiveSession(collections, input.ownerUserId);
  if (active) {
    const { wallet, walletAccount } = await loadWalletAndAccount(collections, input.ownerUserId);
    const result = await settleSession({ collections, mongoClient: input.mongoClient, config: liveConfig, session: active, wallet, walletAccount, correlationId: input.correlationId });
    if (!result.confirmed) {
      throw serviceUnavailable("mining_settlement_failed", "The reward could not be confirmed. Try again.");
    }
  }
  return getMiningState({ collections, config, ownerUserId: input.ownerUserId, cache: input.cache, membershipCache: input.membershipCache });
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
  config: Pick<AppConfig, "mining" | "miningPools">;
  ownerUserId: string;
  wallet: WalletRecord;
  walletAccount: LedgerAccountRecord;
  correlationId: string;
  cache?: CacheContext | undefined;
}): Promise<{ postedMinor: number; confirmed: boolean }> {
  const { collections, config } = input;
  const live = await loadMiningSettings(collections, config, input.cache);
  if (!live.mining.enabled || !live.mining.settlementEnabled) return { postedMinor: 0, confirmed: true };

  const active = await loadActiveSession(collections, input.ownerUserId);
  if (!active) return { postedMinor: 0, confirmed: true };

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
  if (accrued <= active.settledMinor && !closedButUnmarked) return { postedMinor: 0, confirmed: true };

  const result = await settleSession({
    collections,
    mongoClient: input.mongoClient,
    config: { ...config, mining: live.mining },
    session: active,
    wallet: input.wallet,
    walletAccount: input.walletAccount,
    correlationId: input.correlationId,
  });
  // The transfer path ignores `confirmed`: a side-effect accrual that cannot be confirmed must not
  // fail the user's transfer, and the transfer itself reports only its own outcome.
  return { postedMinor: result.postedMinor, confirmed: result.confirmed };
}
