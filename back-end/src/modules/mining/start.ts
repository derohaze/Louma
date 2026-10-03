import { randomUUID } from "node:crypto";
import { ObjectId, type ClientSession, type MongoClient } from "mongodb";
import type { Collections } from "../../infrastructure/mongodb/collections.js";
import type { AppConfig } from "../../config/env.js";
import { recordSecurityEvent } from "../security/audit.js";
import { pickRateUnits, rateToString, totalAccrualMinor } from "./rate.js";
import { loadMiningSettings } from "./settings.js";
import type { CacheContext } from "../../infrastructure/redis/cache.js";
import { badRequest, conflict, forbidden, serviceUnavailable } from "../../shared/errors.js";
import {
  DEVICE_EVIDENCE_MISSING_CODE,
  DEVICE_EVIDENCE_MISSING_MESSAGE,
  DEVICE_IN_USE_CODE,
  DEVICE_IN_USE_MESSAGE,
  DEVICE_NETWORK_IN_USE_CODE,
  DEVICE_NETWORK_IN_USE_MESSAGE,
} from "../mining-device/policy.js";
import { LEDGER_AMOUNT_MAX_MINOR } from "../../shared/types.js";
import { isDuplicateKeyError } from "../../shared/mongo-retry.js";
import { allowedSessionSeconds } from "./quota.js";
import { loadAccountQuota, loadDeviceQuota } from "./quota-store.js";
import { deviceQuotaKeyFor } from "./quota.js";
import { applyPoolFactor, drawPoolFactorBps, getPoolById } from "./pools.js";
import {
  buildFeatureMap,
  machineFeatureMap,
  machineKeyHash,
} from "../mining-device/identity.js";
import { normalizeSignals, sanitizeEvidence } from "../mining-device/signals.js";
import {
  assessMiningStart,
  creditGrantedStart,
  insertLeaseInSession,
  resolveIpIntel,
  resolveOrCreateDevice,
} from "../mining-device/service.js";
import { settleSession } from "./settle.js";
import { getMiningState, loadActiveSession, loadWalletAndAccount } from "./state.js";
import type {
  MiningSessionRecord,
  PublicMiningState,
} from "../../shared/types.js";

export interface MiningStartDeviceContext {
  /** Raw client device evidence (sanitized server-side; never trusted as-is). */
  evidenceRaw: unknown;
  /** Server-observed client IP (from Fastify/trustProxy), never a client claim. */
  ip: string | null;
}

/**
 * Opens a new mining segment for the account inside its 10h/24h quota window.
 *
 * The window, the length, and the rate are chosen here, on the server, and are never accepted
 * from the caller: `startedAt` is the server clock, `endsAt` is `startedAt + min(accountRemaining,
 * deviceRemaining)` capped to both 24h window ends, and the rate is a cryptographically drawn
 * integer inside the configured band. A running segment blocks a second one — through the unique
 * index as much as through the check — and an expired-but-unsettled segment is settled first so
 * its reward is never stranded and the one-active slot is freed. Resume is a new segment on the
 * same anchors, never a quota reset.
 */
