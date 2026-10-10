import { randomUUID } from "node:crypto";
import { ObjectId, type ClientSession, type MongoClient } from "mongodb";
import type { Collections } from "../../infrastructure/mongodb/collections.js";
import type { AppConfig } from "../../config/env.js";
import { logAuditFailure, recordSecurityEvent } from "../security/audit.js";
import { pickRateUnits, rateToString, totalAccrualMinor } from "./rate.js";
import { loadMiningSettings } from "./settings.js";
import { invalidate, poolMembershipKey, type CacheContext } from "../../infrastructure/redis/cache.js";
import { badRequest, conflict, forbidden, serviceUnavailable } from "../../shared/errors.js";
import {
  DEVICE_EVIDENCE_MISSING_CODE,
  DEVICE_EVIDENCE_MISSING_MESSAGE,
  DEVICE_IN_USE_CODE,
  DEVICE_IN_USE_MESSAGE,
  DEVICE_NETWORK_IN_USE_CODE,
  DEVICE_NETWORK_IN_USE_MESSAGE,
  LMDG_EVENT_TYPES,
} from "../mining-device/policy.js";
import { LEDGER_AMOUNT_MAX_MINOR } from "../../shared/types.js";
import { isDuplicateKeyError } from "../../shared/mongo-retry.js";
import { allowedSessionSeconds } from "./quota.js";
import { loadAccountQuota, loadDeviceQuota } from "./quota-store.js";
import { deviceQuotaKeyFor } from "./quota.js";
import { applyPoolFactor, drawPoolFactorBps, extendPoolHoldToCycle, getPoolById, isLiveMembership } from "./pools.js";
import {
  buildFeatureMap,
  ipHash,
  machineFeatureMap,
  machineKeyHash,
} from "../mining-device/identity.js";
import { normalizeSignals, sanitizeEvidence } from "../mining-device/signals.js";
import { isNetworkResident } from "../mining-device/enrollment.js";
import { networkLockKeyFor } from "../mining-device/lease.js";
import { revalidateMiningLease } from "../mining-device/admission.js";
import { enforceMiningAttempt } from "../mining-device/attempts.js";
import type { DeviceResolution } from "../mining-device/resolution.js";
import { beginMiningAdmission, endMiningAdmission, retainMiningAdmission, findRunningMiningAccount, prepareMiningNetworkFence } from "../../infrastructure/mongodb/mining-admission.js";
import {
  assessMiningStart,
  creditGrantedStart,
  insertLeaseInSession,
  resolveIpIntel,
  resolveOrCreateDevice,
} from "../mining-device/service.js";
import { findLiveLeases, findLiveLeasesOnNetwork, releaseInactiveLeases } from "../mining-device/repository.js";
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

  if (config.lmdg.enabled) await enforceMiningAttempt(collections, input.ownerUserId, "start");

  const { wallet, walletAccount } = await loadWalletAndAccount(collections, input.ownerUserId);

  // Pool gate: mining is only possible from inside one of the two system pools, and only while the
  // room is actually held — a hold whose deadline passed (a cycle that ended, or a join nobody
  // started from) is not a membership, so it can never open a cycle.
  const membership = await collections.miningPoolMembers.findOne({ ownerUserId: input.ownerUserId });
  if (!membership || !isLiveMembership(membership, Date.now())) {
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
    const bound = await loadWalletAndAccount(collections, input.ownerUserId, active.walletId, active.ledgerAccountId);
    const closed = await settleSession({ collections, mongoClient: input.mongoClient, config: { ...config, ...poolsLive }, session: active, ...bound, correlationId: input.correlationId });
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
  let leaseResolution: DeviceResolution | null = null;
  let comparedDeviceIds: string[] = [];
  // The reserved per-network lease key this start takes to serialize the network admission decision
  // (null when it takes none: no leases, a resident of the network, or an unobserved peer address).
  let networkLockKey: string | null = null;
  // The server-observed network hash of this start, kept for the duplicate-key classification below.
  let startNetworkHash: string | null = null;
  // The device cluster this start resolves to, credited with one admission once the cycle commits.
  let creditDeviceId: string | null = null;
  // Canonical subject of the shared 10h device quota. Hoisted so the quota intersection below sees
  // the same identity admission was assessed on — including in monitor mode, where no lease is
  // taken: the quota binds the machine whether or not the lease was enforced.
  //
  // It is the cluster's *immutable* machine anchor, never `resolution.machineKey`. The two differ
  // as soon as a machine's reported traits drift: resolution still converges on the existing
  // record, but its machine key for this observation is a new value, and keying the quota on it
  // would let a second account start on a fresh allowance while the first account's stopped
  // segment sat under the old key — one machine mining 20 hours in one window.
  //
  // A near clone (`resolution.quotaAnchor`) matched a known machine strongly enough to be that
  // machine with edited hardware slots but was *not* merged into it, so its own anchor would start a
  // second window next to the matched machine's. The matched machine's anchor wins there: accounts
  // alternating on one machine share one allowance whether or not a slot was edited between them.
  let deviceQuotaSubject: string | null = null;
  // The resolved cluster id, stored on the segment as `deviceId`. Null when no cluster was resolved
  // (guard off, or no evidence supplied): the quota can still bind by machine identity alone.
  let resolvedDevicePublicId: string | null = null;
  let pendingAdmissionDeviceId: string | null = null;
  try {
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
    // Require machine evidence before registration or network calls. A caller can generate any
    // number of browser keys; possession of a new key must never substitute for missing or masked
    // machine evidence. Refusing a start here creates no cluster, lease, quota or account block.
    const preEvidence = sanitizeEvidence(input.device.evidenceRaw);
    const preSignals = normalizeSignals(preEvidence);
    const preMachineKey = machineKeyHash(config.encryptionKey, machineFeatureMap(buildFeatureMap(preSignals)));
    if (preMachineKey === null) {
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
    const intel = await resolveIpIntel({ config, ip: input.device.ip });
    const resolution = await resolveOrCreateDevice({
      collections,
      config,
      evidenceRaw: input.device.evidenceRaw,
      ip: input.device.ip,
      intel,
      ownerUserId: input.ownerUserId,
      correlationId: input.correlationId,
    });
    resolvedDevicePublicId = resolution.device.publicId;
    await beginMiningAdmission(collections, resolvedDevicePublicId);
    pendingAdmissionDeviceId = resolvedDevicePublicId;
    // The quota subject is the cluster's anchor — the server-owned machine digest written once at
    // enrollment and never rewritten — falling back to the record's current machine key for rows
    // written before the anchor existed, then to the cluster id for a browser-only identity.
    deviceQuotaSubject =
      resolution.quotaAnchor ??
      deviceQuotaKeyFor(
        resolution.device.anchorHash ?? resolution.device.machineKeyHash ?? null,
        resolution.device.publicId,
      );
    // Defense in depth: the post-resolution check below repeats the same refusal on the resolved
    // identities, in case sanitization and resolution ever disagree about what counts as evidence.
    if (resolution.machineKey === null) {
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
        throw forbidden("mining_device_rejected", "Mining could not pass the device security checks. Your account remains available; try again later or use a browser that exposes device information.");
      }
      if (eligibility.decision === "challenge") {
        throw conflict("mining_device_challenge_required", "Additional device verification is required before mining can start.");
      }
      leaseKeys = eligibility.equivalentLeaseKeys;
      leaseDeviceId = eligibility.device.publicId;
      leaseResolution = resolution;
      comparedDeviceIds = eligibility.comparedDeviceIds ?? [];
      // Serialize the network admission decision: a non-resident start leases the reserved network
      // token, so a second fresh identity racing on this network collides on the unique active-lease
      // index instead of passing the pre-transaction check before the winner commits. Residents are
      // exempt here exactly as they are exempt from the rule itself (see ENROLL-C).
      if (config.lmdg.networkLeaseLock && leaseKeys.length > 0 && input.device?.ip) {
        const networkHash = ipHash(config.encryptionKey, input.device.ip);
        startNetworkHash = networkHash;
        if (networkHash && !isNetworkResident(eligibility.device, networkHash, config.lmdg, Date.now())) {
          networkLockKey = networkLockKeyFor(networkHash);
        }
      }
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
    // Monitor mode deliberately clears the lease keys above, but it must not clear the quota
    // subject: the device quota is an economic limit, not an admission rule, so it binds the
    // machine even when the lease it would have taken is skipped. Nothing to re-read here —
    // `eligibility.device` is `resolution.device`, so the subject set after resolution stands.
  } else if (input.device) {
    // The admission guard is switched off (`LMDG_ENABLED=false` / `LMDG_DEVICE_LEASE_ENABLED=false`).
    // That is the operational escape hatch for admission control, and it must not double as a
    // switch for the per-device quota: turning the guard off would otherwise silently lift the
    // 10h machine limit along with the lease, and store a null quota key on every segment.
    //
    // The identity is therefore derived straight from the sanitized evidence — pure arithmetic, no
    // registration, no observation, no enrollment budget, so the escape hatch keeps working and a
    // start cannot be refused by device machinery that was switched off. Only the machine-key case
    // is covered: without resolution there is no cluster to fall back to, so evidence carrying too
    // few machine traits leaves the account-only quota (the documented browser-only degradation).
    const guardOffSignals = normalizeSignals(sanitizeEvidence(input.device.evidenceRaw));
    deviceQuotaSubject = machineKeyHash(config.encryptionKey, machineFeatureMap(buildFeatureMap(guardOffSignals)));
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
  if (deviceQuotaSubject !== null) {
    deviceQuotaKey = deviceQuotaSubject;
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
    // Atomic commit: the cycle and its device lease land together or not at all. The partial
    // unique index on active leases is the concurrency lock — two accounts racing on one device
    // cannot both insert; the loser maps to the dedicated rejection code below. The network token is
    // part of the same insert, so it serializes racing starts on one network the same way.
    const assessedLeaseKeys = leaseKeys;
    if (startNetworkHash) await prepareMiningNetworkFence(collections, startNetworkHash);
    const mongoSession: ClientSession = input.mongoClient.startSession();
    let attempts = 0;
    try {
      const created = await mongoSession.withTransaction(
        async () => {
          if (++attempts > 5) throw serviceUnavailable("mining_start_busy", "Mining admission is busy. Try again.");
          // Re-check convergence before every retry. A competing request from this account may
          // already have committed; it must not spend retries on fences or credit another start.
          if (await findRunningMiningAccount(collections, input.ownerUserId, mongoSession)) return false;
          // The driver retries aborted transactions with a new snapshot. Never reuse the earlier
          // admission's candidate set: a concurrent first enrollment may have been invisible then.
          if (leaseResolution) {
            const refreshed = await revalidateMiningLease({
              collections, config, ownerUserId: input.ownerUserId, resolution: leaseResolution, mongoSession,
              assessedLeaseKeys, comparedDeviceIds, networkHash: startNetworkHash, leaseEndsAt: session.endsAt,
            });
            leaseKeys = refreshed.leaseKeys;
            networkLockKey = refreshed.networkLockKey;
          }
          const transactionLeaseKeys = networkLockKey === null ? leaseKeys : [...leaseKeys, networkLockKey];
          await releaseInactiveLeases(collections, transactionLeaseKeys, Date.now(), mongoSession);
          await collections.miningSessions.insertOne({ _id: new ObjectId(), ...session } as MiningSessionRecord, { session: mongoSession });
          await insertLeaseInSession({
            collections,
            leaseKeys: transactionLeaseKeys,
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
          return true;
        },
        // Driver 7.6 CSOT adds maxTimeMS to ordinary getMore commands, which MongoDB 8.0 rejects.
        // Bound callback attempts above and commit time here without breaking paged cursor reads.
        { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" }, maxCommitTimeMS: 5_000 },
      );
      if (!created) return getMiningState({ collections, config, ownerUserId: input.ownerUserId, cache: input.cache, membershipCache: input.membershipCache });
    } catch (error) {
      if (attempts > 5) {
        // The retry budget includes failed first reads. Converge outside the aborted transaction
        // if this account's other request committed while those attempts were contending.
        const converged = await getMiningState({ collections, config, ownerUserId: input.ownerUserId, cache: input.cache, membershipCache: input.membershipCache });
        if (converged.status === "active") return converged;
        // Another account may have won the same identities. Report the committed conflict
        // after aborting, rather than asking this caller to retry an already occupied device.
        const foreign = (await findLiveLeases(collections, leaseKeys, Date.now())).find((entry) => entry.ownerUserId !== input.ownerUserId);
        if (foreign) throw conflict(DEVICE_IN_USE_CODE, DEVICE_IN_USE_MESSAGE);
      }
      if (isDuplicateKeyError(error)) {
        // Distinguish the loser's cause: a lease conflict means another account holds this
        // device; otherwise it was this account's own concurrent start converging.
        const lease = (await findLiveLeases(collections, leaseKeys, Date.now())).find((entry) => entry.ownerUserId !== input.ownerUserId);
        if (lease) {
          throw conflict(DEVICE_IN_USE_CODE, DEVICE_IN_USE_MESSAGE);
        }
        // The loser of the network serialization is refused with the network code: another identity
        // committed a live cycle on this network while this start was in flight, which the
        // pre-transaction check could not see.
        if (networkLockKey !== null && startNetworkHash !== null) {
          const foreignNetworkLease = (await findLiveLeasesOnNetwork(collections, startNetworkHash, Date.now())).find(
            (entry) => entry.ownerUserId !== input.ownerUserId,
          );
          if (foreignNetworkLease) {
            await recordSecurityEvent({
              collections,
              ownerUserId: input.ownerUserId,
              sessionId: null,
              eventType: LMDG_EVENT_TYPES.networkInUse,
              outcome: "failure",
              correlationId: input.correlationId,
              metadata: { deviceId: leaseDeviceId, reason: "network_lease_race" },
            }).catch(() => undefined);
            throw conflict(DEVICE_NETWORK_IN_USE_CODE, DEVICE_NETWORK_IN_USE_MESSAGE);
          }
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
      // Monitor-only starts have no lease transaction; publish conservatively before the insert.
      if (pendingAdmissionDeviceId) await retainMiningAdmission(collections, pendingAdmissionDeviceId, session.endsAt);
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

  // The cycle is committed: the room it started in is held for exactly as long as the cycle runs.
  // From here the hold's deadline is the cycle's end, so the room is released — by every reader at
  // once — the moment mining stops, and the TTL index reaps the row behind it. Never fails the
  // committed request, but never disappears either: logged, and the hold then falls back to the
  // join grace it was created with.
  //
  // The extension is a compare-and-set against the room this cycle started in: a concurrent leave
  // or switch that released or moved the hold after the gate's check matches no row. That miss is
  // reported (log and security event) rather than left silent — the cycle is running while its room
  // is absent or belongs to a different pool, which the next join, stop or state read must be able
  // to explain.
  await extendPoolHoldToCycle({
    collections,
    ownerUserId: input.ownerUserId,
    poolId: poolDef.id,
    endsAt: session.endsAt,
  })
    .then(async (extended) => {
      const handle = input.membershipCache?.redis ?? input.cache?.redis;
      if (handle) await invalidate(handle, poolMembershipKey(handle, input.ownerUserId));
      if (!extended) {
        console.error(`[mining] pool hold not extended for session ${session.publicId}: hold released or moved before the extension`);
        await recordSecurityEvent({
          collections,
          ownerUserId: input.ownerUserId,
          sessionId: null,
          eventType: "mining_started",
          outcome: "failure",
          correlationId: input.correlationId,
          metadata: { reason: "pool_hold_not_extended", sessionId: session.publicId, poolId: poolDef.id },
        }).catch((error: unknown) => logAuditFailure("mining_started", error));
      }
    })
    .catch((error) => {
      console.error(`[mining] pool hold not extended for session ${session.publicId}:`, error);
    });

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

  // The cycle and its lease are already committed: the success audit write must never turn a start
  // that happened into an error. Reporting a failure here would leave the customer with an error
  // for a cycle that is running (their next attempt then reads `mining_cycle_active`), which is the
  // exact shape a first-time user reports as "mining is broken". The same `.catch` discipline the
  // rest of this service applies to audit writes applies here; the loss is logged, not silent.
  await recordSecurityEvent({
    collections,
    ownerUserId: input.ownerUserId,
    sessionId: null,
    eventType: "mining_started",
    outcome: "success",
    correlationId: input.correlationId,
    metadata: { sessionId: session.publicId, cycleNumber: session.cycleNumber, rate: session.rate, endsAt: session.endsAt.toISOString(), poolId: poolDef.id },
  }).catch((error) => {
    console.error(`[mining] start audit not written for session ${session.publicId}:`, error);
  });

  return getMiningState({ collections, config, ownerUserId: input.ownerUserId, cache: input.cache, membershipCache: input.membershipCache });
  } finally {
    if (pendingAdmissionDeviceId) {
      // A failed release leaves extra comparisons, never invisible live work or a false success.
      await endMiningAdmission(collections, pendingAdmissionDeviceId)
        .catch(() => console.error("[lmdg] admission reference retained after cleanup failure"));
    }
  }
}
