import { createPublicKey, createVerify, randomBytes, randomUUID } from "node:crypto";
import type { ClientSession } from "mongodb";
import { ObjectId } from "mongodb";
import type { AppConfig } from "../../config/env.js";
import type { Collections } from "../../infrastructure/mongodb/collections.js";
import type { MiningDeviceRecord, MiningDeviceTrustState } from "../../shared/types.js";
import { AppError } from "../../shared/errors.js";
import { isPublicIp, lookupIpLocation } from "../geo/ipinfo.js";
import { lookupProxyCheckIntel, type ProxyCheckIntel } from "../geo/proxycheck.js";
import { recordSecurityEvent } from "../security/audit.js";
import {
  buildFeatureMap,
  buildNormalizedVector,
  decideClusterMatch,
  deviceKeyHash,
  digestFeatureMap,
  ipHash,
  isPresentationFeature,
  isRenderingFeature,
  learnFeatureProfile,
  learnFeatureProfileChecked,
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
  detectImpossibleUaPlatform,
  sanitizeEvidence,
  type DeviceEvidence,
  type NormalizedDeviceSignals,
} from "./signals.js";
import { evaluateMiningDeviceTrust, type RiskDecision } from "./risk.js";
import {
  CHALLENGE_MAX_PER_HOUR,
  DEVICE_ENROLLMENT_LIMITED_CODE,
  DEVICE_ENROLLMENT_LIMITED_MESSAGE,
  DEVICE_NETWORK_IN_USE_CODE,
  LMDG_EVENT_TYPES,
  LMDG_PROOF_ACTION,
  LMDG_PROOF_VERSION,
  LIVE_LEASE_BACKSTOP_LIMIT,
  MAX_ACCOUNTS_PER_DEVICE_CLUSTER,
  MAX_CLUSTER_ALIASES,
  MAX_DEVICES_PER_ACCOUNT,
  MAX_NETWORK_TRUSTS,
  OBSERVATION_MIN_INTERVAL_MS,
  PROVE_MAX_PER_HOUR,
} from "./policy.js";
import {
  consumeEnrollmentBudget,
  networkTrustEntry,
  networkTrustEstablished,
  networkTrustFresh,
  networkTrustOf,
  nextTrustState,
  recentClusterChurn,
  trustStateOf,
} from "./enrollment.js";
import { detectEvidenceContradictions, detectSimultaneousTraitReplacement, isEnvironmentFeatureKey } from "./consistency.js";
import {
  findDeviceByAnchor,
  findDeviceByKeyHash,
  findDeviceByPublicKey,
  findDeviceBySignature,
  findLiveLeases,
  findLiveLeasesOnNetwork,
  isDuplicateKeyError,
  listClusterCandidates,
  lookupMachineKey,
} from "./repository.js";

/**
 * Louma Mining Device Guard service.
 *
 * Server-authoritative admission control for mining starts. Client evidence is sanitized and
 * correlated here; the database (partial unique index on active leases) is the final guarantee
 * under concurrency, never an application-level `findOne` check alone.
 */

// ---------------------------------------------------------------------------
// IP intelligence (cached, degraded, never on the critical path)
// ---------------------------------------------------------------------------

interface IpIntel {
  asn: string | null;
  country: string | null;
  /** proxycheck detections; all false/unknown when the provider is disabled or degraded. */
  vpn: boolean;
  proxy: boolean;
  tor: boolean;
  hosting: boolean;
  anonymous: boolean;
  providerRisk: number | null;
}

const ipIntelCache = new Map<string, { intel: IpIntel; cachedAtMs: number }>();

/**
 * Bounded in-process cache: the TTL alone stops reuse of stale intelligence but never removes
 * entries, so a long-running service resolving continually changing public IPs would grow without
 * end. Inserts evict expired entries first, then the oldest, keeping the map at a fixed ceiling.
 */
const IP_INTEL_CACHE_MAX_ENTRIES = 1000;

function cacheIpIntel(ip: string, intel: IpIntel, nowMs: number, ttlMs: number): void {
  ipIntelCache.set(ip, { intel, cachedAtMs: nowMs });
  if (ipIntelCache.size <= IP_INTEL_CACHE_MAX_ENTRIES) return;
  for (const [key, entry] of ipIntelCache) {
    if (ipIntelCache.size <= IP_INTEL_CACHE_MAX_ENTRIES) break;
    if (nowMs - entry.cachedAtMs >= ttlMs) ipIntelCache.delete(key);
  }
  while (ipIntelCache.size > IP_INTEL_CACHE_MAX_ENTRIES) {
    const oldest = ipIntelCache.keys().next();
    if (oldest.done) break;
    ipIntelCache.delete(oldest.value);
  }
}

function parseAsn(org: string | null): string | null {
  if (!org) return null;
  const match = /AS(\d+)/i.exec(org);
  return match?.[1] ? `AS${match[1].toUpperCase()}` : org.slice(0, 64).toUpperCase();
}

const UNKNOWN_INTEL: IpIntel = { asn: null, country: null, vpn: false, proxy: false, tor: false, hosting: false, anonymous: false, providerRisk: null };

