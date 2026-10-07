import { randomUUID } from "node:crypto";
import type { ClientSession, MongoClient } from "mongodb";
import type { Collections } from "../../infrastructure/mongodb/collections.js";
import type { AppConfig } from "../../config/env.js";
import { postBalancedJournal } from "../../infrastructure/mongodb/repositories.js";
import { invalidate, poolMembershipKey, type CacheContext } from "../../infrastructure/redis/cache.js";
import { ensureTreasuryAccount } from "../wallets/service.js";
import { recordSecurityEvent } from "../security/audit.js";
import { readFinancialControls } from "../financial-controls/service.js";
import { releasePoolHold } from "./pools.js";
import { totalAccrualMinor } from "./rate.js";
import { loadMiningSettings } from "./settings.js";
import { serviceUnavailable } from "../../shared/errors.js";
import { LEDGER_BALANCE_MAX_MINOR } from "../../shared/types.js";
import { RETRY_BACKOFF_BASE_MS, isDuplicateKeyError, isTransientTransactionError, sleep } from "../../shared/mongo-retry.js";
import { getMiningState, loadActiveSession, loadWalletAndAccount } from "./state.js";
import type { LedgerAccountRecord, MiningTransactionRecord, PublicMiningState } from "../../shared/types.js";

class ConcurrentStopError extends Error {
  constructor() {
    super("Another mining stop/settlement committed first");
    this.name = "ConcurrentStopError";
  }
}

const MAX_STOP_ATTEMPTS = 4;

/**
 * Stops the account's running mining segment.
 *
 * Idempotent: with no active segment it returns the current state without
 * writing. Otherwise it freezes the segment at the server clock (`endsAt =
 * min(endsAt, now)`, `durationSeconds` truncated together), posts the final
 * accrual through the balanced ledger, releases the segment's device leases in
 * the same transaction, and marks the segment `settled` so the same account
 * (or another on the same device) can resume from the remaining quota.
 *
 * Stop never refunds and never moves the 24h anchors: consumed time stays
 * `endsAt - startedAt` inside the window, so resume continues from
 * `quota - consumed`. Server timestamps only; no client value participates.
 */