export async function startMining(input: {
  collections: Collections;
  mongoClient: MongoClient;
  config: Pick<AppConfig, "mining" | "miningPools" | "lmdg" | "ipinfoToken" | "ipinfoTimeoutMs" | "proxycheckKey" | "proxycheckTimeoutMs" | "encryptionKey">;
  ownerUserId: string;
  correlationId: string;
  device?: MiningStartDeviceContext;
  cache?: CacheContext | undefined;
  membershipCache?: CacheContext | undefined;
}): Promise<PublicMiningState> {
  const { collections, config } = input;
  const live = await loadMiningSettings(collections, config, input.cache);
  const mining = live.mining;
  const poolsLive = { mining: live.mining, miningPools: live.miningPools };
  if (!mining.enabled) {
    throw serviceUnavailable("mining_disabled", "Mining is temporarily unavailable.");
  }

  const { wallet, walletAccount } = await loadWalletAndAccount(collections, input.ownerUserId);

  // Pool gate: mining is only possible from inside one of the two system pools.
  const membership = await collections.miningPoolMembers.findOne({ ownerUserId: input.ownerUserId });
  if (!membership) {
    await recordSecurityEvent({
      collections,
      ownerUserId: input.ownerUserId,
      sessionId: null,
      eventType: "mining_rejected",
      outcome: "failure",
      correlationId: input.correlationId,
      metadata: { reason: "pool_required" },
    }).catch(() => undefined);
    throw conflict("mining_pool_required", "Join a mining pool before starting a cycle.");
  }

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
    if (!mining.settlementEnabled) {
      throw serviceUnavailable("mining_settlement_disabled", "Mining settlement is temporarily paused; the finished cycle must be closed before a new one can start.");
    }
    const closed = await settleSession({ collections, mongoClient: input.mongoClient, config: { ...config, ...poolsLive }, session: active, wallet, walletAccount, correlationId: input.correlationId });
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

  // Account quota pre-check before any device side effects (resolution can mint
  // device rows and observations): an exhausted account is refused without
  // touching device state and without consuming any quota.
  const preQuotaNowMs = Date.now();
  const preAccountQuota = await loadAccountQuota(collections, input.ownerUserId, preQuotaNowMs);
  if (preAccountQuota.remainingSeconds <= 0) {
    await recordSecurityEvent({
      collections,
      ownerUserId: input.ownerUserId,
      sessionId: null,
      eventType: "mining_rejected",
      outcome: "failure",
      correlationId: input.correlationId,
      metadata: { reason: "quota_exhausted", scope: "account" },
    }).catch(() => undefined);
    throw conflict("mining_quota_exhausted", "The 10-hour daily mining quota for this account is exhausted. Try again after the 24-hour window resets.");
  }

  // Base rate from the configured band, then one bounded pool draw (avg ≈ 1.0x for both
  // pools): pool choice adds variance, never issuance. The window/total check
  // happens after the quota intersection below, on the capped segment length.
  const poolDef = getPoolById(poolsLive, membership.poolId);
  const rateUnits = applyPoolFactor(pickRateUnits(mining.rate), drawPoolFactorBps(poolsLive, poolDef.id));

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
  // Machine identity for the shared 10h device quota (`machineKey ?? cluster id`).
  // Hoisted so the quota intersection below sees the same identity the lease was
  // assessed on, even in monitor mode (no lease) — quota still binds the machine.
  let resolvedMachineKey: string | null = null;
  let resolvedDevicePublicId: string | null = null;
  if (deviceLeaseEnabled && input.device) {
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
    const intel = await resolveIpIntel({ config, ip: input.device.ip });
    // Evidence with neither a machine identity nor a browser key cannot name a device. This is
    // checked from the sanitized evidence *before* registration: resolving first would insert a
    // device row that the insufficient-evidence rejection then abandons, so repeated rejected
    // junk requests would accumulate unused records in `miningDevices`.
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
    const resolution = await resolveOrCreateDevice({
      collections,
      config,
      evidenceRaw: input.device.evidenceRaw,
      ip: input.device.ip,
      intel,
      ownerUserId: input.ownerUserId,
      correlationId: input.correlationId,
    });
    resolvedMachineKey = resolution.machineKey;
    resolvedDevicePublicId = resolution.device.publicId;
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
      if (runningLeases > 0) return getMiningState({ collections, config, ownerUserId: input.ownerUserId, cache: input.cache, membershipCache: input.membershipCache });
      // Nothing is running on this machine for this account, so these rows are leftovers: an expired
      // cycle's lease, or a lease an earlier build took on the browser key. They are released because
      // the partial unique index refuses a new lease while a row is still marked active — which is
      // what lets the account mine again on its own device, and never frees a machine mid-cycle.
      await collections.miningDeviceLeases.updateMany(
        { _id: { $in: ownLeases.map((lease) => lease._id) } },
        { $set: { status: "released", updatedAt: new Date(leaseNowMs) } },
      );
    }
    const eligibility = await assessMiningStart({
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
    // Monitor may have refused the lease but still resolved the machine: keep the
    // resolution identity for quota (quota binds even when the lease is skipped).
    if (resolvedDevicePublicId === null) resolvedDevicePublicId = eligibility.device.publicId;
  }

  // 10h/24h quota intersection, computed on the server clock after admission so a
  // stop that landed during resolution is already visible. Stop never moves the
  // anchors; a start at/after `anchor + 24h` opens the next window. The segment
  // is capped to `min(accountRemaining, deviceRemaining)` and to both window
  // ends, so it can never cross a reset and 10h + 1s can never accrue.
  const quotaNow = new Date();
  const quotaNowMs = quotaNow.getTime();
  const accountQuota = await loadAccountQuota(collections, input.ownerUserId, quotaNowMs);
  if (accountQuota.remainingSeconds <= 0) {
    await recordSecurityEvent({
      collections,
      ownerUserId: input.ownerUserId,
      sessionId: null,
      eventType: "mining_rejected",
      outcome: "failure",
      correlationId: input.correlationId,
      metadata: { reason: "quota_exhausted", scope: "account" },
    }).catch(() => undefined);
    throw conflict("mining_quota_exhausted", "The 10-hour daily mining quota for this account is exhausted. Try again after the 24-hour window resets.");
  }
  let deviceQuotaKey: string | null = null;
  let deviceQuota: { remainingSeconds: number; windowRemainingSeconds: number; windowStartMs: number } | null = null;
  if (resolvedDevicePublicId !== null) {
    deviceQuotaKey = deviceQuotaKeyFor(resolvedMachineKey, resolvedDevicePublicId);
    const loaded = await loadDeviceQuota(collections, deviceQuotaKey, quotaNowMs);
    deviceQuota = loaded;
    if (loaded.remainingSeconds <= 0) {
      await recordSecurityEvent({
        collections,
        ownerUserId: input.ownerUserId,
        sessionId: null,
        eventType: "mining_rejected",
        outcome: "failure",
        correlationId: input.correlationId,
        metadata: { reason: "quota_exhausted", scope: "device" },
      }).catch(() => undefined);
      throw conflict("mining_quota_exhausted", "The 10-hour daily mining quota for this device is exhausted. Try again after the 24-hour window resets.");
    }
  }
  const allowedSeconds = allowedSessionSeconds({
    accountRemainingSeconds: accountQuota.remainingSeconds,
    deviceRemainingSeconds: deviceQuota?.remainingSeconds ?? null,
    accountWindowRemainingSeconds: accountQuota.windowRemainingSeconds,
    deviceWindowRemainingSeconds: deviceQuota?.windowRemainingSeconds ?? null,
  });
  if (allowedSeconds <= 0) {
    await recordSecurityEvent({
      collections,
      ownerUserId: input.ownerUserId,
      sessionId: null,
      eventType: "mining_rejected",
      outcome: "failure",
      correlationId: input.correlationId,
      metadata: { reason: "quota_exhausted", scope: "window" },
    }).catch(() => undefined);
    throw conflict("mining_quota_exhausted", "The daily mining quota window has ended. Try again in the next 24-hour window.");
  }
  // Defense in depth behind the boot-time config validation: never open a segment
  // whose total cannot be posted through the ledger. A bad rate fails the start
  // instead of stranding an unsettleable active segment. Zero-total micro-segments
  // (a few seconds left at the minimum rate) are allowed: they accrue nothing and
  // close without a journal write, so nothing strands.
  const startedAtMs = quotaNowMs;
  const endsAtMs = startedAtMs + allowedSeconds * 1000;
  const segmentTotalMinor = totalAccrualMinor(
    { rateUnits, rateScale: mining.rate.scale },
    { startedAtMs, endsAtMs, durationSeconds: allowedSeconds },
  );
  if (segmentTotalMinor > LEDGER_AMOUNT_MAX_MINOR) {
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
    poolId: poolDef.id,
    walletId: wallet.publicId,
    ledgerAccountId: walletAccount.publicId,
    status: "active",
    cycleNumber: (previous?.cycleNumber ?? 0) + 1,
    startedAt: quotaNow,
    endsAt: new Date(endsAtMs),
    durationSeconds: allowedSeconds,
    accountWindowStart: new Date(accountQuota.windowStartMs),
    deviceQuotaKey,
    deviceWindowStart: deviceQuota && deviceQuotaKey ? new Date(deviceQuota.windowStartMs) : null,
    deviceId: resolvedDevicePublicId,
    rateUnits,
    rateScale: mining.rate.scale,
    rateDecimals: mining.rate.decimals,
    rate: rateToString(rateUnits, mining.rate.scale, mining.rate.decimals),
    rateUnit: "LMA/hour",
    settledMinor: 0,
    settlementSequence: 0,
    lastSettledAt: null,
    createdAt: quotaNow,
    updatedAt: quotaNow,
  };

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
    const mongoSession: ClientSession = input.mongoClient.startSession();
    try {
      await mongoSession.withTransaction(
        async () => {
          await collections.miningSessions.insertOne({ _id: new ObjectId(), ...session } as MiningSessionRecord, { session: mongoSession });
          await insertLeaseInSession({
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
        const converged = await getMiningState({ collections, config, ownerUserId: input.ownerUserId, cache: input.cache, membershipCache: input.membershipCache });
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
        const converged = await getMiningState({ collections, config, ownerUserId: input.ownerUserId, cache: input.cache, membershipCache: input.membershipCache });
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
    await creditGrantedStart({
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
    metadata: { sessionId: session.publicId, cycleNumber: session.cycleNumber, rate: session.rate, endsAt: session.endsAt.toISOString(), poolId: poolDef.id },
  });

  return getMiningState({ collections, config, ownerUserId: input.ownerUserId, cache: input.cache, membershipCache: input.membershipCache });
}
