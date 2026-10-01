import { randomUUID } from "node:crypto";
import { ObjectId, type ClientSession, type MongoClient } from "mongodb";
import type { Collections } from "../../infrastructure/mongodb/collections.js";
import type { AppConfig } from "../../config/env.js";
import { assertBalanced, formatMoney } from "../ledger/money.js";
import { ensureTreasuryAccount } from "../wallets/service.js";
import { recordSecurityEvent } from "../security/audit.js";
import { accruedMinorFor, pickRateUnits, rateToString, totalAccrualMinor } from "./rate.js";
import { badRequest, conflict, forbidden, notFound, serviceUnavailable } from "../../shared/errors.js";
import {
  DEVICE_EVIDENCE_MISSING_CODE,
  DEVICE_EVIDENCE_MISSING_MESSAGE,
  DEVICE_IN_USE_CODE,
  DEVICE_IN_USE_MESSAGE,
  DEVICE_NETWORK_IN_USE_CODE,
  DEVICE_NETWORK_IN_USE_MESSAGE,
} from "../mining-device/policy.js";
import { LEDGER_AMOUNT_MAX_MINOR, LEDGER_BALANCE_MAX_MINOR } from "../../shared/types.js";
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

/** Projects a stored cycle (or its absence) into the customer-facing state. Exported for testing. */
export function stateFromRecord(record: MiningSessionRecord | null, nowMs: number, enabled: boolean, settlementEnabled: boolean, cycleDurationSeconds: number): PublicMiningState {
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
    // A new cycle may start whenever the account has no running one. An expired-but-unsettled cycle
    // is `completed`, and `start` settles it before opening the next, so nothing is stranded —
    // which is why a `completed` state additionally requires settlement to be enabled.
    canStart: enabled && status !== "active" && (settlementEnabled || !needsClose),
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
  // Reads stay available while mining is disabled: an account with an accrued-but-unsettled reward
  // must still see its cycle. Disabling stops writes (start/settle refuse), never visibility.
  // One read in the running case. Only an idle account pays for the second, to show its last cycle.
  const active = await loadActiveSession(input.collections, input.ownerUserId);
  const record = active ?? (await loadLatestSession(input.collections, input.ownerUserId));
  return stateFromRecord(record, nowMs, input.config.mining.enabled, input.config.mining.settlementEnabled, input.config.mining.cycleDurationSeconds);
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
export interface MiningStartDeviceContext {
  /** Raw client device evidence (sanitized server-side; never trusted as-is). */
  evidenceRaw: unknown;
  /** Server-observed client IP (from Fastify/trustProxy), never a client claim. */
  ip: string | null;
}

export async function startMining(input: {
  collections: Collections;
  mongoClient: MongoClient;
  config: Pick<AppConfig, "mining" | "lmdg" | "ipinfoToken" | "ipinfoTimeoutMs" | "proxycheckKey" | "proxycheckTimeoutMs" | "encryptionKey">;
  ownerUserId: string;
  correlationId: string;
  device?: MiningStartDeviceContext;
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
    const closed = await settleSession({ collections, mongoClient: input.mongoClient, config, session: active, wallet, walletAccount, correlationId: input.correlationId });
    // An unconfirmed close is a failure, not a success: opening a new cycle now would collide
    // with the still-active one on the unique index and converge on the old cycle, reporting
    // "success" for a start that never happened.
    if (!closed.confirmed) {
      throw serviceUnavailable("mining_settlement_failed", "The previous cycle could not be closed. Try again.");
    }
    const stillActive = await loadActiveSession(collections, input.ownerUserId);
    if (stillActive) {
      if (Date.now() < stillActive.endsAt.getTime()) {
        throw conflict("mining_cycle_active", "A mining cycle is already running for this account.");
      }
      // The window is over but the close did not land: fail loudly instead of inserting a cycle
      // that the unique index would refuse and then converging on the stale one.
      throw serviceUnavailable("mining_settlement_failed", "The previous cycle could not be closed. Try again.");
    }
  }

  const previous = await collections.miningSessions.findOne(
    { ownerUserId: input.ownerUserId },
    { sort: { createdAt: -1, publicId: -1 }, projection: { publicId: 1, cycleNumber: 1 } },
  );

  const now = new Date();
  const startedAtMs = now.getTime();
  const rateUnits = pickRateUnits(config.mining.rate);
  // Defense in depth behind the boot-time config validation: never open a cycle whose 24-hour
  // total cannot be represented exactly or posted through the ledger. A bad rate fails the start
  // instead of stranding an unsettleable, irreplaceable active cycle on the account.
  const endsAtMs = startedAtMs + config.mining.cycleDurationSeconds * 1000;
  const cycleTotalMinor = totalAccrualMinor(
    { rateUnits, rateScale: config.mining.rate.scale },
    { startedAtMs, endsAtMs, durationSeconds: config.mining.cycleDurationSeconds },
  );
  if (cycleTotalMinor < 1 || cycleTotalMinor > LEDGER_AMOUNT_MAX_MINOR) {
    await recordSecurityEvent({
      collections,
      ownerUserId: input.ownerUserId,
      sessionId: null,
      eventType: "mining_rejected",
      outcome: "failure",
      correlationId: input.correlationId,
      metadata: { reason: "rate_total_out_of_range" },
    }).catch(() => undefined);
    throw serviceUnavailable("mining_rate_unavailable", "Mining is temporarily unavailable.");
  }
  const session: Omit<MiningSessionRecord, "_id"> = {
    publicId: randomUUID(),
    ownerUserId: input.ownerUserId,
    walletId: wallet.publicId,
    ledgerAccountId: walletAccount.publicId,
    status: "active",
    cycleNumber: (previous?.cycleNumber ?? 0) + 1,
    startedAt: now,
    endsAt: new Date(endsAtMs),
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

  // LMDG admission control: resolve the device cluster and enforce one active lease per device.
  //
  // While the guard is enabled a start MUST carry device evidence. Accepting an evidence-less body
  // as "legacy" would make the one-cycle-per-device rule optional for anyone who omits the field —
  // i.e. the first thing an abuser would do — so a start without evidence is refused instead.
  // `LMDG_ENABLED=false` remains the operational escape hatch.
  const deviceLeaseEnabled = config.lmdg?.enabled === true && config.lmdg?.leaseEnabled === true;
  if (deviceLeaseEnabled && input.device === undefined) {
    await recordSecurityEvent({
      collections,
      ownerUserId: input.ownerUserId,
      sessionId: null,
      eventType: "mining_device_evidence_missing",
      outcome: "failure",
      correlationId: input.correlationId,
      metadata: { reason: "device_evidence_absent" },
    }).catch(() => undefined);
    throw badRequest(DEVICE_EVIDENCE_MISSING_CODE, DEVICE_EVIDENCE_MISSING_MESSAGE);
  }
  // The device identities this start leases (the resolved device's key hash, plus its exact
  // duplicates). A racing start cannot take a duplicate row and open a second cycle on one machine.
  let leaseKeys: string[] = [];
  let leaseDeviceId: string | null = null;
  // The device cluster this start resolves to, credited with one admission once the cycle commits.
  let creditDeviceId: string | null = null;
  if (deviceLeaseEnabled && input.device) {
    const guard = await import("../mining-device/service.js");
    // An empty or non-object payload (`{"device":{}}`) is not evidence: it sanitizes to no machine
    // traits and no browser key, so the lease would fall back to a network-dependent identity that a
    // second account reproduces differently. Refuse it exactly like a missing field.
    const evidenceRaw: unknown = input.device.evidenceRaw;
    if (typeof evidenceRaw !== "object" || evidenceRaw === null || Array.isArray(evidenceRaw) || Object.keys(evidenceRaw).length === 0) {
      await recordSecurityEvent({
        collections,
        ownerUserId: input.ownerUserId,
        sessionId: null,
        eventType: "mining_device_evidence_missing",
        outcome: "failure",
        correlationId: input.correlationId,
        metadata: { reason: "device_evidence_empty" },
      }).catch(() => undefined);
      throw badRequest(DEVICE_EVIDENCE_MISSING_CODE, DEVICE_EVIDENCE_MISSING_MESSAGE);
    }
    const intel = await guard.resolveIpIntel({ config, ip: input.device.ip });
    // Evidence with neither a machine identity nor a browser key cannot name a device. This is
    // checked from the sanitized evidence *before* registration: resolving first would insert a
    // device row that the insufficient-evidence rejection then abandons, so repeated rejected
    // junk requests would accumulate unused records in `miningDevices`.
    const { sanitizeEvidence, normalizeSignals } = await import("../mining-device/signals.js");
    const { buildFeatureMap, machineFeatureMap, machineKeyHash } = await import("../mining-device/identity.js");
    const preEvidence = sanitizeEvidence(input.device.evidenceRaw);
    const preSignals = normalizeSignals(preEvidence);
    const preMachineKey = machineKeyHash(config.encryptionKey, machineFeatureMap(buildFeatureMap(preSignals)));
    if (preMachineKey === null && !preEvidence.browserKeyPublicKey) {
      await recordSecurityEvent({
        collections,
        ownerUserId: input.ownerUserId,
        sessionId: null,
        eventType: "mining_device_evidence_missing",
        outcome: "failure",
        correlationId: input.correlationId,
        metadata: { reason: "device_evidence_insufficient" },
      }).catch(() => undefined);
      throw badRequest(DEVICE_EVIDENCE_MISSING_CODE, DEVICE_EVIDENCE_MISSING_MESSAGE);
    }
    const resolution = await guard.resolveOrCreateDevice({
      collections,
      config,
      evidenceRaw: input.device.evidenceRaw,
      ip: input.device.ip,
      intel,
      ownerUserId: input.ownerUserId,
      correlationId: input.correlationId,
    });
    // Defense in depth: the post-resolution check below repeats the same refusal on the resolved
    // identities, in case sanitization and resolution ever disagree about what counts as evidence.
    if (resolution.machineKey === null && !resolution.evidence.browserKeyPublicKey) {
      await recordSecurityEvent({
        collections,
        ownerUserId: input.ownerUserId,
        sessionId: null,
        eventType: "mining_device_evidence_missing",
        outcome: "failure",
        correlationId: input.correlationId,
        metadata: { reason: "device_evidence_insufficient" },
      }).catch(() => undefined);
      throw badRequest(DEVICE_EVIDENCE_MISSING_CODE, DEVICE_EVIDENCE_MISSING_MESSAGE);
    }
    // Leases this account already holds on this machine's identities.
    const leaseNowMs = Date.now();
    const ownLeases = await collections.miningDeviceLeases
      .find({ deviceClusterId: { $in: resolution.equivalentLeaseKeys }, status: "active", ownerUserId: input.ownerUserId })
      .toArray();
    if (ownLeases.length > 0) {
      // A cycle that is still running on this machine keeps its lease: the account converges on it
      // instead of opening a second one. The check is a fresh, clock-bounded query rather than the
      // earlier read, so a start that was in flight while this one ran is still respected.
      const runningLeases = await collections.miningSessions.countDocuments({
        ownerUserId: input.ownerUserId,
        status: "active",
        endsAt: { $gt: new Date(leaseNowMs) },
      });
      if (runningLeases > 0) return getMiningState({ collections, config, ownerUserId: input.ownerUserId });
      // Nothing is running on this machine for this account, so these rows are leftovers: an expired
      // cycle's lease, or a lease an earlier build took on the browser key. They are released because
      // the partial unique index refuses a new lease while a row is still marked active — which is
      // what lets the account mine again on its own device, and never frees a machine mid-cycle.
      await collections.miningDeviceLeases.updateMany(
        { _id: { $in: ownLeases.map((lease) => lease._id) } },
        { $set: { status: "released", updatedAt: new Date(leaseNowMs) } },
      );
    }
    const eligibility = await guard.assessMiningStart({
      collections,
      config,
      ownerUserId: input.ownerUserId,
      resolution,
      correlationId: input.correlationId,
      ip: input.device ? input.device.ip : null,
      intel,
    });
    if (config.lmdg.riskMode !== "monitor") {
      if (eligibility.decision === "deny") {
        if (eligibility.reasonCode === "device_lease_active" || eligibility.reasonCode === "device_cluster_lease_ambiguous") {
          await recordSecurityEvent({
            collections,
            ownerUserId: input.ownerUserId,
            sessionId: null,
            eventType: "mining_device_rejected",
            outcome: "failure",
            correlationId: input.correlationId,
            metadata: { reason: eligibility.reasonCode },
          }).catch(() => undefined);
          throw conflict(DEVICE_IN_USE_CODE, DEVICE_IN_USE_MESSAGE);
        }
        // An untrusted identity on a network that is already mining: same conflict semantics for the
        // caller (this environment is occupied), distinct message so an honest new device knows to
        // wait for the cycle to end. This is a hard refusal — a browser key cannot clear it, because
        // a caller can generate one at will and that is exactly how the bypass worked.
        if (eligibility.reasonCode === DEVICE_NETWORK_IN_USE_CODE) {
          await recordSecurityEvent({
            collections,
            ownerUserId: input.ownerUserId,
            sessionId: null,
            eventType: "mining_device_rejected",
            outcome: "failure",
            correlationId: input.correlationId,
            metadata: { reason: eligibility.reasonCode },
          }).catch(() => undefined);
          throw conflict(DEVICE_NETWORK_IN_USE_CODE, DEVICE_NETWORK_IN_USE_MESSAGE);
        }
        throw forbidden("mining_device_rejected", DEVICE_IN_USE_MESSAGE);
      }
      if (eligibility.decision === "challenge") {
        throw conflict("mining_device_challenge_required", "Additional device verification is required before mining can start.");
      }
      leaseKeys = eligibility.equivalentLeaseKeys;
      leaseDeviceId = eligibility.device.publicId;
    } else {
      // Rollout mode: a conflict is audited above and never enforced — including the lease it would
      // otherwise have taken, which is the whole point of running in monitor. Enforce mode (the
      // configured mode in this deployment) is the one that takes the lease and therefore refuses.
      leaseKeys = eligibility.decision === "deny" ? [] : eligibility.equivalentLeaseKeys;
      leaseDeviceId = eligibility.decision === "deny" ? null : eligibility.device.publicId;
    }
    // A cycle is about to be created on this cluster whichever mode ran (monitor only skips the
    // lease, not the cycle), so the admission is credited to it once the session commits below.
    creditDeviceId = eligibility.device.publicId;
  }

  if (leaseKeys.length > 0) {
    // Expired rows stay `active` in the database — expiry is a fact about the clock, not a write —
    // and the partial unique index still refuses a new lease while one exists. Admission already
    // ignores expired leases, so release them here (any owner's: an expired lease protects nothing)
    // before the insert, or the new account would fail with `mining_start_failed` until the former
    // owner starts again or the row is released by hand.
    await collections.miningDeviceLeases.updateMany(
      { deviceClusterId: { $in: leaseKeys }, status: "active", leaseEndsAt: { $lte: new Date(Date.now()) } },
      { $set: { status: "released", updatedAt: new Date(Date.now()) } },
    ).catch(() => undefined);
    // Atomic commit: the cycle and its device lease land together or not at all. The partial
    // unique index on active leases is the concurrency lock — two accounts racing on one device
    // cannot both insert; the loser maps to the dedicated rejection code below.
    const guard = await import("../mining-device/service.js");
    const mongoSession: ClientSession = input.mongoClient.startSession();
    try {
      await mongoSession.withTransaction(
        async () => {
          await collections.miningSessions.insertOne({ _id: new ObjectId(), ...session } as MiningSessionRecord, { session: mongoSession });
          await guard.insertLeaseInSession({
            collections,
            leaseKeys,
            deviceId: leaseDeviceId,
            // The network this cycle is taken from is recorded on its lease, so the network lock can
            // read live leases per network instead of guessing from device records.
            ip: input.device?.ip ?? null,
            secret: config.encryptionKey,
            ownerUserId: input.ownerUserId,
            miningSessionId: session.publicId,
            leaseEndsAt: session.endsAt,
            mongoSession,
          });
        },
        { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" } },
      );
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        // Distinguish the loser's cause: a lease conflict means another account holds this
        // device; otherwise it was this account's own concurrent start converging.
        const lease = await collections.miningDeviceLeases.findOne({ deviceClusterId: { $in: leaseKeys }, status: "active" });
        if (lease && lease.ownerUserId !== input.ownerUserId && lease.leaseEndsAt.getTime() > Date.now()) {
          throw conflict(DEVICE_IN_USE_CODE, DEVICE_IN_USE_MESSAGE);
        }
        const converged = await getMiningState({ collections, config, ownerUserId: input.ownerUserId });
        // A duplicate that leaves the account with no running cycle means the start did not land and
        // nothing else produced a cycle for it: report a retryable failure instead of the 200 the
        // customer would read as "mining started" when it never did.
        if (converged.status !== "active") {
          throw serviceUnavailable("mining_start_failed", "Mining could not start. Try again.");
        }
        return converged;
      }
      throw error;
    } finally {
      await mongoSession.endSession();
    }
  } else {
    try {
      await collections.miningSessions.insertOne({ _id: new ObjectId(), ...session } as MiningSessionRecord);
    } catch (error) {
      // A concurrent start won the one-active index. That is the API working as designed: converge on
      // the cycle that exists rather than surfacing a duplicate-key fault to the customer.
      if (isDuplicateKeyError(error)) {
        const converged = await getMiningState({ collections, config, ownerUserId: input.ownerUserId });
        if (converged.status !== "active") {
          throw serviceUnavailable("mining_start_failed", "Mining could not start. Try again.");
        }
        return converged;
      }
      throw error;
    }
  }

  // The cycle and its lease are committed: credit the resolved device cluster with one admission on
  // the network this start was taken from. This is the only writer of admissions, so `established`
  // counts cycles that actually started — never requests that merely reached admission control, and
  // never several credits for one cycle. It happens after the commit on purpose: a credit before the
  // transaction could age a cluster toward `established` while the lease insert was still racing.
  if (creditDeviceId !== null) {
    const guard = await import("../mining-device/service.js");
    await guard
      .creditGrantedStart({
        collections,
        config,
        devicePublicId: creditDeviceId,
        ip: input.device?.ip ?? null,
      })
      // Never fails the committed request, but never disappears either: a credit that was not written
      // is an admission the device earned and does not get back (see `reportCreditFailure`).
      .catch((error) => {
        console.error(`[lmdg] committed credit not written for device ${creditDeviceId}:`, error);
      });
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
async function settleSession(input: MiningSettlementInput): Promise<{ postedMinor: number; session: MiningSessionRecord; confirmed: boolean }> {
  const { collections, config } = input;
  if (!config.mining.settlementEnabled) return { postedMinor: 0, session: input.session, confirmed: true };

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
    const result = await settleSession({ collections, mongoClient: input.mongoClient, config, session: active, wallet, walletAccount, correlationId: input.correlationId });
    if (!result.confirmed) {
      throw serviceUnavailable("mining_settlement_failed", "The reward could not be confirmed. Try again.");
    }
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
}): Promise<{ postedMinor: number; confirmed: boolean }> {
  const { collections, config } = input;
  if (!config.mining.enabled || !config.mining.settlementEnabled) return { postedMinor: 0, confirmed: true };

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
    config,
    session: active,
    wallet: input.wallet,
    walletAccount: input.walletAccount,
    correlationId: input.correlationId,
  });
  // The transfer path ignores `confirmed`: a side-effect accrual that cannot be confirmed must not
  // fail the user's transfer, and the transfer itself reports only its own outcome.
  return { postedMinor: result.postedMinor, confirmed: result.confirmed };
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
