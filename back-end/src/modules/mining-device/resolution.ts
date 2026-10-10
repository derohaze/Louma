import { randomUUID } from "node:crypto";
import { ObjectId } from "mongodb";
import type { AppConfig } from "../../config/env.js";
import type { Collections } from "../../infrastructure/mongodb/collections.js";
import type { MiningDeviceRecord, MiningDeviceTrustState } from "../../shared/types.js";
import { AppError } from "../../shared/errors.js";
import { recordSecurityEvent } from "../security/audit.js";
import {
  buildFeatureMap,
  buildNormalizedVector,
  decideClusterMatch,
  isMachineIdentityMatch,
  deviceKeyHash,
  digestFeatureMap,
  ipHash,
  learnFeatureProfile,
  machineFeatureMap,
  machineKeyHash,
  machineProfileOf,
  matchDeviceFeatures,
  normalizedDeviceSignature,
  visitorIdHash,
  type ClusterMatch,
  type ClusterVerdict,
  type DeviceCandidateFeatures,
  type DeviceFeatureMap,
  type ObservedFeatures,
} from "./identity.js";
import {
  ipFamilyOf,
  normalizeSignals,
  sanitizeEvidence,
  type DeviceEvidence,
  type NormalizedDeviceSignals,
} from "./signals.js";
import {
  DEVICE_ENROLLMENT_LIMITED_CODE,
  DEVICE_ENROLLMENT_LIMITED_MESSAGE,
  LMDG_EVENT_TYPES,
} from "./policy.js";
import {
  consumeEnrollmentBudget,
  trustStateOf,
} from "./enrollment.js";
import {
  findDeviceByAnchor,
  findDeviceByKeyHash,
  findDeviceByPublicKey,
  findDeviceBySignature,
  isDuplicateKeyError,
  listClusterCandidates,
  lookupMachineKey,
} from "./repository.js";
import type { IpIntel } from "./ip-intel.js";
import { admissionEvidence } from "./candidate-evidence.js";
import { requireVerifiedMining } from "./verified-policy.js";

export interface DeviceResolution {
  /** Complete predicate chosen outside the transaction; re-queried inside its fresh snapshot. */
  candidateEvidenceTokens?: string[];
  device: MiningDeviceRecord;
  signature: string;
  vector: string;
  verdict: ClusterVerdict;
  score: number;
  /** The winning weighted comparison (empty for exact continuity matches). */
  match: ClusterMatch;
  /** The observation this resolution was made from, reused by the admission check. */
  observed: ObservedFeatures;
  /**
   * The identity a mining lease is taken on: the machine key when the client reported enough
   * machine traits for one, otherwise the browser-scoped key. Both are secret-keyed hashes.
   */
  leaseKey: string;
  /** The machine key of *this* observation, null when too few machine traits were reported. */
  machineKey: string | null;
  /** Every identity the resolved record itself is known by (machine key and browser key). */
  equivalentLeaseKeys: string[];
  /**
   * The stable anchor of a *known* machine this observation matched as that machine — the near clone
   * band, or the cross-engine pair whose identity slots agree while one engine's own corroborators do
   * not (see `isMachineIdentityMatch`) — without being merged into it; null in every other case.
   *
   * The new record carries its own immutable anchor, so an economic limit keyed on the anchor alone
   * would open a second allowance beside the matched machine's stopped segment — one machine
   * collecting a fresh 10h window per edited hardware slot, or per browser it is opened in. Callers
   * that key such a limit (the shared device quota) use this anchor instead, which keeps one machine
   * to one allowance.
   */
  quotaAnchor: string | null;
  isNew: boolean;
  evidence: DeviceEvidence;
  /** Server-owned trust state of the resolved cluster; never derived from the payload. */
  trustState: MiningDeviceTrustState;
}

/**
 * Placeholder match for the exact-continuity paths (browser key or byte-identical vector). Those
 * paths already prove continuity on their own and never consult `decideClusterMatch`, so the flags
 * carry no meaning there.
 */
function exactMatch(score: number): ClusterMatch {
  return { score, matched: [], drifted: [], matchedMachine: [], machineScore: score, classCompared: [], classDrifted: [], missingHighEntropy: false, matchedGraphics: false };
}

/** No candidate was comparable at all: nothing agreed, so nothing is claimed. */
function noMatch(): ClusterMatch {
  return { score: 0, matched: [], drifted: [], matchedMachine: [], machineScore: 0, classCompared: [], classDrifted: [], missingHighEntropy: false, matchedGraphics: false };
}

