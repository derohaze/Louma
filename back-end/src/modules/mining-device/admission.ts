import type { AppConfig } from "../../config/env.js";
import type { Collections } from "../../infrastructure/mongodb/collections.js";
import type { MiningDeviceRecord } from "../../shared/types.js";
import { recordSecurityEvent } from "../security/audit.js";
import {
  decideClusterMatch,
  ipHash,
  isPresentationFeature,
  isRenderingFeature,
  matchDeviceFeatures,
  type ClusterMatch,
  type ClusterVerdict,
} from "./identity.js";
import { detectImpossibleUaPlatform } from "./signals.js";
import { evaluateMiningDeviceTrust, type RiskDecision } from "./risk.js";
import {
  DEVICE_NETWORK_IN_USE_CODE,
  LIVE_LEASE_BACKSTOP_LIMIT,
  LMDG_EVENT_TYPES,
} from "./policy.js";
import {
  networkTrustEstablished,
  networkTrustFresh,
  networkTrustOf,
  recentClusterChurn,
} from "./enrollment.js";
import { detectEvidenceContradictions, detectSimultaneousTraitReplacement, isEnvironmentFeatureKey } from "./consistency.js";
import {
  findLiveLeases,
  findLiveLeasesOnNetwork,
  listClusterCandidates,
} from "./repository.js";
import { recordLeaseKeys, toCandidate, type DeviceResolution } from "./resolution.js";
import { recordDeviceObservation, recordDeviceSeen } from "./observation.js";
import { p256KeyFingerprint } from "./proof.js";
import type { IpIntel } from "./ip-intel.js";

export interface StartEligibility {
  decision: RiskDecision;
  reasonCode: string;
  confidence: number;
  riskScore: number;
  device: MiningDeviceRecord;
  /**
   * Every device identity this start must lease: the resolved record's key hash plus the key hashes
   * of its exact duplicates, so a racing start cannot lease a duplicate row and open a second cycle.
   */
  equivalentLeaseKeys: string[];  conflictingLeaseOwner: string | null;
}

