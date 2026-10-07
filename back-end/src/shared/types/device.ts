import type { ObjectId } from "mongodb";

/**
 * Louma Mining Device Guard (LMDG): server-side device identity for the mining feature.
 *
 * Honest scope: this is multi-signal correlation + proof-of-possession, not a cryptographically
 * guaranteed physical-machine identity. A browser cannot provide that across profiles/VMs/private
 * windows, and FingerprintJS output is spoofable evidence — never the decision by itself.
 */
export type MiningDeviceStatus = "active" | "quarantined" | "blocked";

/**
 * Learned, bounded feature history for one device: per feature key, the last few keyed digests
 * (most recent last) plus how often it was observed.
 *
 * Values are keyed digests, never raw fingerprint data, and the ring is bounded (see
 * MAX_FEATURE_VALUES in mining-device/identity.ts) so a hostile client cannot grow the document.
 * Keeping a small history is what lets a device with one drifting field (a browser update, a driver
 * update) still compare as the same machine instead of forking into a new identity.
 */
export interface MiningDeviceFeatureProfile {
  [featureKey: string]: {
    digests: string[];
    count: number;
    /**
     * Bounded log of digests this observation stream contradicted the ring with, not yet seen
     * often enough consecutively to be trusted. Evidence, never identity: a contradictory value
     * does not enter `digests` until it repeats (see learnFeatureProfileChecked).
     */
    drift?: string[];
  };
}

/**
 * Server-owned trust state of one device cluster. Distinct from `status`, which is the operator's
 * enforcement flag: an `active` device can still be `provisional` (not yet worth trusting).
 *
 *   - `provisional` — enrolled from an observation, not yet corroborated by independent evidence.
 *   - `established` — corroborated across admissions (and/or a bound proof): trusted for merging.
 *   - `suspicious`  — repeated contradictions / churn findings; stricter risk, never silently trusted.
 *   - `blocked`     — terminal (mirrors `status`).
 */
export type MiningDeviceTrustState = "provisional" | "established" | "suspicious" | "blocked";