export function toCandidate(device: MiningDeviceRecord): DeviceCandidateFeatures {
  return {
    featureProfile: device.featureProfile ?? null,
    featureSnapshot: (device.featureSnapshot as DeviceFeatureMap | null) ?? null,
    browserKeyPublicKey: device.browserKeyPublicKey,
    fingerprintVisitorIdHash: device.fingerprintVisitorIdHash,
  };
}

/** Observed comparable values, in raw form for storage and digested form for matching. */
export function observedFeatures(secret: Buffer, signals: NormalizedDeviceSignals): ObservedFeatures {
  const raw = buildFeatureMap(signals);
  return { raw, digests: digestFeatureMap(secret, raw), machine: machineFeatureMap(raw) };
}

/**
 * The identity keys a stored record is reachable under.
 *
 * The server-owned cluster id comes first: it is the one value no client controls, so a lease on it
 * cannot be walked away from by reporting different traits. The machine key and every alias the
 * server accepted for this cluster follow, because a *different* record presenting the same machine
 * traits must still collide with the lease (that is the anti-multi-cycle property). The immutable
 * enrollment and shared-quota anchors keep already-correlated profiles on that same lock after
 * their reported traits drift. The browser key comes last, because a lease an earlier build took
 * on it must remain enforceable.
 */
export function recordLeaseKeys(device: MiningDeviceRecord): string[] {
  return [
    ...new Set(
      [
        device.publicId,
        device.anchorHash,
        device.quotaAnchorHash,
        device.machineKeyHash,
        ...(device.aliasHashes ?? []),
        device.deviceKeyHash,
      ].filter((key): key is string => Boolean(key)),
    ),
  ];
}

/** The key a lease is taken on: the machine identity, or the browser identity when unavailable. */
function leaseKeyOf(machineKey: string | null, deviceKeyHashValue: string): string {
  return machineKey ?? deviceKeyHashValue;
}

/**
 * Every identity a start on one record must lease.
 *
 * The machine identity comes first (it is the one a user-agent switch, a private window or a cleared
 * profile cannot move), then the browser identity this observation produced, then the identities the
 * record is already known by — so a lease an earlier build took on the browser key still conflicts,
 * and a second start racing on a duplicate record cannot lease the twin instead of the machine.
 */
function leaseKeysOf(machineKey: string | null, device: MiningDeviceRecord, deviceKeyHashValue: string): string[] {
  return [...new Set([device.publicId, leaseKeyOf(machineKey, deviceKeyHashValue), deviceKeyHashValue, ...recordLeaseKeys(device)])];
}

