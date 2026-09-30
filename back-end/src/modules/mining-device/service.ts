import { createPublicKey, createVerify, randomBytes, randomUUID } from "node:crypto";
import type { ClientSession } from "mongodb";
import { ObjectId } from "mongodb";
import type { AppConfig } from "../../config/env.js";
import type { Collections } from "../../infrastructure/mongodb/collections.js";
import type { MiningDeviceRecord } from "../../shared/types.js";
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
  LMDG_EVENT_TYPES,
  MAX_ACCOUNTS_PER_DEVICE_CLUSTER,
  MAX_DEVICES_PER_ACCOUNT,
  OBSERVATION_MIN_INTERVAL_MS,
  PROVE_MAX_PER_HOUR,
} from "./policy.js";
import {
  findDeviceByKeyHash,
  findDeviceByPublicKey,
  findDeviceBySignature,
  findLiveLeases,
  isDuplicateKeyError,
  listClusterCandidates,
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
  const cached = ipIntelCache.get(ip);
  if (cached && Date.now() - cached.cachedAtMs < input.config.lmdg.ipIntelTtlSeconds * 1000) return cached.intel;
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
      ipIntelCache.set(ip, { intel, cachedAtMs: Date.now() });
      return intel;
    }
  }
  if (input.config.ipinfoToken) {
    try {
      const location = await lookupIpLocation({ ipAddress: ip, token: input.config.ipinfoToken, timeoutMs: input.config.ipinfoTimeoutMs });
      const intel: IpIntel = { ...UNKNOWN_INTEL, asn: parseAsn(location.org), country: location.country };
      ipIntelCache.set(ip, { intel, cachedAtMs: Date.now() });
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

/** The identity keys a stored record is reachable under: machine first, then browser. */
function recordLeaseKeys(device: MiningDeviceRecord): string[] {
  return [...new Set([device.machineKeyHash, device.deviceKeyHash].filter((key): key is string => Boolean(key)))];
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
  return [...new Set([leaseKeyOf(machineKey, deviceKeyHashValue), deviceKeyHashValue, ...recordLeaseKeys(device)])];
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
  });

  // 1. Exact continuity: same browser key, same key hash, or same signature. Each of these is a
  // byte-level match on a value the device itself produced and kept, so no similarity is needed.
  if (evidence.browserKeyPublicKey) {
    const byKey = await findDeviceByPublicKey(collections, evidence.browserKeyPublicKey);
    if (byKey) {
      await touchDevice(collections, config.encryptionKey, byKey, input, observed);
      return resolutionFor({ device: { ...byKey }, verdict: "same", score: 100, match: exactMatch(100), isNew: false });
    }
  }
  const byKeyHash = await findDeviceByKeyHash(collections, keyHash);
  if (byKeyHash) {
    await touchDevice(collections, config.encryptionKey, byKeyHash, input, observed);
    return resolutionFor({ device: { ...byKeyHash }, verdict: "same", score: 100, match: exactMatch(100), isNew: false });
  }
  const bySignature = signature
    ? await findDeviceBySignature(collections, signature)
    : null;
  if (bySignature) {
    await touchDevice(collections, config.encryptionKey, bySignature, input, observed);
    return resolutionFor({ device: { ...bySignature }, verdict: "same", score: 95, match: exactMatch(95), isNew: false });
  }

  // 2. Weighted correlation: same physical machine behind a different browser/profile emits a new
  // visitorId and a new browser key, and a different rendering stack, but keeps the traits that
  // describe the computer itself — CPU and memory class, display scale, capture devices, audio
  // device, installed fonts and codecs. Those are what `decideClusterMatch` compares.
  const orClauses: Record<string, unknown>[] = [
    // The machine key first: a UA switch moves the platform string but not this, so the record the
    // same hardware is already known by stays reachable and gets extended instead of forked.
    ...(machineKey ? [{ machineKeyHash: machineKey }] : []),
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
    await touchDevice(collections, config.encryptionKey, best.candidate, input, observed);
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
    featureSnapshot: observed.raw,
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
    const existing = await collections.miningDevices.findOne({ deviceKeyHash: input.keyHash }, { sort: { firstSeenAt: 1, _id: 1 } });
    if (existing) return existing;
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
 * The profile is what makes a device survive normal drift: a browser or driver update changes one
 * or two digests, and the ring keeps the previous values for `MAX_FEATURE_VALUES` observations
 * instead of forking the identity on the first difference.
 */
async function touchDevice(
  collections: Collections,
  secret: Buffer,
  device: MiningDeviceRecord,
  input: { intel: IpIntel; ip: string | null },
  observed: ObservedFeatures,
): Promise<void> {
  const now = new Date();
  // Recomputed from this observation rather than read from the record: the machine key is a function
  // of the machine traits, so a user-agent switch or a new browser profile reproduces the same key
  // and the record keeps pointing at the one machine identity its leases are taken on.
  const machineKey = machineKeyHash(secret, observed.raw);
  await collections.miningDevices.updateOne(
    { _id: device._id },
    {
      $set: {
        lastSeenAt: now,
        updatedAt: now,
        featureSnapshot: observed.raw,
        featureProfile: learnFeatureProfile(device.featureProfile, observed.digests),
        machineFeatureProfile: learnFeatureProfile(device.machineFeatureProfile, digestFeatureMap(secret, observed.machine)),
        // The record's platform drives the candidate pre-filter above; a client that changes its
        // user agent must not also hide the record it belongs to from that filter. Never downgraded
        // to null: a client that stops reporting the trait keeps the last value it did report.
        ...(machineKey ? { machineKeyHash: machineKey } : {}),
        ...(observed.raw["platform"] ? { platform: observed.raw["platform"] } : {}),
        ...(input.intel.asn ? { lastAsn: input.intel.asn } : {}),
        ...(input.intel.country ? { lastCountry: input.intel.country } : {}),
      },
    },
  ).catch(() => undefined);
}

// ---------------------------------------------------------------------------
// Challenge / proof (replay-safe, single-use nonces)
// ---------------------------------------------------------------------------

export async function issueChallenge(input: {
  collections: Collections;
  config: Pick<AppConfig, "lmdg">;
  ownerUserId: string;
  deviceKeyHash: string | null;
  correlationId: string;
  nowMs?: number;
}): Promise<{ nonce: string; expiresAt: Date }> {
  const nowMs = input.nowMs ?? Date.now();
  const hourAgo = new Date(nowMs - 60 * 60 * 1000);
  const issued = await input.collections.miningDeviceNonces.countDocuments({ ownerUserId: input.ownerUserId, issuedAt: { $gt: hourAgo } });
  if (issued >= CHALLENGE_MAX_PER_HOUR) {
    throw Object.assign(new Error("Too many challenge requests"), { statusCode: 429, code: "rate_limited" });
  }
  const nonce = randomBytes(32).toString("base64url");
  const expiresAt = new Date(nowMs + input.config.lmdg.challengeTtlSeconds * 1000);
  await input.collections.miningDeviceNonces.insertOne({
    _id: new ObjectId(),
    publicId: randomUUID(),
    ownerUserId: input.ownerUserId,
    deviceKeyHash: input.deviceKeyHash,
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
  return { nonce, expiresAt };
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

function verifyEcdsaP256(publicKeyJwk: Record<string, unknown>, nonce: string, signatureB64: string): boolean {
  try {
    const key = createPublicKey({ key: publicKeyJwk as never, format: "jwk" });
    const raw = Buffer.from(signatureB64, "base64url");
    const der = raw.length === 64 ? rawEcdsaToDer(raw) : raw;
    return createVerify("SHA256").update(nonce, "utf8").verify(key, der);
  } catch {
    return false;
  }
}

export async function verifyProof(input: {
  collections: Collections;
  config: Pick<AppConfig, "lmdg">;
  ownerUserId: string;
  nonce: string;
  signature: string;
  publicKeyJwk: Record<string, unknown>;
  correlationId: string;
  nowMs?: number;
}): Promise<{ deviceKeyHash: string; verified: boolean }> {
  const nowMs = input.nowMs ?? Date.now();
  const hourAgo = new Date(nowMs - 60 * 60 * 1000);
  const attempts = await input.collections.miningDeviceNonces.countDocuments({ ownerUserId: input.ownerUserId, issuedAt: { $gt: hourAgo }, consumedAt: { $ne: null } });
  if (attempts >= PROVE_MAX_PER_HOUR) {
    throw Object.assign(new Error("Too many proof attempts"), { statusCode: 429, code: "rate_limited" });
  }
  const record = await input.collections.miningDeviceNonces.findOne({ nonce: input.nonce, ownerUserId: input.ownerUserId });
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
    throw Object.assign(new Error("Device proof rejected"), { statusCode: 401, code: "mining_device_proof_rejected" });
  };
  if (!record) return fail("unknown_nonce");
  if (record.consumedAt) return fail("reused_nonce");
  if (record.expiresAt.getTime() <= nowMs) return fail("expired_nonce");
  const ok = verifyEcdsaP256(input.publicKeyJwk, record.nonce, input.signature);
  if (!ok) return fail("bad_signature");
  // Single-use: consume before linking so a replayed proof finds a consumed nonce.
  const consumed = await input.collections.miningDeviceNonces.updateOne(
    { _id: record._id, consumedAt: null },
    { $set: { consumedAt: new Date(nowMs) } },
  );
  if (consumed.modifiedCount !== 1) return fail("reused_nonce");
  const publicKeyText = JSON.stringify(input.publicKeyJwk).slice(0, 2048);
  await input.collections.miningDevices.updateOne(
    { browserKeyPublicKey: publicKeyText },
    { $set: { lastSeenAt: new Date(nowMs), updatedAt: new Date(nowMs) } },
  ).catch(() => undefined);
  await recordSecurityEvent({
    collections: input.collections,
    ownerUserId: input.ownerUserId,
    sessionId: null,
    eventType: LMDG_EVENT_TYPES.verified,
    outcome: "success",
    correlationId: input.correlationId,
  }).catch(() => undefined);
  return { deviceKeyHash: record.deviceKeyHash ?? "", verified: true };
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
 */
async function recordDeviceObservation(input: {
  collections: Pick<Collections, "miningDeviceObservations">;
  device: MiningDeviceRecord;
  ownerUserId: string;
  ip: string | null;
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
    ipHash: input.ip ? "hashed" : null,
    asn: input.device.lastAsn,
    country: input.device.lastCountry,
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
      collections, device, ownerUserId: input.ownerUserId, ip: input.ip, nowMs, riskScore: 70, decision: "deny",
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
    const keys = [candidate.machineKeyHash, candidate.deviceKeyHash].filter((key): key is string => Boolean(key));
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
        return { decision: "challenge", reasonCode: "device_cluster_lease_ambiguous", confidence: 0.6, riskScore: 55, device, equivalentLeaseKeys: [], conflictingLeaseOwner: null };
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
  const [observedAccounts, leaseAccounts, devicesOnAccount, rejectsOnDevice, rejectsOnAccount] = await Promise.all([
    collections.miningDeviceObservations.distinct("ownerUserId", { deviceId: device.publicId, observedAt: { $gt: windowStart } }).catch(() => [] as unknown[]),
    collections.miningDeviceLeases.distinct("ownerUserId", { deviceClusterId: { $in: equivalentLeaseKeys }, leasedAt: { $gt: windowStart } }).catch(() => [] as unknown[]),
    collections.miningDeviceObservations.distinct("deviceId", { ownerUserId: input.ownerUserId, observedAt: { $gt: windowStart } }).then((v) => v.length).catch(() => 1),
    // Scoped to this device: an unscoped count made one conflict anywhere on the platform raise
    // every account's risk score for the following 30 days.
    collections.securityEvents.countDocuments({ eventType: LMDG_EVENT_TYPES.conflict, "metadata.deviceId": device.publicId, createdAt: { $gt: windowStart } }).catch(() => 0),
    collections.securityEvents.countDocuments({ ownerUserId: input.ownerUserId, eventType: LMDG_EVENT_TYPES.conflict, createdAt: { $gt: windowStart } }).catch(() => 0),
  ]);
  const accountsOnDevice = new Set([...observedAccounts, ...leaseAccounts]).size;
  void MAX_ACCOUNTS_PER_DEVICE_CLUSTER;
  void MAX_DEVICES_PER_ACCOUNT;

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
  if (knownMachine !== null && (knownMachineIsIdentity || knownMachine.matchedMachine.length >= 3)) {
    uaChangedForKnownMachine = knownMachine.drifted.some(isPresentationFeature);
    renderingTamperForKnownMachine = knownMachine.drifted.some(isRenderingFeature);
  }
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
    anonymity: { vpn: input.intel.vpn, proxy: input.intel.proxy, tor: input.intel.tor, hosting: input.intel.hosting, anonymous: input.intel.anonymous },
    history: {
      accountsOnDevice, devicesOnAccount,
      recentRejectsOnDevice: rejectsOnDevice, recentRejectsOnAccount: rejectsOnAccount,
      ipChurnDuringCycle: 0, geoJump: false,
    },
  });

  // Persist a sampled observation: which account was seen on this device, and what the guard
  // decided. This is the cross-account evidence the risk engine accumulates — it is written on every
  // outcome, including a denial, because a second account trying a device it does not own is exactly
  // the history that has to be on the record.
  await recordDeviceObservation({
    collections,
    device,
    ownerUserId: input.ownerUserId,
    ip: input.ip,
    nowMs,
    riskScore: result.riskScore,
    decision: result.decision,
  });

  if (result.decision === "deny" || result.decision === "challenge") {
    await recordSecurityEvent({
      collections, ownerUserId: input.ownerUserId, sessionId: null,
      eventType: result.decision === "deny" ? LMDG_EVENT_TYPES.rejected : LMDG_EVENT_TYPES.challenge,
      outcome: "failure", correlationId: input.correlationId,
      metadata: { deviceId: device.publicId, reason: result.reasonCode },
    }).catch(() => undefined);
  }

  return { decision: result.decision, reasonCode: result.reasonCode, confidence: result.confidence, riskScore: result.riskScore, device, equivalentLeaseKeys, conflictingLeaseOwner: null };
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
  ownerUserId: string;
  miningSessionId: string;
  leaseEndsAt: Date;
  mongoSession: ClientSession;
}): Promise<void> {
  const now = new Date();
  await input.collections.miningDeviceLeases.insertMany(
    [...new Set(input.leaseKeys)].map((deviceClusterId) => ({
      _id: new ObjectId(),
      publicId: randomUUID(),
      deviceClusterId,
      ownerUserId: input.ownerUserId,
      miningSessionId: input.miningSessionId,
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