export async function stopMining(input: {
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
  if (!live.mining.enabled) {
    throw serviceUnavailable("mining_disabled", "Mining is temporarily unavailable.");
  }

  for (let attempt = 1; attempt <= MAX_STOP_ATTEMPTS; attempt += 1) {
    const active = await loadActiveSession(collections, input.ownerUserId);
    if (!active) {
      return getMiningState({ collections, config, ownerUserId: input.ownerUserId, cache: input.cache, membershipCache: input.membershipCache });
    }

    const now = new Date();
    const nowMs = now.getTime();
    const startedAtMs = active.startedAt.getTime();
    const newEndsAtMs = Math.min(active.endsAt.getTime(), nowMs);
    const elapsedSeconds = Math.max(0, Math.floor((newEndsAtMs - startedAtMs) / 1000));
    const newEndsAt = new Date(newEndsAtMs);

    // Final accrual of the truncated segment. Zero-length (same-second stop)
    // accrues nothing and closes without a journal write.
    const accrued = elapsedSeconds <= 0
      ? 0
      : totalAccrualMinor(
        { rateUnits: active.rateUnits, rateScale: active.rateScale },
        { startedAtMs, endsAtMs: newEndsAtMs, durationSeconds: elapsedSeconds },
      );
    const delta = Math.max(0, accrued - active.settledMinor);

    if (delta > 0) {
      if (!live.mining.settlementEnabled) {
        throw serviceUnavailable("mining_settlement_disabled", "Mining settlement is temporarily paused; the running segment cannot be closed until settlement resumes.");
      }
      if ((await readFinancialControls(collections)).payoutsPaused) {
        throw serviceUnavailable("mining_settlement_failed", "The reward could not be confirmed. Try again.");
      }
    }

    const { wallet, walletAccount } = await loadWalletAndAccount(collections, input.ownerUserId);
    const nextSequence = active.settlementSequence + 1;
    const settlementPublicId = randomUUID();
    const idempotencyKey = `mining:${active.publicId}:${nextSequence}`;

    let treasury: LedgerAccountRecord | null = null;
    if (delta > 0) {
      const treasuryAccountId = await ensureTreasuryAccount(collections);
      treasury = await collections.ledgerAccounts.findOne({ publicId: treasuryAccountId, accountType: "system_treasury", currency: "LMA" });
      if (!treasury) throw new Error("System treasury ledger account is missing");
    }

    const mongoSession: ClientSession = input.mongoClient.startSession();
    try {
      await mongoSession.withTransaction(
        async () => {
          // Compare-and-set on the live segment: a concurrent stop/settle that
          // committed first makes this match nothing and forces a re-read.
          if (delta > 0) {
            const cas = await collections.miningSessions.updateOne(
              { _id: active._id, ownerUserId: active.ownerUserId, status: "active", settledMinor: active.settledMinor },
              {
                $inc: { settledMinor: delta, settlementSequence: 1 },
                $set: { lastSettledAt: now, updatedAt: now, status: "settled", endsAt: newEndsAt, durationSeconds: elapsedSeconds },
              },
              { session: mongoSession },
            );
            if (cas.modifiedCount !== 1) throw new ConcurrentStopError();

            const walletCredit = await collections.ledgerAccounts.updateOne(
              { _id: walletAccount._id, accountType: "wallet", balanceMinor: { $lte: LEDGER_BALANCE_MAX_MINOR - delta } },
              { $inc: { balanceMinor: delta } },
              { session: mongoSession },
            );
            if (walletCredit.modifiedCount !== 1) throw new Error("The mining reward would exceed the wallet's LMA ceiling");

            const treasuryDebit = await collections.ledgerAccounts.updateOne(
              // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
              { _id: treasury!._id, accountType: "system_treasury" },
              { $inc: { balanceMinor: delta } },
              { session: mongoSession },
            );
            if (treasuryDebit.modifiedCount !== 1) throw new Error("Failed to debit the system treasury for a mining reward");

            await postBalancedJournal(
              collections,
              {
                header: {
                  publicId: settlementPublicId,
                  type: "mining",
                  currency: "LMA",
                  status: "completed",
                  ownerUserId: active.ownerUserId,
                  walletId: active.walletId,
                  miningSessionId: active.publicId,
                  sequenceNumber: nextSequence,
                  amountMinor: delta,
                  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                  treasuryAccountId: treasury!.publicId,
                  walletAccountId: walletAccount.publicId,
                  idempotencyKey,
                  correlationId: input.correlationId,
                  createdAt: now,
                  completedAt: now,
                } satisfies Omit<MiningTransactionRecord, "_id">,
                lines: [
                  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                  { ledgerAccountId: treasury!.publicId, walletId: null, side: "debit", amountMinor: delta, correlationId: input.correlationId, createdAt: now },
                  { ledgerAccountId: walletAccount.publicId, walletId: wallet.publicId, side: "credit", amountMinor: delta, correlationId: input.correlationId, createdAt: now },
                ],
                linePublicIds: [randomUUID(), randomUUID()],
              },
              mongoSession,
            );
          } else {
            const cas = await collections.miningSessions.updateOne(
              { _id: active._id, ownerUserId: active.ownerUserId, status: "active", settledMinor: active.settledMinor },
              { $set: { status: "settled", endsAt: newEndsAt, durationSeconds: elapsedSeconds, updatedAt: now } },
              { session: mongoSession },
            );
            if (cas.modifiedCount !== 1) throw new ConcurrentStopError();
          }

          // Free the machine: the segment's leases release in the same commit, so
          // another account on the same device can start immediately after, while
          // a stop racing a start on the same device cannot leave both active.
          await collections.miningDeviceLeases.updateMany(
            { miningSessionId: active.publicId, status: "active" },
            { $set: { status: "released", updatedAt: now } },
            { session: mongoSession },
          );

          // Free the room in the same commit: mining and holding a room are the same fact, so a
          // stop that ended the cycle must end its hold too — never leaving an account inside a
          // room it is no longer mining in. The row stays behind as the room-change throttle's
          // anchor until its cooldown passes (the TTL index reaps it after that).
          await releasePoolHold({
            collections,
            ownerUserId: active.ownerUserId,
            cooldownSeconds: live.miningPools.switchCooldownSeconds,
            nowMs,
            session: mongoSession,
          });

          await recordSecurityEvent({
            collections,
            ownerUserId: active.ownerUserId,
            sessionId: null,
            eventType: "mining_stopped",
            outcome: "success",
            correlationId: input.correlationId,
            metadata: { sessionId: active.publicId, elapsedSeconds, amountMinor: delta },
            mongoSession,
          });
        },
        { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" } },
      );
    } catch (error) {
      if (error instanceof ConcurrentStopError || isDuplicateKeyError(error) || isTransientTransactionError(error)) {
        if (attempt < MAX_STOP_ATTEMPTS) {
          await sleep(RETRY_BACKOFF_BASE_MS * 2 ** (attempt - 1));
          continue;
        }
        throw serviceUnavailable("mining_stop_failed", "Mining could not stop. Try again.");
      }
      throw error;
    } finally {
      await mongoSession.endSession();
    }

    // The room hold changed above: drop the cached membership after the commit. MongoDB first,
    // cache second — a lost invalidation only serves the held room until the TTL.
    const membershipHandle = input.membershipCache?.redis ?? input.cache?.redis;
    if (membershipHandle) await invalidate(membershipHandle, poolMembershipKey(membershipHandle, input.ownerUserId));

    return getMiningState({ collections, config, ownerUserId: input.ownerUserId, cache: input.cache, membershipCache: input.membershipCache });
  }

  throw serviceUnavailable("mining_stop_failed", "Mining could not stop. Try again.");
}