export async function resolveOrCreateDevice(input: {
  collections: Collections;
  config: Pick<AppConfig, "encryptionKey" | "lmdg">;
  evidenceRaw: unknown;
  ip: string | null;
  intel: IpIntel;
  ownerUserId: string;
  correlationId: string;
  nowMs?: number;
}): Promise<DeviceResolution> {
  const { collections, config } = input;
  requireVerifiedMining(config);
  if (config.lmdg.identityMode === "browser") throw new AppError(403, "mining_device_challenge_required", "Browser enrollment requires an admitted signed start.");
  const evidence = sanitizeEvidence(input.evidenceRaw);
  const signals = normalizeSignals(evidence);
  const network = { ipFamily: ipFamilyOf(input.ip), asn: input.intel.asn, country: input.intel.country };
  const vector = buildNormalizedVector(signals, network);
  const signature = normalizedDeviceSignature(config.encryptionKey, vector);
  const keyHash = deviceKeyHash(config.encryptionKey, evidence.browserKeyPublicKey, signature);
  const visitorHash = visitorIdHash(config.encryptionKey, evidence.visitorId);
  const observed = observedFeatures(config.encryptionKey, signals);
  const nowMs = input.nowMs ?? Date.now();
  // The machine identity of this observation. It is derived from machine traits only, so
  // it does not move when the client edits its user agent, opens a private window or clears its
  // profile — which is exactly what makes it the lease identity rather than a vote in a score.
  const machineKey = machineKeyHash(config.encryptionKey, observed.raw);

  const resolutionFor = (args: {
    device: MiningDeviceRecord;
    verdict: ClusterVerdict;
    score: number;
    match: ClusterMatch;
    isNew: boolean;
    quotaAnchor?: string | null;
  }): DeviceResolution => ({
    device: args.device,
    signature,
    vector,
    verdict: args.verdict,
    score: args.score,
    match: args.match,
    observed,
    isNew: args.isNew,
    evidence,
    leaseKey: leaseKeyOf(machineKey, args.device.deviceKeyHash),
    machineKey,
    equivalentLeaseKeys: leaseKeysOf(machineKey, args.device, args.device.deviceKeyHash),
    trustState: trustStateOf(args.device),
    // An enrolled near clone carries the matched machine's anchor on its own record, so an exact
    // lookup that lands on it later still binds the shared allowance instead of opening a fresh
    // one under its own anchor.
    quotaAnchor: args.quotaAnchor ?? args.device.quotaAnchorHash ?? null,
  });

  // 1. Exact continuity: same browser key, same key hash, or same signature. Each of these is a
  // byte-level match on a value the device itself produced and kept, so no similarity is needed.
  // No mutation here: the record is folded only after admission allows (see `assessMiningStart`),
  // so a rejected attempt can never re-tag the identity or history it was compared against.
  if (evidence.browserKeyPublicKey) {
    const byKey = await findDeviceByPublicKey(collections, evidence.browserKeyPublicKey);
    if (byKey) {
      return resolutionFor({ device: { ...byKey }, verdict: "same", score: 100, match: exactMatch(100), isNew: false });
    }
  }
  // 1b. The server-owned identity anchor: the immutable machine digest recorded when this cluster
  // was enrolled, plus the bounded aliases the server has accepted for it since. This is the lookup
  // the client cannot name: no value it sends is stored as an anchor, and rewriting its payload
  // cannot move it to another cluster. It is a direct indexed lookup, so an old or idle cluster
  // cannot fall out of enforcement the way a recency-limited sweep can.
  if (machineKey) {
    const byAnchor = await findDeviceByAnchor(collections, machineKey);
    if (byAnchor) {
      return resolutionFor({ device: { ...byAnchor }, verdict: "same", score: 100, match: exactMatch(100), isNew: false });
    }
  }
  const byKeyHash = await findDeviceByKeyHash(collections, keyHash);
  if (byKeyHash) {
    return resolutionFor({ device: { ...byKeyHash }, verdict: "same", score: 100, match: exactMatch(100), isNew: false });
  }
  const bySignature = signature
    ? await findDeviceBySignature(collections, signature)
    : null;
  if (bySignature) {
    return resolutionFor({ device: { ...bySignature }, verdict: "same", score: 95, match: exactMatch(95), isNew: false });
  }

  // 2. Weighted correlation: same physical machine behind a different browser/profile/engine emits a
  // new visitorId, a new browser key and a different rendering stack, but keeps the machine traits —
  // CPU class, touch class, audio device, display gamut and colour depth — which is what
  // `decideClusterMatch` compares. This is also the path a machine takes when its key forked, which
  // is why the machine-trait verdict must not depend on a trait only some engines report.
  //
  // The machine-key lookup is its own bounded query and is matched before anything else: a record
  // that carries this observation's machine identity is the same machine outright, and that lookup
  // must never depend on the recent-activity ordering of the profile sweep below.
  if (machineKey) {
    const byMachine = await lookupMachineKey(collections, machineKey);
    if (byMachine) {
      return resolutionFor({ device: { ...byMachine }, verdict: "same", score: 100, match: exactMatch(100), isNew: false });
    }
  }
  const orClauses: Record<string, unknown>[] = [
    ...(observed.raw["platform"] ? [{ platform: observed.raw["platform"] }] : []),
    ...(network.asn ? [{ lastAsn: network.asn }] : []),
    ...(network.country ? [{ lastCountry: network.country }] : []),
    ...(visitorHash ? [{ fingerprintVisitorIdHash: visitorHash }] : []),
  ];
  const candidates = await listClusterCandidates(collections, orClauses.length > 0 ? { $or: orClauses } : {});
  const matches = candidates.map((candidate) => ({
    candidate,
    match: matchDeviceFeatures(toCandidate(candidate), observed, config.encryptionKey),
    identity: machineKey !== null && candidate.machineKeyHash === machineKey,
  }));
  // Ties keep the most recently seen candidate: `listClusterCandidates` already sorts by that.
  const best = matches.reduce<{ candidate: MiningDeviceRecord; match: ClusterMatch; identity: boolean } | null>(
    (winner, entry) => {
      if (winner === null) return entry;
      if (entry.identity !== winner.identity) return entry.identity ? entry : winner;
      return entry.match.score > winner.match.score ? entry : winner;
    },
    null,
  );
  const decided = best?.match ?? noMatch();
  const verdict = best
    ? best.identity
      ? "same"
      : decideClusterMatch(decided, config.lmdg.highConfidenceThreshold, config.lmdg.ambiguousThreshold)
    : "different";
  if (best && verdict === "same") {
    return resolutionFor({
      device: { ...best.candidate },
      verdict,
      score: best.identity ? 100 : decided.score,
      match: decided,
      isNew: false,
    });
  }

  // 3. Ambiguous or different: register this observation as its own record. Distinct machines are
  // never merged on weak evidence — the ambiguous relatives stay reachable through the admission
  // check below, where a live lease owned by another account decides the start. The machine key (and
  // therefore the lease this record participates in) is shared regardless of which record wins.
  // 3b. Enrollment gate: creating a machine identity is a budgeted server-side transition, not a
  // consequence of a well-formed payload. The quota is consumed atomically (see enrollment.ts), so
  // a burst of concurrent first-time requests cannot all pass a read-then-write check. A request
  // over budget is refused *before* any record exists — the refusal itself must not mint anything.
  if (config.lmdg.enrollmentEnabled) {
    const budget = await consumeEnrollmentBudget({
      collections,
      limits: {
        maxNewClustersPerAccountPerDay: config.lmdg.maxNewClustersPerAccountPerDay,
        maxNewClustersPerNetworkPerHour: config.lmdg.maxNewClustersPerNetworkPerHour,
        maxNewClustersPerNetworkPerDay: config.lmdg.maxNewClustersPerNetworkPerDay,
      },
      ownerUserId: input.ownerUserId,
      ipHash: input.ip ? ipHash(config.encryptionKey, input.ip) : null,
      // The machine identity this slot belongs to: a racing duplicate of the same machine must not
      // spend a second slot, and a retry of the same enrollment must not either.
      identityKey: machineKey ?? keyHash,
      nowMs,
    });
    if (!budget.allowed) {
      await recordSecurityEvent({
        collections,
        ownerUserId: input.ownerUserId,
        sessionId: null,
        eventType: LMDG_EVENT_TYPES.enrollmentLimited,
        outcome: "failure",
        correlationId: input.correlationId,
        metadata: {
          scope: budget.hit?.scope ?? "unknown",
          limit: budget.hit?.limit ?? 0,
          count: budget.hit?.count ?? 0,
          hasBrowserKey: Boolean(evidence.browserKeyPublicKey),
        },
      }).catch(() => undefined);
      throw new AppError(403, DEVICE_ENROLLMENT_LIMITED_CODE, DEVICE_ENROLLMENT_LIMITED_MESSAGE);
    }
  }
  // A machine-identity match is enrolled separately but shares the matched machine's allowance. When
  // the best candidate is itself spending someone else's allowance, verify against the original quota
  // owner too; otherwise similarities could chain A's quota through B to a distinct C that no longer
  // resembles A.
  let machineAnchor: string | null = null;
  if (best && isMachineIdentityMatch(decided, config.lmdg.ambiguousThreshold)) {
    const candidateAnchor = best.candidate.quotaAnchorHash;
    const quotaRoot = candidateAnchor
      ? await collections.miningDevices.findOne({
          $or: [{ anchorHash: candidateAnchor }, { machineKeyHash: candidateAnchor }, { publicId: candidateAnchor }],
        })
      : best.candidate;
    if (quotaRoot && !quotaRoot.quotaAnchorHash) {
      const rootMatch = quotaRoot.publicId === best.candidate.publicId
        ? decided
        : matchDeviceFeatures(toCandidate(quotaRoot), observed, config.encryptionKey);
      if (isMachineIdentityMatch(rootMatch, config.lmdg.ambiguousThreshold)) {
        machineAnchor = quotaRoot.anchorHash ?? quotaRoot.machineKeyHash ?? quotaRoot.publicId;
      }
    }
  }
  const created = await createDevice(
    collections,
    {
      ...input,
      config,
      signals,
      observed,
      signature,
      keyHash,
      visitorHash,
      machineKey,
      quotaAnchorHash: machineAnchor,
      browserKeyPublicKey: evidence.browserKeyPublicKey,
      fingerprintVersion: evidence.fingerprintVersion,
      fingerprintConfidence: evidence.fingerprintConfidence,
      nowMs,
    },
  );
  return resolutionFor({
    device: created,
    verdict: best ? verdict : "different",
    score: best?.identity ? 100 : decided.score,
    match: decided,
    isNew: true,
    quotaAnchor: machineAnchor,
  });
}