export async function assessMiningStart(input: {
  collections: Collections;
  config: Pick<AppConfig, "encryptionKey" | "lmdg">;
  ownerUserId: string;
  resolution: DeviceResolution;
  correlationId: string;
  ip: string | null;
  intel: IpIntel;
  nowMs?: number;
}): Promise<StartEligibility> {
  const { collections, config } = input;
  const nowMs = input.nowMs ?? Date.now();
  const { device, evidence } = input.resolution;

  if (device.status === "blocked") {
    return { decision: "deny", reasonCode: "device_blocked", confidence: 1, riskScore: 100, device, equivalentLeaseKeys: [], conflictingLeaseOwner: null };
  }
  // Server-owned trust state of the cluster this start resolves to. It comes from the record, not
  // from the payload: a fresh identity is `provisional` no matter how convincing its evidence is.
  const trustState = input.resolution.trustState;
  // The network context of this request — a keyed hash of the server-observed peer address. It is
  // supporting evidence only: it can gate *new* identities and add risk, and it never names a
  // machine.
  const networkHash = input.ip ? ipHash(config.encryptionKey, input.ip) : null;
  // Contradictions inside this single observation (impossible values, UA/platform conflicts).
  const consistencyFlags = detectEvidenceContradictions(evidence);

  // The machine identity this observation resolves to: what a lease is taken on. The conflict check
  // below is deliberately independent of any similarity score — the identity is derived from machine
  // traits, so a client that edits its user agent to "look like a different machine" still collides
  // here with the lease the other account holds.
  const ownLeaseKeys = input.resolution.equivalentLeaseKeys;
  const machineKey = input.resolution.machineKey;
  // Direct conflict: this identity (or a browser identity the same record is known by) already
  // leases an unexpired cycle owned by another account.
  const direct = (await findLiveLeases(collections, ownLeaseKeys, nowMs)).find((lease) => lease.ownerUserId !== input.ownerUserId) ?? null;
  if (direct) {
    await recordSecurityEvent({
      collections, ownerUserId: input.ownerUserId, sessionId: null,
      eventType: LMDG_EVENT_TYPES.conflict, outcome: "failure", correlationId: input.correlationId,
      metadata: { deviceId: device.publicId, reason: "device_lease_active" },
    }).catch(() => undefined);
    // The denial is still an observation of this account on this device, and the accumulated
    // history is what makes a repeat attempt riskier than the first.
    await recordDeviceObservation({
      collections, secret: config.encryptionKey, device, ownerUserId: input.ownerUserId, ip: input.ip, intel: input.intel, nowMs, riskScore: 70, decision: "deny",
    });
    return { decision: "deny", reasonCode: "device_lease_active", confidence: 0.95, riskScore: 70, device, equivalentLeaseKeys: ownLeaseKeys, conflictingLeaseOwner: direct.ownerUserId };
  }

  // Cross-browser / cross-profile check over the recent device population.
  //
  // A candidate carrying the same machine key is the same machine outright — that verdict is
  // identity, not similarity, so no client-side string editing moves it. The weighted match stays as
  // the fallback for a machine whose *browser* traits drifted (a privacy browser randomizes the
  // rendering stack) and for records written before the machine key existed. Network traits carry no
  // weight in the feature model, so a different machine on the same Wi-Fi scores low and passes.
  const sweep = await listClusterCandidates(collections, {});
  // Live-lease backstop: the fuzzy sweep compares only the most recently seen records, so a
  // still-mining device that fell behind newer records — and whose machine traits and browser key
  // have since changed — would drop out of the comparison and its active lease would be missed.
  // The newest live leases are therefore pulled in explicitly, and they are resolved by both the
  // lease's identity key and its device record id, so a machine whose newly reported traits changed
  // its direct key still has its old lease compared instead of silently mining twice.
  //
  // This is a bounded, best-effort *similarity* backstop, capped rather than proportional to the
  // whole active mining population (see `LIVE_LEASE_BACKSTOP_LIMIT`): the exact guarantees are the
  // identity checks above (a lease on any identity this observation produces, or that its record is
  // known by) and the per-network lease query below, both of which are indexed and complete.
  const liveLeaseFilter = { status: "active", leaseEndsAt: { $gt: new Date(nowMs) } } as const;
  // One row past the cap answers "was the comparison complete?" without a second query: the newest
  // `LIVE_LEASE_BACKSTOP_LIMIT` leases are compared, and a row beyond them flags the residual gap
  // (see `leaseBackstopTruncated` in the risk input).
  const liveLeases = await collections.miningDeviceLeases
    .find(liveLeaseFilter, { projection: { deviceClusterId: 1, deviceId: 1 } })
    .sort({ leasedAt: -1 })
    .limit(LIVE_LEASE_BACKSTOP_LIMIT + 1)
    .toArray()
    .catch(() => []);
  const leaseBackstopTruncated = liveLeases.length > LIVE_LEASE_BACKSTOP_LIMIT;
  const comparedLeases = liveLeases.slice(0, LIVE_LEASE_BACKSTOP_LIMIT);
  const liveLeaseKeys = [...new Set(comparedLeases.map((lease) => lease.deviceClusterId))].filter(Boolean);
  const liveDeviceIds = [...new Set(comparedLeases.map((lease) => lease.deviceId))].filter(
    (value): value is string => typeof value === "string" && value.length > 0,
  );
  const knownIds = new Set(sweep.map((entry) => entry.publicId));
  const leasedRecords = liveLeaseKeys.length === 0 && liveDeviceIds.length === 0
    ? []
    : await collections.miningDevices
        .find({ $or: [{ publicId: { $in: liveDeviceIds } }, { machineKeyHash: { $in: liveLeaseKeys } }, { deviceKeyHash: { $in: liveLeaseKeys } }] })
        .toArray()
        .catch(() => []);
  for (const entry of leasedRecords) {
    if (!knownIds.has(entry.publicId)) {
      sweep.push(entry);
      knownIds.add(entry.publicId);
    }
  }
  const sameClusterKeys: string[] = [];
  const ambiguousClusterKeys: string[] = [];
  let bestScore = input.resolution.match.score;
  // "A trait this machine used to report is now hidden" is only meaningful against a machine we
  // actually matched, never against an unrelated candidate that happens to own a WebGL digest.
  let missingHighEntropyFields = false;
  // The best-correlating machine we already knew, kept so the risk engine can say *why* this
  // observation looks like a known device rather than a new one.
  let knownMachine: ClusterMatch | null = null;
  let knownMachineIsIdentity = false;
  let knownMachineScore = -1;
  for (const candidate of sweep) {
    if (candidate.publicId === device.publicId) continue;
    const match = matchDeviceFeatures(toCandidate(candidate), input.resolution.observed, config.encryptionKey);
    const identityMatch = machineKey !== null && candidate.machineKeyHash === machineKey;
    const score = identityMatch ? 100 : match.score;
    if (score > bestScore) bestScore = score;
    if (score > knownMachineScore) {
      knownMachine = match;
      knownMachineIsIdentity = identityMatch;
      knownMachineScore = score;
    }
    const keys = recordLeaseKeys(candidate);
    const verdict = identityMatch ? "same" : decideClusterMatch(match, config.lmdg.highConfidenceThreshold, config.lmdg.ambiguousThreshold);
    if (verdict === "same") {
      sameClusterKeys.push(...keys);
      if (match.missingHighEntropy) missingHighEntropyFields = true;
    } else if (verdict === "ambiguous") {
      ambiguousClusterKeys.push(...keys);
    }
  }
  // Every identity this machine is known by must be leased together, so a start that raced ours (or
  // one holding a lease an earlier build took on the browser key) cannot open a second cycle.
  const equivalentLeaseKeys = [...new Set([...ownLeaseKeys, ...sameClusterKeys])];
  // Network-scoped evidence: whether another account is already mining from this network, read
  // directly from the live leases (each carries the network its cycle was taken on), so the answer
  // is complete regardless of how many device records were seen there or how recently. Then: has
  // *this* cluster itself mined on this network, recently enough to be a resident of it.
  const ownKeySet = new Set(equivalentLeaseKeys);
  const networkLeases = networkHash ? await findLiveLeasesOnNetwork(collections, networkHash, nowMs) : [];
  const foreignNetworkLease =
    networkLeases.find(
      (lease) => lease.ownerUserId !== input.ownerUserId && !ownKeySet.has(lease.deviceClusterId) && lease.deviceId !== device.publicId,
    ) ?? null;
  const networkTrust = networkHash ? networkTrustOf(device, networkHash) : null;
  const networkResident = Boolean(
    networkTrust &&
      networkTrustEstablished(networkTrust, config.lmdg.establishMinAdmissions) &&
      networkTrustFresh(networkTrust, nowMs, config.lmdg.networkTrustFreshnessSeconds * 1000),
  );
  // A satisfied proof-of-possession this start can present, bound to this cluster (see
  // `verifyProof` and `findBoundProof`). Computed lazily and memoised: it costs two indexed reads
  // and is only ever consulted when a browser key is actually presented — by the risk-challenge
  // conversion below, never by the network rule.
  let boundProofCache: boolean | null = null;
  const hasBoundProof = async (): Promise<boolean> => {
    if (!evidence.browserKeyPublicKey) return false;
    if (boundProofCache === null) boundProofCache = await findBoundProof();
    return boundProofCache;
  };
  // Network admission rule. A machine identity that has not earned server-owned trust *on this
  // network*, appearing on a network where another account already holds a live lease, is the exact
  // shape of "same physical environment, second identity" — and it is refused outright.
  //
  // This rule is deliberately NOT satisfiable by a proof of possession, and that is the whole point
  // of it. A browser key proves continuity of a *storage context*, and an attacker can generate as
  // many as it likes; when a fresh key answering the challenge cleared this rule, the attack was
  // "forge M2, prove possession of your own new key, retry" and it produced a second parallel mining
  // cycle from one network (measured). Proof therefore never converts this rule into an allow.
  //
  // The exemption is not the cluster's global trust state either — that was the *next* bypass:
  // trust is network- and time-bound. A cluster is a resident of a network only if it committed
  // admissions or proofs *on that network*, at (or near) its establishment threshold, within the
  // freshness window. Its credits are written by `creditGrantedStart` after a session and lease
  // commit, never by a burst of assessed requests, so an attacker cannot mint `established` while no
  // cycle runs and then surface next to another account's live cycle: the identity must have mined
  // here, repeatedly, recently. A device that has never mined on this network waits for the cycle to
  // end — the one case browser-only evidence cannot distinguish from a forged identity, and the
  // honest price of a hard one-environment rule.
  if (config.lmdg.networkLeaseLock && !networkResident && foreignNetworkLease) {
    await recordSecurityEvent({
      collections, ownerUserId: input.ownerUserId, sessionId: null,
      eventType: LMDG_EVENT_TYPES.networkInUse, outcome: "failure", correlationId: input.correlationId,
      metadata: { deviceId: device.publicId, reason: "network_lease_active", trustState, networkResident, hadBrowserKey: Boolean(evidence.browserKeyPublicKey) },
    }).catch(() => undefined);
    // A refused start is still an observation of this account on this device — the accumulated history
    // is what makes a repeat attempt riskier than the first — but it is recorded as a refusal, so it
    // can never feed the trusted baseline.
    await recordDeviceObservation({
      collections, secret: config.encryptionKey, device, ownerUserId: input.ownerUserId, ip: input.ip, intel: input.intel, nowMs, riskScore: 60, decision: "deny",
    });
    return { decision: "deny", reasonCode: DEVICE_NETWORK_IN_USE_CODE, confidence: 0.8, riskScore: 60, device, equivalentLeaseKeys, conflictingLeaseOwner: foreignNetworkLease.ownerUserId };
  }
  if (sameClusterKeys.length > 0) {
    const conflicts = await findLiveLeases(collections, sameClusterKeys, nowMs);
    const foreign = conflicts.find((lease) => lease.ownerUserId !== input.ownerUserId);
    if (foreign) {
      await recordSecurityEvent({
        collections, ownerUserId: input.ownerUserId, sessionId: null,
        eventType: LMDG_EVENT_TYPES.conflict, outcome: "failure", correlationId: input.correlationId,
        metadata: { deviceId: device.publicId, reason: "device_cluster_lease_active" },
      }).catch(() => undefined);
      return { decision: "deny", reasonCode: "device_lease_active", confidence: 0.85, riskScore: 65, device, equivalentLeaseKeys, conflictingLeaseOwner: foreign.ownerUserId };
    }
  }
  // Ambiguous correlation against a live foreign lease: the configurable risk policy decides.
  // Enforce denies (one lease per device cluster wins over uncertainty); challenge asks for
  // proof-of-possession; monitor logs and allows. The API code stays the dedicated device code.
  if (ambiguousClusterKeys.length > 0) {
    const conflicts = await findLiveLeases(collections, ambiguousClusterKeys, nowMs);
    const foreign = conflicts.find((lease) => lease.ownerUserId !== input.ownerUserId);
    if (foreign) {
      await recordSecurityEvent({
        collections, ownerUserId: input.ownerUserId, sessionId: null,
        eventType: LMDG_EVENT_TYPES.conflict, outcome: "failure", correlationId: input.correlationId,
        metadata: { deviceId: device.publicId, reason: "device_cluster_lease_ambiguous" },
      }).catch(() => undefined);
      if (config.lmdg.riskMode === "monitor") {
        // Fall through to the risk evaluation below (allows with an audit trail above).
      } else if (config.lmdg.riskMode === "challenge") {
        return { decision: "challenge", reasonCode: "device_cluster_lease_ambiguous", confidence: 0.6, riskScore: 55, device, equivalentLeaseKeys: [], conflictingLeaseOwner: foreign.ownerUserId };
      } else {
        return { decision: "deny", reasonCode: "device_cluster_lease_ambiguous", confidence: 0.7, riskScore: 60, device, equivalentLeaseKeys: [], conflictingLeaseOwner: null };
      }
    }
  }

  // History-backed risk inputs (bounded counts, no raw payloads).
  //
  // `accountsOnDevice` is the evidence this guard exists to accumulate, and it has to be measured
  // across the whole machine cluster rather than against one record: a second browser used to be a
  // second record, so a per-record count could never see the second account and stayed at 1
  // forever. Observations cover the accounts that reported this machine, leases cover the accounts
  // that actually mined on it — including a record a tolerant match left unmerged.
  const windowStart = new Date(nowMs - 30 * 24 * 60 * 60 * 1000);
  const dayStart = new Date(nowMs - 24 * 60 * 60 * 1000);
  const [observedAccounts, leaseAccounts, devicesOnAccount, rejectsOnDevice, rejectsOnAccount, recentIpHashes, recentCountries] = await Promise.all([
    collections.miningDeviceObservations.distinct("ownerUserId", { deviceId: device.publicId, observedAt: { $gt: windowStart } }).catch(() => [] as unknown[]),
    collections.miningDeviceLeases.distinct("ownerUserId", { deviceClusterId: { $in: equivalentLeaseKeys }, leasedAt: { $gt: windowStart } }).catch(() => [] as unknown[]),
    collections.miningDeviceObservations.distinct("deviceId", { ownerUserId: input.ownerUserId, observedAt: { $gt: windowStart } }).then((v) => v.length).catch(() => 1),
    // Scoped to this device: an unscoped count made one conflict anywhere on the platform raise
    // every account's risk score for the following 30 days.
    collections.securityEvents.countDocuments({ eventType: LMDG_EVENT_TYPES.conflict, "metadata.deviceId": device.publicId, createdAt: { $gt: windowStart } }).catch(() => 0),
    collections.securityEvents.countDocuments({ ownerUserId: input.ownerUserId, eventType: LMDG_EVENT_TYPES.conflict, createdAt: { $gt: windowStart } }).catch(() => 0),
    // Network drift over the last day: distinct server-observed IP hashes and countries on this
    // device. Distinct values — not a capped row sample — so a device with more than 50 sampled
    // observations cannot hide earlier IP changes or a country change outside the sample. Legacy
    // rows stored a literal placeholder instead of a hash and collapse to a single value, which
    // can only understate churn, never invent it.
    collections.miningDeviceObservations.distinct("ipHash", { deviceId: device.publicId, observedAt: { $gt: dayStart } }).catch(() => [] as unknown[]),
    collections.miningDeviceObservations.distinct("country", { deviceId: device.publicId, observedAt: { $gt: dayStart } }).catch(() => [] as unknown[]),
  ]);
  const accountsOnDevice = new Set([...observedAccounts, ...leaseAccounts]).size;
  const currentIpHash = networkHash;
  const observedIpHashes = new Set(
    [...(recentIpHashes as unknown[]), currentIpHash].filter((value): value is string => typeof value === "string" && value.length > 0),
  );
  const observedCountries = new Set(
    [...(recentCountries as unknown[]), input.intel.country].filter((value): value is string => typeof value === "string" && value.length > 0),
  );
  const ipChurnDuringCycle = observedIpHashes.size;
  const geoJump = observedCountries.size > 1;

  const verdict: ClusterVerdict =
    input.resolution.verdict === "same" ? "same" : input.resolution.verdict === "ambiguous" ? "ambiguous" : "different";
  const integrity = evidence.integrity;
  // A known device presenting a key it was not carrying before: legitimate when a customer opens a
  // second browser, suspicious when it accompanies an otherwise unrelated account.
  const keyChangedForKnownDevice =
    verdict === "same" &&
    !!evidence.browserKeyPublicKey &&
    !!device.browserKeyPublicKey &&
    device.browserKeyPublicKey !== evidence.browserKeyPublicKey;
  // A machine we already know whose *software description* moved is the shape of a fingerprint
  // changer such as the user-agent switcher used in the observed bypass — not of a new device.
  // Identity is enforced by the machine key above; these only explain the decision.
  let uaChangedForKnownMachine = false;
  let renderingTamperForKnownMachine = false;
  let replacementFlags: string[] = [];
  if (knownMachine !== null && (knownMachineIsIdentity || knownMachine.matchedMachine.length >= 3)) {
    uaChangedForKnownMachine = knownMachine.drifted.some(isPresentationFeature);
    renderingTamperForKnownMachine = knownMachine.drifted.some(isRenderingFeature);
    replacementFlags = detectSimultaneousTraitReplacement({
      driftedKeys: knownMachine.drifted,
      presentationKeys: knownMachine.drifted.filter(isPresentationFeature),
      renderingKeys: knownMachine.drifted.filter(isRenderingFeature),
      environmentKeys: knownMachine.drifted.filter(isEnvironmentFeatureKey),
      browserKeyChanged: keyChangedForKnownDevice,
    });
  }
  // One observation's findings: contradictions inside the payload plus the change-shape against a
  // machine the server already knows. Evidence for the risk engine, never a verdict by itself.
  const findings = [...consistencyFlags, ...replacementFlags];
  const identityChurn = networkHash ? await recentClusterChurn({ collections, ipHash: networkHash, nowMs }) : 0;
  const browserKeyUnverified = !!evidence.browserKeyPublicKey && !(await hasBoundProof());
  const result = evaluateMiningDeviceTrust({
    clusterVerdict: verdict,
    clusterScore: bestScore,
    activeLeaseConflict: false,
    conflictOwnerIsSelf: false,
    deviceBlocked: false,
    browserKeyPresent: !!evidence.browserKeyPublicKey,
    browserKeyRequired: config.lmdg.browserKeyRequired,
    fingerprintConfidence: evidence.fingerprintConfidence,
    webdriver: integrity?.webdriver === true,
    headlessHint: integrity?.headlessHint === true,
    impossibleUaPlatform: integrity?.impossibleUaPlatform === true || detectImpossibleUaPlatform(evidence.userAgent, evidence.platform),
    missingCapabilities: integrity?.missingCapabilities === true,
    missingHighEntropyFields,
    keyChangedForKnownDevice,
    uaChangedForKnownMachine,
    renderingTamperForKnownMachine,
    clusterTrust: trustState,
    identityChurn,
    consistencyFindings: findings.length,
    networkLeaseConflict: foreignNetworkLease !== null,
    leaseBackstopTruncated,
    unverifiedBrowserKey: browserKeyUnverified,
    anonymity: { vpn: input.intel.vpn, proxy: input.intel.proxy, tor: input.intel.tor, hosting: input.intel.hosting, anonymous: input.intel.anonymous },
    history: {
      accountsOnDevice, devicesOnAccount,
      recentRejectsOnDevice: rejectsOnDevice, recentRejectsOnAccount: rejectsOnAccount,
      ipChurnDuringCycle, geoJump,
    },
  });

  // A risk challenge the account already satisfied: a recent proof-of-possession over the same
  // browser key converts the challenge into an allow, so the customer who completed the requested
  // verification is not asked for it again on retry. Lease challenges are never converted — a proof
  // of one's own key cannot free a cycle another account holds.
  //
  // The proof must be bound to *this* start, not just to the account: a proof consumed before the
  // latest risk challenge (e.g. proven while the account looked clean, then reused after a new
  // risk signal) does not convert, and a proof whose nonce names a different device identity does
  // not convert either.
  // Declared as a function (not a const arrow) so the checks above can call it: it is used by the
  // network admission rule and by the challenge conversion below, both of which must see the same
  // binding.
  async function findBoundProof(): Promise<boolean> {
    if (!evidence.browserKeyPublicKey) return false;
    const proofWindow = new Date(nowMs - config.lmdg.challengeTtlSeconds * 1000);
    // Newest first, and a few of them: one browser key can have several consumed proofs inside the
    // window (an earlier one consumed for another enrollment, the one this challenge is asking
    // for). Reading an unordered single row could return the older one, reject it, and leave a
    // properly answered challenge unsatisfied forever.
    const proofs = await collections.miningDeviceNonces
      .find(
        { ownerUserId: input.ownerUserId, verifiedBrowserKey: evidence.browserKeyPublicKey, consumedAt: { $gt: proofWindow } },
        { projection: { consumedAt: 1, deviceKeyHash: 1, boundAnchorHash: 1, boundClusterId: 1, verifiedBrowserKey: 1 }, sort: { consumedAt: -1 }, limit: 5 },
      )
      .toArray()
      .catch(() => []);
    if (proofs.length === 0) return false;
    // Every identity the cluster this start resolved to is known by: a machine key that moved and
    // was accepted as an alias, the latest key it reported, and the immutable anchor. A nonce
    // records the anchor the server resolved when it was *issued*, which is the anchor — while a
    // later start compares the current machine key — so the identity-set check, never a single
    // equality against today's key.
    const knownAnchors = new Set<string>(
      [device.anchorHash, device.machineKeyHash, ...(device.aliasHashes ?? []), input.resolution.machineKey].filter(
        (value): value is string => typeof value === "string" && value.length > 0,
      ),
    );
    // The proof must follow the risk assessment it satisfies: a proof consumed before the latest
    // challenge is stale evidence from an earlier, cleaner-looking session, not an answer to this
    // challenge. (The current decision records its own challenge event below, after this check.)
    const lastChallenge = await collections.securityEvents.findOne(
      { ownerUserId: input.ownerUserId, eventType: LMDG_EVENT_TYPES.challenge },
      { sort: { createdAt: -1 }, projection: { createdAt: 1 } },
    ).catch(() => null);
    const presentedKey = p256KeyFingerprint(evidence.browserKeyPublicKey);
    for (const proof of proofs) {
      if (!proof.consumedAt) continue;
      const boundAnchor = proof.boundAnchorHash ?? null;
      const boundClusterId = proof.boundClusterId ?? null;
      if (boundAnchor !== null) {
        // A nonce bound to a machine identity only satisfies a start on that same identity — and the
        // binding is the *server-resolved* anchor recorded when the challenge was issued, never a key
        // string the client supplied.
        if (!knownAnchors.has(boundAnchor)) continue;
      } else if (boundClusterId !== null) {
        // A cluster with no machine anchor (too few machine traits to derive one) is named by the
        // cluster id and the browser key that resolved it; the proof must be one of that key's.
        if (boundClusterId !== device.publicId) continue;
        if (presentedKey === null || p256KeyFingerprint(proof.verifiedBrowserKey ?? null) !== presentedKey) continue;
      } else {
        // No binding at all (a nonce issued before device evidence was required): it names nothing and
        // satisfies nothing here.
        continue;
      }
      if (lastChallenge && proof.consumedAt.getTime() <= lastChallenge.createdAt.getTime()) continue;
      return true;
    }
    return false;
  }
  let finalDecision = result.decision;
  let finalReasonCode = result.reasonCode;
  let finalConfidence = result.confidence;
  if (result.decision === "challenge" && result.reasonCode === "device_risk_review" && evidence.browserKeyPublicKey) {
    if (await hasBoundProof()) {
      finalDecision = "allow";
      finalReasonCode = "device_verified";
      finalConfidence = 0.75;
    }
  }
  // `LMDG_BROWSER_KEY_REQUIRED` demands proof of possession, not just the presence of a
  // client-supplied key string: an unverified claim with otherwise low-risk evidence must still
  // answer a challenge instead of being allowed on its word.
  if (config.lmdg.browserKeyRequired && evidence.browserKeyPublicKey && finalDecision === "allow") {
    if (!(await hasBoundProof())) {
      finalDecision = "challenge";
      finalReasonCode = "device_risk_review";
      finalConfidence = 0.6;
    }
  }

  // Persist a sampled observation: which account was seen on this device, and what the guard
  // decided. This is the cross-account evidence the risk engine accumulates — it is written on every
  // outcome, including a denial, because a second account trying a device it does not own is exactly
  // the history that has to be on the record.
  await recordDeviceObservation({
    collections,
    secret: config.encryptionKey,
    device,
    ownerUserId: input.ownerUserId,
    ip: input.ip,
    intel: input.intel,
    nowMs,
    riskScore: result.riskScore,
    decision: finalDecision,
  });

  if (finalDecision === "deny" || finalDecision === "challenge") {
    await recordSecurityEvent({
      collections, ownerUserId: input.ownerUserId, sessionId: null,
      eventType: finalDecision === "deny" ? LMDG_EVENT_TYPES.rejected : LMDG_EVENT_TYPES.challenge,
      outcome: "failure", correlationId: input.correlationId,
      metadata: { deviceId: device.publicId, reason: finalReasonCode },
    }).catch(() => undefined);
  }

  // The start was allowed: fold the observation into the record now that the decision is made. A
  // rejected attempt never reaches this line, so it can no longer re-tag the identity or history.
  if (finalDecision === "allow") {
    await recordDeviceSeen(
      collections,
      config.encryptionKey,
      device,
      {
        intel: input.intel,
        ip: input.ip,
        correlationId: input.correlationId,
        // Only an allowed admission may fold findings into the record: a rejected request must not be
        // able to age a cluster or push it toward `suspicious` with fabricated observations. The
        // admission itself is credited later, by the mining service, once the cycle has committed.
        findings,
      },
      input.resolution.observed,
    );
  }

  return { decision: finalDecision, reasonCode: finalReasonCode, confidence: finalConfidence, riskScore: result.riskScore, device, equivalentLeaseKeys, conflictingLeaseOwner: null };
}