export interface MiningDeviceRecord {
  _id: ObjectId;
  publicId: string;
  /**
   * HMAC(secret, browser public key) when a key is registered, else HMAC(secret, signature).
   * Identifies the *browser*: it changes with a profile, a private window or cleared storage.
   */
  deviceKeyHash: string;
  /**
   * HMAC over the engine-stable machine traits only (CPU and touch class, audio device, display
   * gamut and HDR capability, panel colour depth — see CORE_MACHINE_FEATURES). Identifies the
   * *computer and its operating system*: two browsers on one machine produce the same value, and a
   * user-agent change or a new browser profile does not move it. It is what a mining lease is taken
   * on. Null when the client reported too few machine traits for the key to mean anything.
   */
  machineKeyHash: string | null;
  browserKeyPublicKey: string | null;
  fingerprintVisitorIdHash: string | null;
  fingerprintVersion: string | null;
  fingerprintConfidence: number | null;
  normalizedSignalHash: string | null;
  osFamily: string | null;
  browserFamily: string | null;
  platform: string | null;
  screenClass: string | null;
  timezone: string | null;
  languageClass: string | null;
  webglFingerprintHash: string | null;
  hardwareConcurrencyBucket: number | null;
  deviceMemoryBucket: number | null;
  /** Latest normalized observation, mirroring the columns above, as one comparable snapshot. */
  featureSnapshot: Record<string, string> | null;
  /** Learned digest history per feature; the correlation primitive. Null on records from before it existed. */
  featureProfile: MiningDeviceFeatureProfile | null;
  /** The same history, restricted to the machine traits that form `machineKeyHash`. */
  machineFeatureProfile: MiningDeviceFeatureProfile | null;
  firstSeenAt: Date;
  lastSeenAt: Date;
  lastIpHash: string | null;
  lastAsn: string | null;
  lastCountry: string | null;
  status: MiningDeviceStatus;
  /**
   * Server-owned trust state. Optional so device rows written before this model existed stay
   * readable; readers default a missing value to `provisional`, never to `established`.
   */
  trustState?: MiningDeviceTrustState;
  /**
   * The immutable machine anchor recorded at enrollment: the keyed digest over the machine core the
   * server derived when it created this cluster. It is NEVER rewritten from a later observation —
   * a device that reports different traits is either the same cluster (accepted through the
   * append-only alias list) or a different observation, never an identity rewrite.
   */
  anchorHash?: string | null;
  /**
   * The shared quota identity of a near-clone enrollment: the matched machine's anchor, copied here
   * when this cluster was enrolled as a near clone of a known machine. The record keeps its own
   * immutable `anchorHash`, but the 10h device quota binds to this anchor instead, so the shared
   * allowance survives enrollment and a retry that resolves to this record reads the same window
   * rather than a fresh one. Null on every other record; readers default a missing value to null.
   */
  quotaAnchorHash?: string | null;
  /**
   * Append-only machine-key aliases the server accepted for this cluster (a browser/driver update
   * that moved a core trait, or a tolerant cross-engine match). Bounded; only appended on an
   * allowed admission, never by a rejected request.
   */
  aliasHashes?: string[];
  /** The account whose start enrolled this cluster. Evidence for abuse budgets, not ownership. */
  enrollmentUserId?: string | null;
  /** Allowed admissions folded into this cluster (a start that passed admission, not a rejected try). */
  admissionCount?: number;
  /** Verified single-use proof-of-possession handshakes bound to this cluster. */
  proofCount?: number;
  /** When the cluster became `established`; null while provisional. */
  establishedAt?: Date | null;
  /** Bounded counter of consistency/drift findings; feeds the risk engine, never a verdict alone. */
  findingCount?: number;
  /**
   * Where and when this cluster actually mined: one entry per network context (server-observed IP
   * hash) that has credited an admission or proof, most recent first and bounded (see
   * `MAX_NETWORK_TRUSTS`). This is what the network lock reads — trust is not a property the cluster
   * carries everywhere, it is "this identity has mined *here*, recently", so an identity that
   * earned trust elsewhere cannot appear next to another account's live cycle on this network.
   */
  networkTrusts?: MiningDeviceNetworkTrust[];
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Credited mining activity of one device cluster on one network context.
 *
 * `admissions` and `proofs` are counts of *committed* events — a start whose session and lease
 * transaction landed, or a verified single-use proof — never of requests that were merely assessed.
 */
export interface MiningDeviceNetworkTrust {
  /** HMAC of the server-observed peer address; never the address itself. */
  ipHash: string;
  admissions: number;
  proofs: number;
  firstAt: Date;
  lastAt: Date;
}

/**
 * One consumed enrollment slot.
 *
 * The budget is a sliding window, so a slot is a row with the instant it was consumed rather than a
 * counter on a calendar bucket: counting the rows inside `now - windowMs` is exactly the rolling
 * limit, with no double-rate window straddling an hour or day boundary. `identityKey` makes the
 * consumption idempotent per machine within the window (a retry or a racing duplicate of the same
 * machine consumes one slot, not two). `refs` counts the requests relying on the slot right now: a
 * refusal releases its own reference instead of deleting the row, so the release cannot take a
 * slot away from a concurrent request that did enroll on the same machine, while a refused attempt
 * (all references released) stops counting immediately. `expiresAt` is a TTL index — a slot's row is
 * deleted when it can no longer affect any window.
 */
export interface MiningDeviceQuotaRecord {
  _id: string;
  scope: "account" | "network";
  /** The account id or network hash the slot belongs to. */
  subject: string;
  windowMs: number;
  /** Consumed instant; the rolling window counts rows newer than `now - windowMs`. */
  at: Date;
  /** The machine identity this slot was spent on (machine key, else browser key hash). */
  identityKey: string;
  /** Requests currently relying on this slot; only slots with a positive count are spend. */
  refs: number;
  expiresAt: Date;
}

export type MiningDeviceLeaseStatus = "active" | "released";

/**
 * One mining-cycle device lease. Validity is derived from the clock
 * (`serverNow < leaseEndsAt`): no timers, no jobs. An expired row is simply not active.
 */
export interface MiningDeviceLeaseRecord {
  _id: ObjectId;
  publicId: string;
  /**
   * The device identity this lease is taken on (a keyed digest), or — in the reserved `net:`
   * namespace (see `networkLockKeyFor`) — one network's admission token: a start that is not a
   * resident of its network leases the token so two fresh identities racing on one network collide
   * on the unique active-lease index instead of both passing the pre-transaction check.
   */
  deviceClusterId: string;
  /** The device record (its `publicId`) this lease was taken for — survives a later key change. */
  deviceId: string | null;
  ownerUserId: string;
  miningSessionId: string;
  /**
   * HMAC of the server-observed peer address the cycle was started from. The network lock reads
   * live leases by this value: a lease is tied to the network the cycle was actually taken on, so
   * neither a later IP change nor a truncated device sweep can hide a live cycle from it.
   */
  ipHash: string | null;
  leasedAt: Date;
  leaseEndsAt: Date;
  status: MiningDeviceLeaseStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface MiningDeviceNonceRecord {
  _id: ObjectId;
  publicId: string;
  ownerUserId: string;
  deviceKeyHash: string | null;
  /**
   * Server-resolved device binding recorded when the challenge is issued: the machine anchor the
   * evidence describes and (when it resolves to one) the enrolled cluster. The signed payload
   * commits to the anchor, and a proof can only be spent on the enrollment it was issued for.
   */
  boundAnchorHash?: string | null;
  boundClusterId?: string | null;
  /**
   * `x|y` fingerprint of the browser key the evidence named when this challenge was issued
   * (`p256KeyFingerprint`); null when it named no well-formed key. A proof that consumes this
   * nonce must be signed by this key's private half — otherwise a challenge issued for one key
   * would be satisfiable by any other key, and the verified handshake would credit a possession
   * that was never proven.
   */
  boundBrowserKeyFingerprint?: string | null;
  nonce: string;
  issuedAt: Date;
  expiresAt: Date;
  consumedAt: Date | null;
  /** Public browser key proven through this nonce, set when the proof is consumed. */
  verifiedBrowserKey?: string | null;
}

export interface MiningDeviceObservationRecord {
  _id: ObjectId;
  deviceId: string;
  ownerUserId: string;
  observedAt: Date;
  ipHash: string | null;
  asn: string | null;
  country: string | null;
  riskScore: number;
  decision: string;
}