interface CreateDeviceInput {
  config: Pick<AppConfig, "encryptionKey">;
  ownerUserId: string;
  ip: string | null;
  intel: IpIntel;
  correlationId: string;
  signals: NormalizedDeviceSignals;
  observed: ObservedFeatures;
  signature: string;
  keyHash: string;
  visitorHash: string | null;
  machineKey: string | null;
  quotaAnchorHash: string | null;
  browserKeyPublicKey: string | null;
  fingerprintVersion: string | null;
  fingerprintConfidence: number | null;
  nowMs: number;
}

async function createDevice(
  collections: Collections,
  input: CreateDeviceInput,
): Promise<MiningDeviceRecord> {
  const { signals, observed } = input;
  const now = new Date(input.nowMs);
  const doc: Omit<MiningDeviceRecord, "_id"> = {
    publicId: randomUUID(),
    deviceKeyHash: input.keyHash,
    machineKeyHash: input.machineKey,
    // Enrollment writes the immutable anchor once: the server-derived machine identity this cluster
    // was created under. Later observations may add aliases or move `machineKeyHash`, but the anchor
    // is the value direct lookups resolve and no client payload reaches it.
    anchorHash: input.machineKey,
    // The shared quota identity when this cluster was enrolled as a near clone of a known machine:
    // what makes a later exact lookup bind the matched machine's allowance instead of a fresh one.
    // Written once, like the anchor, and never from a client payload.
    quotaAnchorHash: input.quotaAnchorHash,
    aliasHashes: [],
    trustState: "provisional",
    enrollmentUserId: input.ownerUserId,
    admissionCount: 0,
    admissionPending: 0,
    admissionLeaseEndsAt: new Date(0),
    proofCount: 0,
    establishedAt: null,
    findingCount: 0,
    // No credited activity yet: trust is earned per network by committing cycles there.
    networkTrusts: [],
    browserKeyPublicKey: input.browserKeyPublicKey,
    fingerprintVisitorIdHash: input.visitorHash,
    fingerprintVersion: input.fingerprintVersion?.slice(0, 32) ?? null,
    fingerprintConfidence: input.fingerprintConfidence,
    normalizedSignalHash: input.signature,
    osFamily: signals.osFamily === "unknown" ? null : signals.osFamily,
    browserFamily: signals.browserFamily === "unknown" ? null : signals.browserFamily,
    platform: signals.platform === "unknown" ? null : signals.platform,
    screenClass: signals.screenClass === "unknown" ? null : signals.screenClass,
    timezone: signals.timezone === "unknown" ? null : signals.timezone,
    languageClass: signals.languageClass === "unknown" ? null : signals.languageClass,
    webglFingerprintHash: signals.webglHash === "unknown" ? null : signals.webglHash,
    hardwareConcurrencyBucket: signals.hardwareConcurrencyBucket === 0 ? null : signals.hardwareConcurrencyBucket,
    deviceMemoryBucket: signals.deviceMemoryBucket,
    // Keyed digests only: the snapshot must never persist reversible fingerprint data (GPU
    // strings, screen geometry, timezone). Matching digests snapshots the same way it digests
    // legacy raw ones — see `matchDeviceFeatures`.
    featureSnapshot: observed.digests,
    // A new record starts with a single-observation profile; later observations extend the ring.
    featureProfile: learnFeatureProfile(null, observed.digests),
    machineFeatureProfile: machineProfileOf(input.config.encryptionKey, observed.raw),
    firstSeenAt: now,
    lastSeenAt: now,
    lastIpHash: input.ip ? ipHash(input.config.encryptionKey, input.ip) : null,
    lastAsn: input.intel.asn,
    lastCountry: input.intel.country,
    status: "active",
    createdAt: now,
    updatedAt: now,
  };
  try {
    Object.assign(doc, admissionEvidence(doc, input.config.encryptionKey));
    await collections.miningDevices.insertOne({ _id: new ObjectId(), ...doc } as MiningDeviceRecord);
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error;
    // A racing enrollment of the same machine core hits the unique anchor index; the loser resolves
    // to the winner's cluster rather than creating a twin.
    const existing = input.machineKey ? await findDeviceByAnchor(collections, input.machineKey) : null;
    if (existing) return existing;
    const fallback = await collections.miningDevices.findOne({ deviceKeyHash: input.keyHash }, { sort: { firstSeenAt: 1, _id: 1 } });
    if (fallback) return fallback;
    throw error;
  }
  const created = await collections.miningDevices.findOne({ publicId: doc.publicId });
  if (!created) throw new Error("Mining device registration did not persist");
  await recordSecurityEvent({
    collections,
    ownerUserId: input.ownerUserId,
    sessionId: null,
    eventType: LMDG_EVENT_TYPES.registered,
    outcome: "success",
    correlationId: input.correlationId,
    metadata: { deviceId: doc.publicId },
  }).catch(() => undefined);
  return created;
}
