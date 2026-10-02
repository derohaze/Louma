import { createPublicKey, createVerify, randomBytes, randomUUID } from "node:crypto";
import { ObjectId } from "mongodb";
import type { AppConfig } from "../../config/env.js";
import type { Collections } from "../../infrastructure/mongodb/collections.js";
import { AppError } from "../../shared/errors.js";
import { recordSecurityEvent } from "../security/audit.js";
import { ipHash, machineKeyHash } from "./identity.js";
import { normalizeSignals, sanitizeEvidence } from "./signals.js";
import {
  CHALLENGE_MAX_PER_HOUR,
  LMDG_EVENT_TYPES,
  LMDG_PROOF_ACTION,
  LMDG_PROOF_VERSION,
  PROVE_MAX_PER_HOUR,
} from "./policy.js";
import { findDeviceByAnchor, findDeviceByPublicKey } from "./repository.js";
import { applyCommittedCredit } from "./credit.js";
import { observedFeatures } from "./resolution.js";

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