export async function resolveIpIntel(input: {
  config: Pick<AppConfig, "ipinfoToken" | "ipinfoTimeoutMs" | "proxycheckKey" | "proxycheckTimeoutMs" | "lmdg">;
  ip: string | null;
}): Promise<IpIntel> {
  const ip = (input.ip ?? "").slice(0, 45);
  if (!ip || !isPublicIp(ip)) return { ...UNKNOWN_INTEL };
  const ttlMs = input.config.lmdg.ipIntelTtlSeconds * 1000;
  const cached = ipIntelCache.get(ip);
  if (cached && Date.now() - cached.cachedAtMs < ttlMs) return cached.intel;
  // Mining path prefers proxycheck (VPN/proxy/Tor/hosting + ASN/country in one answer).
  // ipinfo remains the fallback for ASN/country so its signup role is untouched.
  let proxy: ProxyCheckIntel | null = null;
  if (input.config.proxycheckKey) {
    proxy = await lookupProxyCheckIntel({ ipAddress: ip, key: input.config.proxycheckKey, timeoutMs: input.config.proxycheckTimeoutMs });
    if (proxy) {
      const intel: IpIntel = {
        asn: proxy.asn,
        country: proxy.country,
        vpn: proxy.vpn,
        proxy: proxy.proxy,
        tor: proxy.tor,
        hosting: proxy.hosting,
        anonymous: proxy.anonymous,
        providerRisk: proxy.risk,
      };
      cacheIpIntel(ip, intel, Date.now(), ttlMs);
      return intel;
    }
  }
  if (input.config.ipinfoToken) {
    try {
      const location = await lookupIpLocation({ ipAddress: ip, token: input.config.ipinfoToken, timeoutMs: input.config.ipinfoTimeoutMs });
      const intel: IpIntel = { ...UNKNOWN_INTEL, asn: parseAsn(location.org), country: location.country };
      cacheIpIntel(ip, intel, Date.now(), ttlMs);
      return intel;
    } catch {
      // Degraded mode: third-party outage never fails mining.
    }
  }
  const stale = ipIntelCache.get(ip);
  if (stale) return stale.intel;
  return { ...UNKNOWN_INTEL };
}

/** Test hook: clears the in-process IP cache. */
export function clearIpIntelCacheForTests(): void {
  ipIntelCache.clear();
}

// ---------------------------------------------------------------------------
// Device resolution
// ---------------------------------------------------------------------------

export interface DeviceResolution {
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

function toCandidate(device: MiningDeviceRecord): DeviceCandidateFeatures {
  return {
    featureProfile: device.featureProfile ?? null,
    featureSnapshot: (device.featureSnapshot as DeviceFeatureMap | null) ?? null,
    browserKeyPublicKey: device.browserKeyPublicKey,
    fingerprintVisitorIdHash: device.fingerprintVisitorIdHash,
  };
}

/** Observed comparable values, in raw form for storage and digested form for matching. */
function observedFeatures(secret: Buffer, signals: NormalizedDeviceSignals): ObservedFeatures {
  const raw = buildFeatureMap(signals);
  return { raw, digests: digestFeatureMap(secret, raw), machine: machineFeatureMap(raw) };
}

/**
 * The identity keys a stored record is reachable under.
 *
 * The server-owned cluster id comes first: it is the one value no client controls, so a lease on it
 * cannot be walked away from by reporting different traits. The machine key and every alias the
 * server accepted for this cluster follow, because a *different* record presenting the same machine
 * traits must still collide with the lease (that is the anti-multi-cycle property), and the browser
 * key last, because a lease an earlier build took on it must remain enforceable.
 */
function recordLeaseKeys(device: MiningDeviceRecord): string[] {
  return [
    ...new Set(
      [
        device.publicId,
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
    aliasHashes: [],
    trustState: "provisional",
    enrollmentUserId: input.ownerUserId,
    admissionCount: 0,
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

/**
 * Refreshes liveness and folds the observation into the learned profile.
 *
 * Called only after mining admission allows the start (see `assessMiningStart`), never during
 * resolution: a rejected request must not rewrite the record's machine key, snapshot, or history,
 * or a failed attempt presenting a known browser key with different machine evidence would re-tag
 * the record and later matching would use that altered identity.
 *
 * The profile is what makes a device survive normal drift: a browser or driver update changes one
 * or two digests, and the ring keeps the previous values for `MAX_FEATURE_VALUES` observations
 * instead of forking the identity on the first difference. Contradictions of an established value
 * are recorded but not learned (see `learnFeatureProfileChecked`): one hostile observation cannot
 * walk a stored identity to a value of its choosing.
 */
async function recordDeviceSeen(
  collections: Collections,
  secret: Buffer,
  device: MiningDeviceRecord,
  input: { intel: IpIntel; ip: string | null; correlationId: string; findings: string[] },
  observed: ObservedFeatures,
): Promise<void> {
  const now = new Date();
  // Recomputed from this observation rather than read from the record: the machine key is a function
  // of the machine traits, so a user-agent switch or a new browser profile reproduces the same key
  // and the record keeps pointing at the one machine identity its leases are taken on.
  const machineKey = machineKeyHash(secret, observed.raw);
  // Controlled learning: a contradictory value never silently becomes the new identity baseline. It
  // is kept in the profile's bounded drift log for the matcher, and — on this machine-anchored
  // record — every contradiction is also a security event, so poisoning attempts leave a trail the
  // risk engine sees while the stored value stays intact.
  const fold = learnFeatureProfileChecked(device.featureProfile, observed.digests);
  const machineFold = learnFeatureProfileChecked(
    device.machineFeatureProfile,
    digestFeatureMap(secret, observed.machine),
  );
  for (const driftedKey of [...fold.drift, ...machineFold.drift]) {
    await recordSecurityEvent({
      collections,
      ownerUserId: null,
      sessionId: null,
      eventType: LMDG_EVENT_TYPES.suspicious,
      outcome: "failure",
      correlationId: input.correlationId,
      metadata: { deviceId: device.publicId, feature: driftedKey.slice(0, 32), reason: "identity_drift_not_learned" },
    }).catch(() => undefined);
  }
  // The snapshot is the matcher's fallback when a feature has no learned ring, and the matcher
  // accepts a snapshot match independently of the profile — so a contradicted (drifted) value must
  // not replace the snapshot either. Contradicted keys keep their previous snapshot value (or stay
  // absent when there is none); everything else advances to this observation.
  // The trust counters are deliberately NOT touched here. An allowed start is only an intent to mine
  // until the mining session and its lease commit, so the admission is credited by
  // `creditGrantedStart` *after* that transaction lands: a request that lost the unique-lease race
  // can never age a cluster toward `established`. The findings are one input to that decision, so
  // they are incremented (never read-modify-written) here — a stale in-memory copy cannot overwrite
  // a concurrent update.
  // Append-only alias: the machine key this observation produced, when the server has decided this
  // cluster is the same machine (here: the admission was allowed and resolution matched the
  // cluster). The anchor is never rewritten, aliases are bounded, and a rejected request adds none.
  const aliasHashes = [...(device.aliasHashes ?? [])];
  if (machineKey && machineKey !== device.anchorHash && !aliasHashes.includes(machineKey)) {
    aliasHashes.push(machineKey);
    while (aliasHashes.length > MAX_CLUSTER_ALIASES) aliasHashes.shift();
    await recordSecurityEvent({
      collections,
      ownerUserId: null,
      sessionId: null,
      eventType: LMDG_EVENT_TYPES.aliasAccepted,
      outcome: "success",
      correlationId: input.correlationId,
      metadata: { deviceId: device.publicId, reason: "machine_key_alias_accepted" },
    }).catch(() => undefined);
  }
  const previousSnapshot = (device.featureSnapshot ?? {}) as DeviceFeatureMap;
  const nextSnapshot: DeviceFeatureMap = { ...previousSnapshot, ...observed.digests };
  for (const driftedKey of new Set([...fold.drift, ...machineFold.drift])) {
    if (previousSnapshot[driftedKey] !== undefined) nextSnapshot[driftedKey] = previousSnapshot[driftedKey];
    else delete nextSnapshot[driftedKey];
  }
  await collections.miningDevices.updateOne(
    { _id: device._id },
    {
      $set: {
        lastSeenAt: now,
        updatedAt: now,
        // Digests only — see `createDevice`.
        featureSnapshot: nextSnapshot,
        featureProfile: fold.profile,
        machineFeatureProfile: machineFold.profile,
        // The record's platform drives the candidate pre-filter above; a client that changes its
        // user agent must not also hide the record it belongs to from that filter. Never downgraded
        // to null: a client that stops reporting the trait keeps the last value it did report.
        ...(machineKey ? { machineKeyHash: machineKey } : {}),
        aliasHashes,
        // The last network this cluster was observed on, for the record's own history. The network
        // *lock* does not read it: it asks the leases, which carry the network their cycle was
        // actually taken from, so a stale device field can never decide an admission.
        ...(input.ip ? { lastIpHash: ipHash(secret, input.ip) } : {}),
        ...(observed.raw["platform"] ? { platform: observed.raw["platform"] } : {}),
        ...(input.intel.asn ? { lastAsn: input.intel.asn } : {}),
        ...(input.intel.country ? { lastCountry: input.intel.country } : {}),
      },
      $inc: { findingCount: input.findings.length },
    },
  ).catch(() => undefined);
}

/**
 * Credits one *committed* admission (and the findings of that observation) to a device cluster.
 *
 * This is the only writer of `admissionCount`, of the admission side of `networkTrusts`, and of the
 * `establishedAt` that admissions earn; it is called by the mining service only after the session and its lease
 * transaction has committed — so the number of admissions is the number of cycles that actually
 * started on the cluster, never the number of requests that merely reached admission control. A
 * burst of concurrent starts therefore credits one admission, not one per request, which is what
 * makes "established" mean several occasions instead of one fabricated moment.
 *
 * The credit is recorded against the network the cycle was taken from: trust is then readable as
 * "this identity has mined here, recently", which is the only statement the network lock is allowed
 * to accept from it.
 */
export async function creditGrantedStart(input: {
  collections: Collections;
  config: Pick<AppConfig, "encryptionKey" | "lmdg">;
  devicePublicId: string;
  ip: string | null;
  nowMs?: number;
}): Promise<void> {
  const nowMs = input.nowMs ?? Date.now();
  const now = new Date(nowMs);
  // Atomic increment, then a decision on the fresh document: two credits landing together cannot
  // overwrite each other's count the way a read-modify-write of the in-memory record would.
  const updated = await input.collections.miningDevices
    .findOneAndUpdate(
      { publicId: input.devicePublicId, status: { $ne: "blocked" } },
      { $inc: { admissionCount: 1 }, $set: { lastSeenAt: now, updatedAt: now } },
      { returnDocument: "after" },
    )
    .catch((error) => {
      reportCreditFailure("admission increment", input.devicePublicId, error);
      return null;
    });
  if (!updated) return;
  await applyCommittedCredit({
    collections: input.collections,
    cluster: updated,
    ipHashValue: input.ip ? ipHash(input.config.encryptionKey, input.ip) : null,
    credit: "admission",
    nowMs,
    minAdmissions: input.config.lmdg.establishMinAdmissions,
  });
}

/**
 * Recomputes and persists a cluster's trust after one committed credit.
 *
 * Shared by the admission credit (a cycle that committed) and the proof credit (a verified
 * single-use handshake), so both move `trustState`, `networkTrusts` and `establishedAt` through the
 * same rule and both record *where* the activity happened. Callers pass the document as returned by
 * their atomic `$inc`, never an earlier read: a concurrent credit must not be overwritten.
 */
async function applyCommittedCredit(input: {
  collections: Collections;
  cluster: MiningDeviceRecord;
  ipHashValue: string | null;
  credit: "admission" | "proof";
  nowMs: number;
  minAdmissions: number;
}): Promise<void> {
  const now = new Date(input.nowMs);
  if (input.ipHashValue) {
    // One atomic pipeline: increment the matching entry or prepend a new one, and move the
    // credited network to the front. Two operations (increment-then-insert) let two first credits
    // on one network both miss and each prepend a duplicate — trust reads only the first match,
    // so split credits never established the exemption and wasted the bounded slots. An in-place
    // increment alone left the entry in its old position, so a freshly credited third network
    // could be sliced away by the next new network. Serialized per document, this pipeline lets
    // the second concurrent credit see the first one's entry and increment it instead.
    const admissionsInc = input.credit === "admission" ? 1 : 0;
    const proofsInc = input.credit === "proof" ? 1 : 0;
    const freshEntry = networkTrustEntry(input.ipHashValue, input.credit, input.nowMs);
    await input.collections.miningDevices
      .updateOne(
        { _id: input.cluster._id },
        [
          {
            $set: {
              networkTrusts: {
                $let: {
                  vars: {
                    current: { $ifNull: ["$networkTrusts", []] },
                    has: { $in: [input.ipHashValue, { $ifNull: ["$networkTrusts.ipHash", []] }] },
                  },
                  in: {
                    $cond: [
                      "$$has",
                      {
                        $let: {
                          vars: {
                            bumped: {
                              $map: {
                                input: "$$current",
                                as: "entry",
                                in: {
                                  $cond: [
                                    { $eq: ["$$entry.ipHash", input.ipHashValue] },
                                    {
                                      $mergeObjects: [
                                        "$$entry",
                                        {
                                          admissions: { $add: ["$$entry.admissions", admissionsInc] },
                                          proofs: { $add: ["$$entry.proofs", proofsInc] },
                                          lastAt: now,
                                        },
                                      ],
                                    },
                                    "$$entry",
                                  ],
                                },
                              },
                            },
                          },
                          in: {
                            $slice: [
                              {
                                $concatArrays: [
                                  { $filter: { input: "$$bumped", as: "entry", cond: { $eq: ["$$entry.ipHash", input.ipHashValue] } } },
                                  { $filter: { input: "$$bumped", as: "entry", cond: { $ne: ["$$entry.ipHash", input.ipHashValue] } } },
                                ],
                              },
                              MAX_NETWORK_TRUSTS,
                            ],
                          },
                        },
                      },
                      {
                        $slice: [{ $concatArrays: [[freshEntry], "$$current"] }, MAX_NETWORK_TRUSTS],
                      },
                    ],
                  },
                },
              },
            },
          },
        ],
      )
      .catch((error) => {
        reportCreditFailure("network trust credit", input.cluster.publicId, error);
      });
  }
  const transition = nextTrustState({
    device: input.cluster,
    admissionCount: input.cluster.admissionCount ?? 0,
    proofCount: input.cluster.proofCount ?? 0,
    findingCount: input.cluster.findingCount ?? 0,
    minAdmissions: input.minAdmissions,
  });
  await input.collections.miningDevices
    .updateOne(
      { _id: input.cluster._id },
      {
        $set: {
          trustState: transition.state,
          ...(transition.becameEstablished ? { establishedAt: now } : {}),
        },
      },
    )
    .catch((error) => {
      reportCreditFailure("trust state", input.cluster.publicId, error);
    });
}

/**
 * A credit that was not written is a real loss — the device never gets that admission back and can
 * end up refused for standing it did earn — but it must never fail the request: the cycle is already
 * committed when this runs. Ignoring the error entirely was the worse option: the loss left no trace
 * at all, so nothing could tell an undercounted device from one that never mined. This is the trace.
 */
function reportCreditFailure(operation: string, devicePublicId: string, error: unknown): void {
  console.error(`[lmdg] committed credit not written (${operation}) for device ${devicePublicId}:`, error);
}

// ---------------------------------------------------------------------------
// Challenge / proof (replay-safe, single-use nonces)
// ---------------------------------------------------------------------------

export interface DeviceBinding {
  /** The server-resolved machine anchor this handshake belongs to; null when evidence named none. */
  anchorHash: string | null;
  /** The enrolled cluster (`publicId`) when the evidence resolved to one; null for a first-sight device. */
  clusterId: string | null;
  /**
   * The browser key the evidence presented (as sent), null when it presented none. A cluster with no
   * machine anchor is named *by* this key, so the proof for it must also be signed by this key — the
   * comparison is by key material (`p256KeyFingerprint`), not by the exact JSON serialization.
   */
  browserKeyText: string | null;
}

/**
 * The key material of a P-256 JWK as a comparable value: `x|y`, null for anything that is not a
 * well-formed public EC key. Two serializations of the same key compare equal; a different key does
 * not, whatever member order or extra metadata it carries.
 */
export function p256KeyFingerprint(jwkText: string | null | undefined): string | null {
  if (typeof jwkText !== "string" || jwkText.length === 0) return null;
  try {
    const parsed = JSON.parse(jwkText) as Record<string, unknown>;
    if (parsed?.["kty"] !== "EC" || parsed["crv"] !== "P-256") return null;
    const x = parsed["x"];
    const y = parsed["y"];
    if (typeof x !== "string" || typeof y !== "string" || x.length === 0 || y.length === 0) return null;
    return `${x}|${y}`;
  } catch {
    return null;
  }
}

/**
 * Read-only identity resolution used to bind a challenge to a device enrollment.
 *
 * This never creates a cluster and never mutates anything: it asks "which server-owned identity does
 * this evidence describe?" so the challenge payload can commit to that identity. The client cannot
 * choose the binding — it is recomputed here from evidence through the same anchor lookups the start
 * path uses.
 */
export async function resolveDeviceBinding(input: {
  collections: Pick<Collections, "miningDevices">;
  config: Pick<AppConfig, "encryptionKey">;
  evidenceRaw: unknown;
}): Promise<DeviceBinding> {
  const evidence = sanitizeEvidence(input.evidenceRaw);
  const signals = normalizeSignals(evidence);
  const observed = observedFeatures(input.config.encryptionKey, signals);
  const machineKey = machineKeyHash(input.config.encryptionKey, observed.raw);
  const browserKeyText = evidence.browserKeyPublicKey;
  if (machineKey) {
    const byAnchor = await findDeviceByAnchor(input.collections, machineKey);
    if (byAnchor) return { anchorHash: byAnchor.anchorHash ?? machineKey, clusterId: byAnchor.publicId, browserKeyText };
  }
  if (browserKeyText) {
    const byKey = await findDeviceByPublicKey(input.collections, browserKeyText);
    if (byKey) return { anchorHash: byKey.anchorHash ?? null, clusterId: byKey.publicId, browserKeyText };
  }
  return { anchorHash: machineKey, clusterId: null, browserKeyText };
}

export async function issueChallenge(input: {
  collections: Collections;
  config: Pick<AppConfig, "lmdg">;
  ownerUserId: string;
  deviceKeyHash: string | null;
  /** Server-resolved device binding; legacy clients that present no evidence get no binding. */
  binding?: DeviceBinding | null;
  origin?: string | null;
  correlationId: string;
  nowMs?: number;
}): Promise<{ nonce: string; expiresAt: Date; payload: string }> {
  const nowMs = input.nowMs ?? Date.now();
  const hourAgo = new Date(nowMs - 60 * 60 * 1000);
  const issued = await input.collections.miningDeviceNonces.countDocuments({ ownerUserId: input.ownerUserId, issuedAt: { $gt: hourAgo } });
  if (issued >= CHALLENGE_MAX_PER_HOUR) {
    throw new AppError(429, "rate_limited", "Too many challenge requests. Try again later.");
  }
  const nonce = randomBytes(32).toString("base64url");
  // The nonce lifetime is `LMDG_NONCE_TTL_SECONDS`: the TTL index expires the row off `expiresAt`,
  // so writing the challenge TTL here would silently leave that setting ineffective.
  const expiresAt = new Date(nowMs + input.config.lmdg.nonceTtlSeconds * 1000);
  await input.collections.miningDeviceNonces.insertOne({
    _id: new ObjectId(),
    publicId: randomUUID(),
    ownerUserId: input.ownerUserId,
    deviceKeyHash: input.deviceKeyHash,
    // The server-resolved enrollment this handshake is bound to. An empty binding is stored as null
    // and can never satisfy a start: a proof that names nothing proves nothing here.
    boundAnchorHash: input.binding?.anchorHash ?? null,
    boundClusterId: input.binding?.clusterId ?? null,
    nonce,
    issuedAt: new Date(nowMs),
    expiresAt,
    consumedAt: null,
  } as never);
  await recordSecurityEvent({
    collections: input.collections,
    ownerUserId: input.ownerUserId,
    sessionId: null,
    eventType: LMDG_EVENT_TYPES.challenge,
    outcome: "success",
    correlationId: input.correlationId,
  }).catch(() => undefined);
  // The exact bytes the client must sign. They bind this nonce to the protocol version, the mining
  // action, the origin the browser answered on, the account, the device enrollment, and the window
  // — so the proof proves possession *of this key, for this account, on this origin, for this
  // action* and nothing else (see `buildProofPayload`).
  const payload = buildProofPayload({
    nonce,
    origin: input.origin ?? null,
    ownerUserId: input.ownerUserId,
    // The device slot of the signed payload carries the *server-resolved* anchor, not the
    // client-supplied key string: a signature is therefore bound to the identity the evidence
    // actually describes, and reproducing it for another enrollment fails verification.
    deviceKeyHash: input.binding?.anchorHash ?? input.deviceKeyHash ?? null,
    issuedAtMs: nowMs,
    expiresAtMs: expiresAt.getTime(),
  });
  return { nonce, expiresAt, payload };
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, entry: unknown) => {
    if (Array.isArray(entry)) return entry;
    if (entry !== null && typeof entry === "object") {
      return Object.fromEntries(Object.entries(entry as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)));
    }
    return entry;
  });
}

/**
 * The canonical payload a device proof must sign.
 *
 * Possession of a key over a bare nonce proves nothing about intent or context: the same signature
 * could be replayed in any request shape the protocol ever grows. The payload binds the nonce to
 * the protocol version, the action (mining start), the frontend origin the browser answered on,
 * the authenticated account, the device enrollment this handshake belongs to, and the nonce's own
 * issue/expiry window — so a signature minted for one account, one origin, one device, or one
 * action verifies nowhere else.
 *
 * Key order is fixed here, so both sides hash the same bytes; the JSON-level canonicalization of
 * the whole object is irrelevant because the client is given the exact field list to sign.
 */
export function buildProofPayload(parts: {
  nonce: string;
  origin: string | null;
  ownerUserId: string;
  deviceKeyHash: string | null;
  issuedAtMs: number;
  expiresAtMs: number;
}): string {
  return canonicalJson({
    v: LMDG_PROOF_VERSION,
    action: LMDG_PROOF_ACTION,
    origin: parts.origin ?? "null",
    user: parts.ownerUserId,
    device: parts.deviceKeyHash ?? "",
    nonce: parts.nonce,
    iat: Math.floor(parts.issuedAtMs / 1000),
    exp: Math.floor(parts.expiresAtMs / 1000),
  });
}

/**
 * Strict P-256 EC public-key acceptance.
 *
 * Everything else — RSA, octet keys, other curves, extra members, missing members, wrong
 * formats — is rejected before any signature material is parsed. `createPublicKey` alone would
 * happily accept several of those, and a cross-family or cross-curve confusion would turn "verify
 * this proof" into "verify whatever key shape arrived". The private member is refused outright.
 */
export function verifiedP256Jwk(jwk: Record<string, unknown>): ReturnType<typeof createPublicKey> | null {
  try {
    if (typeof jwk !== "object" || jwk === null || Array.isArray(jwk)) return null;
    if (jwk["kty"] !== "EC" || jwk["crv"] !== "P-256") return null;
    if (typeof jwk["x"] !== "string" || typeof jwk["y"] !== "string") return null;
    // `ext` is the standard WebCrypto export member, so the real browser client always sends it.
    const allowed = new Set(["kty", "crv", "x", "y", "kid", "alg", "use", "key_ops", "ext"]);
    for (const key of Object.keys(jwk)) {
      if (!allowed.has(key)) return null;
      if (key === "alg" && jwk["alg"] !== "ES256") return null;
      if (key === "use" && jwk["use"] !== "sig") return null;
      if (key === "key_ops" && (!Array.isArray(jwk["key_ops"]) || !(jwk["key_ops"] as unknown[]).includes("verify"))) return null;
      if (key === "ext" && jwk["ext"] !== true) return null;
    }
    if (jwk["x"].length > 128 || jwk["y"].length > 128) return null;
    if ("d" in jwk) return null;
    const key = createPublicKey({ key: jwk as never, format: "jwk" });
    if (key.asymmetricKeyType !== "ec") return null;
    const details = key.asymmetricKeyDetails as { namedCurve?: string } | undefined;
    if (details?.namedCurve !== "prime256v1") return null;
    return key;
  } catch {
    return null;
  }
}

function rawEcdsaToDer(raw: Buffer): Buffer {
  if (raw.length !== 64) throw new Error("Invalid ECDSA signature length");
  const r = raw.subarray(0, 32);
  const s = raw.subarray(32, 64);
  const strip = (v: Buffer): Buffer => {
    let i = 0;
    while (i < v.length - 1 && v[i] === 0) i += 1;
    let out = v.subarray(i);
    if (out[0]! >= 0x80) out = Buffer.concat([Buffer.from([0x00]), out]);
    return out;
  };
  const rEnc = strip(Buffer.from(r));
  const sEnc = strip(Buffer.from(s));
  const total = 2 + rEnc.length + 2 + sEnc.length;
  return Buffer.concat([
    Buffer.from([0x30, total, 0x02, rEnc.length]),
    rEnc,
    Buffer.from([0x02, sEnc.length]),
    sEnc,
  ]);
}

function verifyEcdsaP256(publicKeyJwk: Record<string, unknown>, payload: string, signatureB64: string): boolean {
  const key = verifiedP256Jwk(publicKeyJwk);
  if (!key) return false;
  try {
    const raw = Buffer.from(signatureB64, "base64url");
    const der = raw.length === 64 ? rawEcdsaToDer(raw) : raw;
    return createVerify("SHA256").update(payload, "utf8").verify(key, der);
  } catch {
    return false;
  }
}

export async function verifyProof(input: {
  collections: Collections;
  config: Pick<AppConfig, "encryptionKey" | "lmdg">;
  ownerUserId: string;
  nonce: string;
  signature: string;
  publicKeyJwk: Record<string, unknown>;
  /** The server-resolved binding recomputed from the evidence presented with this proof request. */
  binding?: DeviceBinding | null;
  /** Server-observed peer address, so a proof credits the network it was actually answered from. */
  ip?: string | null;
  origin?: string | null;
  correlationId: string;
  nowMs?: number;
}): Promise<{ deviceKeyHash: string; verified: boolean }> {
  const nowMs = input.nowMs ?? Date.now();
  const hourAgo = new Date(nowMs - 60 * 60 * 1000);
  // Every proof call writes exactly one audit event — `challengeFailed` on any rejection,
  // `verified` on success — so the hourly quota counts attempts, not just consumed nonces. Counting
  // consumed rows alone let invalid signatures and unknown nonces retry forever, and rotating IPs
  // walk around the per-route limit. A failed count must never read as zero attempts: fail closed
  // and refuse the proof rather than grant unlimited retries past the quota.
  let attempts: number;
  try {
    attempts = await input.collections.securityEvents.countDocuments({
      ownerUserId: input.ownerUserId,
      eventType: { $in: [LMDG_EVENT_TYPES.challengeFailed, LMDG_EVENT_TYPES.verified] },
      createdAt: { $gt: hourAgo },
    });
  } catch {
    throw new AppError(429, "rate_limited", "Too many proof attempts. Try again later.");
  }
  if (attempts >= PROVE_MAX_PER_HOUR) {
    throw new AppError(429, "rate_limited", "Too many proof attempts. Try again later.");
  }
  const record = await input.collections.miningDeviceNonces.findOne({ nonce: input.nonce, ownerUserId: input.ownerUserId });
  // A typed AppError, so the envelope keeps the dedicated code: thrown as a bare Error it reached the
  // handler's clientErrorStatus branch and surfaced as a generic `invalid_request`.
  const rejectProof = (reason: string): AppError =>
    new AppError(401, "mining_device_proof_rejected", "Device proof rejected.");
  const fail = async (reason: string): Promise<never> => {
    await recordSecurityEvent({
      collections: input.collections,
      ownerUserId: input.ownerUserId,
      sessionId: null,
      eventType: LMDG_EVENT_TYPES.challengeFailed,
      outcome: "failure",
      correlationId: input.correlationId,
      metadata: { reason },
    }).catch(() => undefined);
    throw rejectProof(reason);
  };
  if (!record) return fail("unknown_nonce");
  if (record.consumedAt) return fail("reused_nonce");
  if (record.expiresAt.getTime() <= nowMs) return fail("expired_nonce");
  // The signature must cover the canonical bound payload, not just the nonce. A bare-nonce
  // signature from any earlier build (or minted elsewhere) verifies against nothing here.
  const storedAnchor = (record as { boundAnchorHash?: string | null }).boundAnchorHash ?? null;
  const storedClusterId = (record as { boundClusterId?: string | null }).boundClusterId ?? null;
  const presentedAnchor = input.binding?.anchorHash ?? null;
  const presentedClusterId = input.binding?.clusterId ?? null;
  // The handshake belongs to the enrollment it was issued for. A proof presented with different
  // device evidence than the challenge was issued under is a binding mismatch, not a proof — this
  // is what stops a proof minted for one device/account context being spent on another.
  if (storedAnchor !== null && storedAnchor !== presentedAnchor) return fail("device_binding_mismatch");
  if (storedAnchor !== null && presentedAnchor === null) return fail("device_binding_missing");
  // A cluster with no machine anchor is named by its browser key alone (too few machine traits were
  // reported to derive a key). For such an enrollment the *cluster* and the *key* are the binding:
  // the proof must be signed by the key that named the cluster, so a verified proof can never be
  // credited to an unrelated signing key. Clusters that carry an anchor need no such rule — the
  // anchor in the signed payload already identifies the machine that must have produced it.
  const keyOnlyEnrollment = storedAnchor === null && storedClusterId !== null;
  if (keyOnlyEnrollment) {
    if (presentedClusterId !== storedClusterId) return fail("device_binding_mismatch");
    const signingKey = p256KeyFingerprint(JSON.stringify(input.publicKeyJwk));
    const namedKey = p256KeyFingerprint(input.binding?.browserKeyText ?? null);
    if (signingKey === null || namedKey === null || signingKey !== namedKey) return fail("device_binding_mismatch");
  }
  // A nonce with no anchor and no cluster was issued without device evidence (a legacy client): it
  // binds no enrollment, so verification still runs but no cluster can be credited from it.
  const payload = buildProofPayload({
    nonce: record.nonce,
    origin: input.origin ?? null,
    ownerUserId: input.ownerUserId,
    // Rebuilt with the stored server-resolved binding, exactly as issued and signed.
    deviceKeyHash: storedAnchor ?? record.deviceKeyHash ?? null,
    issuedAtMs: record.issuedAt.getTime(),
    expiresAtMs: record.expiresAt.getTime(),
  });
  const ok = verifyEcdsaP256(input.publicKeyJwk, payload, input.signature);
  if (!ok) return fail("bad_signature");
  const publicKeyText = JSON.stringify(input.publicKeyJwk).slice(0, 2048);
  // Single-use: consume before linking so a replayed proof finds a consumed nonce. The proven
  // public key is stored on the nonce so mining admission can tell a verified browser key from an
  // unverified claim when it later evaluates a risk challenge.
  const consumed = await input.collections.miningDeviceNonces.updateOne(
    { _id: record._id, consumedAt: null },
    { $set: { consumedAt: new Date(nowMs), verifiedBrowserKey: publicKeyText } },
  );
  if (consumed.modifiedCount !== 1) return fail("reused_nonce");
  await input.collections.miningDevices.updateOne(
    { browserKeyPublicKey: publicKeyText },
    { $set: { lastSeenAt: new Date(nowMs), updatedAt: new Date(nowMs) } },
  ).catch(() => undefined);
  // Bind the proof to the enrollment it was issued for: a verified proof is independent evidence
  // (it happened on another occasion than the start), so it counts toward establishing the cluster
  // and can never be recorded against a cluster the evidence did not resolve to. The credit lands on
  // the server-resolved cluster id stored on the nonce, never on a client-supplied value.
  const cluster = storedClusterId ? await input.collections.miningDevices.findOne({ publicId: storedClusterId }).catch(() => null) : null;
  if (cluster) {
    const credited = await input.collections.miningDevices
      .findOneAndUpdate(
        { _id: cluster._id },
        { $inc: { proofCount: 1 }, $set: { lastSeenAt: new Date(nowMs), updatedAt: new Date(nowMs) } },
        { returnDocument: "after" },
      )
      .catch(() => null);
    if (credited) {
      await applyCommittedCredit({
        collections: input.collections,
        cluster: credited,
        ipHashValue: input.ip ? ipHash(input.config.encryptionKey, input.ip) : null,
        credit: "proof",
        nowMs,
        minAdmissions: input.config.lmdg.establishMinAdmissions,
      });
    }
  }
  await recordSecurityEvent({
    collections: input.collections,
    ownerUserId: input.ownerUserId,
    sessionId: null,
    eventType: LMDG_EVENT_TYPES.verified,
    outcome: "success",
    correlationId: input.correlationId,
  }).catch(() => undefined);
  return { deviceKeyHash: storedAnchor ?? record.deviceKeyHash ?? "", verified: true };
}

// ---------------------------------------------------------------------------
// Admission check for mining start
// ---------------------------------------------------------------------------

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
  equivalentLeaseKeys: string[];
  conflictingLeaseOwner: string | null;
}

/**
 * Records that an account was seen on a device, sampled to at most one row per account per
 * `OBSERVATION_MIN_INTERVAL_MS`. Never throws: a sampling write is evidence, not the decision.
 *
 * Network fields carry the server-observed values for this request — a keyed IP hash (never the
 * address or a placeholder), plus the ASN/country the intelligence lookup reported — so later
 * starts can measure IP churn and geographic jumps instead of reading zeroes.
 */
async function recordDeviceObservation(input: {
  collections: Pick<Collections, "miningDeviceObservations">;
  secret: Buffer;
  device: MiningDeviceRecord;
  ownerUserId: string;
  ip: string | null;
  intel: IpIntel;
  nowMs: number;
  riskScore: number;
  decision: string;
}): Promise<void> {
  const lastObs = await input.collections.miningDeviceObservations.findOne(
    { deviceId: input.device.publicId, ownerUserId: input.ownerUserId },
    { sort: { observedAt: -1 } },
  ).catch(() => null);
  if (lastObs && input.nowMs - lastObs.observedAt.getTime() <= OBSERVATION_MIN_INTERVAL_MS) return;
  await input.collections.miningDeviceObservations.insertOne({
    _id: new ObjectId(),
    deviceId: input.device.publicId,
    ownerUserId: input.ownerUserId,
    observedAt: new Date(input.nowMs),
    ipHash: input.ip ? ipHash(input.secret, input.ip) : null,
    asn: input.intel.asn,
    country: input.intel.country,
    riskScore: input.riskScore,
    decision: input.decision,
  } as never).catch(() => undefined);
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
  void MAX_ACCOUNTS_PER_DEVICE_CLUSTER;
  void MAX_DEVICES_PER_ACCOUNT;
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

/**
 * Inserts the lease rows inside the caller's transaction. The partial unique index is the lock.
 *
 * Every device identity the session is known to cover gets its own row (`deviceClusterId` holds the
 * device key hash), and the caller passes a set rather than a single key on purpose: a start also
 * leases the exact duplicates it correlated with, so two first-time starts racing on one machine
 * cannot each lease a different row and open two cycles.
 */
export async function insertLeaseInSession(input: {
  collections: Collections;
  leaseKeys: string[];
  /** The device record (`publicId`) the lease is taken for — keeps the backstop reachable by record even after a key change. */
  deviceId: string | null;
  /** Server-observed peer address of this start; hashed here so the network identity never leaves this module. */
  ip: string | null;
  secret: Buffer;
  ownerUserId: string;
  miningSessionId: string;
  leaseEndsAt: Date;
  mongoSession: ClientSession;
}): Promise<void> {
  const now = new Date();
  const networkHash = input.ip ? ipHash(input.secret, input.ip) : null;
  await input.collections.miningDeviceLeases.insertMany(
    [...new Set(input.leaseKeys)].map((deviceClusterId) => ({
      _id: new ObjectId(),
      publicId: randomUUID(),
      deviceClusterId,
      deviceId: input.deviceId,
      ownerUserId: input.ownerUserId,
      miningSessionId: input.miningSessionId,
      ipHash: networkHash,
      leasedAt: now,
      leaseEndsAt: input.leaseEndsAt,
      status: "active",
      createdAt: now,
      updatedAt: now,
    })) as never,
    { session: input.mongoSession, ordered: true },
  );
}

/** Safe public view: never exposes other accounts, IPs, fingerprints, or risk internals. */
export async function getDeviceStatus(input: {
  collections: Collections;
  ownerUserId: string;
  nowMs?: number;
}): Promise<{ bound: boolean; leaseEndsAt: string | null; deviceId: string | null }> {
  const nowMs = input.nowMs ?? Date.now();
  const lease = await input.collections.miningDeviceLeases.findOne(
    { ownerUserId: input.ownerUserId, status: "active" },
    { sort: { leaseEndsAt: -1 } },
  );
  if (!lease || lease.leaseEndsAt.getTime() <= nowMs) return { bound: false, leaseEndsAt: null, deviceId: null };
  return { bound: true, leaseEndsAt: lease.leaseEndsAt.toISOString(), deviceId: lease.deviceClusterId };
}
