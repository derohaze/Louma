import { createHmac } from "node:crypto";
import type { MiningDeviceFeatureProfile } from "../../shared/types.js";
import type { NormalizedDeviceSignals } from "./signals.js";

/**
 * LMDG server-side identity: keyed hashes, an operating-system-anchored machine key, and weighted
 * agreement.
 *
 * The client never provides a trusted device identity. The server derives everything from the
 * normalized signal vector: features are reduced to HMAC-SHA256 digests under the server secret
 * (`APP_ENCRYPTION_KEY`) so the database holds no reversible fingerprint data.
 *
 * The model has three layers, strongest first:
 *
 *   1. Machine key — a digest over the traits that belong to the *computer and its operating
 *      system* rather than to the browser session: CPU class, memory class, display scale, capture
 *      devices, audio device, display gamut and colour depth, the installed font set, the codec
 *      set. None of them is produced by the browser's rendering layer, so none of them moves when a
 *      second browser, a private window, a container tab or a cleared profile is used on the same
 *      computer — which is what makes the key an identity rather than a vote, and what makes it the
 *      namespace a mining lease is taken on.
 *   2. Class traits — CPU class and memory class, the two traits a machine cannot change without
 *      being a different machine. They gate the fuzzy path: a disagreement here is never "same".
 *   3. Weighted agreement — a [0,100] similarity over everything both sides reported, used to
 *      recognise the same machine across browsers and normal drift, and to explain a decision.
 *
 * Deliberately *not* identity: the screen geometry of the current window, the GPU strings and
 * limits, and the canvas/audio/WebGL/speech digests. Those are the traits two browsers on one
 * computer disagree about by construction — a privacy browser randomizes the rendering stack, a
 * second window sits on a different monitor — so reading them as machine identity is exactly how
 * one computer was able to hold two mining cycles. They remain scored evidence, and their drift
 * against a known machine is recorded as tampering.
 *
 * Honest scope: every value below is client-supplied, so a determined operator of an anti-detect
 * browser that also fakes the font set, the codec set and the CPU/memory class will still look like
 * a new machine. This raises the cost of casual multi-accounting (the observed attack) to "run a
 * spoofing suite", which is a different problem, solved with per-account controls rather than more
 * signals. The price of the strict reading is the other direction: two *identical* machines (same
 * model, same OS image, same installed fonts) report the same machine traits and are treated as
 * one — accepted, because the business rule is one machine, one cycle.
 */

export interface NetworkSignals {
  ipFamily: string;
  asn: string | null;
  country: string | null;
}

export function hmacHex(secret: Buffer, domain: string, value: string): string {
  return createHmac("sha256", secret).update(`${domain}:${value}`, "utf8").digest("hex");
}

/** The canonical vector the server hashes. Field order is part of the contract. */
export function buildNormalizedVector(signals: NormalizedDeviceSignals, network: NetworkSignals): string {
  return [
    signals.platform,
    signals.osFamily,
    signals.browserFamily,
    signals.screenGeometry,
    signals.screenDepth,
    signals.pixelRatioBucket,
    signals.timezone,
    signals.timezoneOffsetBucket,
    signals.languageClass,
    String(signals.hardwareConcurrencyBucket),
    signals.deviceMemoryBucket === null ? "mem-unknown" : `mem-${signals.deviceMemoryBucket}`,
    signals.touchPointsBucket,
    signals.mediaInputsBucket,
    signals.colorGamut,
    signals.platformVersion,
    signals.gpu,
    signals.gpuLimits,
    signals.gpuExtensions,
    signals.graphics,
    signals.audioDevice,
    signals.canvasHash,
    signals.audioHash,
    signals.fontsHash,
    signals.fingerprintVersion,
    network.ipFamily,
    (network.asn ?? "asn-unknown").toLowerCase(),
    (network.country ?? "country-unknown").toUpperCase(),
  ].join("|");
}

/** Server-authoritative browser signature. Never accept this value from the client. */
export function normalizedDeviceSignature(secret: Buffer, vector: string): string {
  return hmacHex(secret, "lmdg-device-v2", vector);
}

/**
 * Stable lookup key for a device record. Prefers the browser public key (strongest continuity
 * signal) and falls back to the normalized signature — both HMAC'd, never stored raw.
 */
export function deviceKeyHash(secret: Buffer, browserKeyPublicKey: string | null, signature: string): string {
  if (browserKeyPublicKey) return hmacHex(secret, "lmdg-key-v1", browserKeyPublicKey.slice(0, 2048));
  return hmacHex(secret, "lmdg-sigkey-v1", signature);
}

export function visitorIdHash(secret: Buffer, visitorId: string | null): string | null {
  if (!visitorId || visitorId.length > 512) return null;
  return hmacHex(secret, "lmdg-visitor-v1", visitorId.trim().toLowerCase());
}

export function ipHash(secret: Buffer, ip: string | null): string | null {
  if (!ip) return null;
  return hmacHex(secret, "lmdg-ip-v1", ip.trim().toLowerCase());
}

// ---------------------------------------------------------------------------
// Feature model
// ---------------------------------------------------------------------------

export interface DeviceFeatureSpec {
  key: string;
  weight: number;
  /**
   * Machine trait: a property of the computer and its operating system, the same whichever browser
   * is running. Part of the machine key, and treated as the identity of the physical machine rather
   * than of the browser session that happens to be observing it.
   */
  machine?: boolean;
  /**
   * The machine's class: CPU class and memory class. Two observations that disagree about one of
   * these are different machines, however much else they share, so a disagreement here can never
   * produce a positive verdict. A strict subset of `machine`.
   */
  machineClass?: boolean;
  /** Expensive-to-fake traits: once observed, their later disappearance is a tamper signal. */
  highEntropy?: boolean;
  graphics?: boolean;
  /**
   * The browser's own description of itself (user agent, platform, client hints) rather than an
   * observation of the machine. These are the traits a user-agent switcher moves and nothing else.
   */
  presentation?: boolean;
}

/**
 * The weighted feature set.
 *
 * Machine traits carry most of the weight and are the only ones allowed to decide identity;
 * rendering digests carry the next most, as corroboration and as tamper evidence; presentation
 * strings are worth little by construction.
 */
export const DEVICE_FEATURES: readonly DeviceFeatureSpec[] = [
  // Machine traits: what the computer and its operating system are. The machine key is built from
  // these, so a second browser on one computer reproduces it exactly.
  { key: "hardwareConcurrency", weight: 3, machine: true, machineClass: true },
  { key: "deviceMemory", weight: 2, machine: true, machineClass: true },
  { key: "pixelRatio", weight: 2, machine: true },
  { key: "touchPoints", weight: 1, machine: true },
  { key: "audioDevice", weight: 2, machine: true },
  { key: "mediaInputs", weight: 2, machine: true },
  { key: "colorGamut", weight: 1, machine: true },
  { key: "hdrCapable", weight: 1, machine: true },
  { key: "screenDepth", weight: 1, machine: true },
  { key: "fonts", weight: 3, machine: true, highEntropy: true },
  { key: "codecs", weight: 2, machine: true },
  { key: "mimeTypes", weight: 1, machine: true },
  // Browser traits: strong evidence, never identity. The screen geometry of the current window, the
  // GPU strings the browser's WebGL layer reports, and the rendering digests are exactly what two
  // browsers on one computer disagree about — a privacy browser randomizes the rendering stack on
  // purpose, and a second window sits on a different monitor.
  { key: "screenGeometry", weight: 5 },
  { key: "gpu", weight: 6, highEntropy: true, graphics: true },
  { key: "gpuLimits", weight: 5, highEntropy: true, graphics: true },
  { key: "gpuExtensions", weight: 2, graphics: true },
  { key: "graphics", weight: 4, highEntropy: true, graphics: true },
  { key: "canvas", weight: 4, highEntropy: true, graphics: true },
  { key: "audio", weight: 3, highEntropy: true, graphics: true },
  { key: "webgl", weight: 3, highEntropy: true, graphics: true },
  { key: "speechVoices", weight: 2, highEntropy: true },
  // Presentation: the browser's own description of itself. Cheap to change, worth little — and the
  // only group a user-agent switcher moves, which is why a change here against a machine we already
  // know is read as tampering rather than as a new device.
  { key: "platform", weight: 2, presentation: true },
  { key: "osFamily", weight: 2, presentation: true },
  { key: "browserFamily", weight: 1, presentation: true },
  { key: "platformVersion", weight: 1, presentation: true },
  { key: "architecture", weight: 1, presentation: true },
  { key: "bitness", weight: 1, presentation: true },
  // Environment: user- and profile-scoped, so evidence only.
  { key: "timezone", weight: 3 },
  { key: "timezoneOffset", weight: 2 },
  { key: "locale", weight: 2 },
  { key: "languagesClass", weight: 2 },
  { key: "languageClass", weight: 1 },
  { key: "storageBucket", weight: 2 },
  { key: "keyboardLayout", weight: 2 },
  { key: "plugins", weight: 1 },
  { key: "pdfViewer", weight: 1 },
];

const FEATURE_BY_KEY = new Map(DEVICE_FEATURES.map((feature) => [feature.key, feature]));

/** How many machine traits a machine key needs before it is allowed to be an identity. */
export const MIN_MACHINE_FEATURES = 4;

/**
 * How many class traits must have been reported by both sides before a positive verdict may rest on
 * them. Both class traits are Chromium-only signals: `navigator.deviceMemory` does not exist in
 * Firefox or Safari, so a cross-engine pair compares only the CPU class and falls through to the
 * similarity sweep instead. That path is safe — an ambiguous verdict against a record that holds a
 * live lease is still denied — it just is not the fast identity path.
 */
export const MIN_MACHINE_CLASS_FEATURES = 2;

/** Bounded profile growth: five recent digests per feature is enough for real drift, and finite. */
export const MAX_FEATURE_VALUES = 5;

/** A feature map holds only known keys, so a hostile payload cannot grow the document. */
export type DeviceFeatureMap = Record<string, string>;

function put(map: DeviceFeatureMap, key: string, value: string | number | null): void {
  // `0` is the "unknown" bucket for the numeric signals, and `unknown` is the label the rest use:
  // an unreported feature must be absent from the map so it can never be compared as evidence.
  if (value === null || value === 0) return;
  const text = String(value).trim();
  if (!text || text.toLowerCase() === "unknown") return;
  map[key] = text;
}

/** The comparable feature values for one observation. Absent values are omitted, never defaulted. */
export function buildFeatureMap(signals: NormalizedDeviceSignals): DeviceFeatureMap {
  const map: DeviceFeatureMap = {};
  put(map, "screenGeometry", signals.screenGeometry);
  put(map, "screenDepth", signals.screenDepth);
  put(map, "pixelRatio", signals.pixelRatioBucket);
  put(map, "hardwareConcurrency", signals.hardwareConcurrencyBucket);
  put(map, "deviceMemory", signals.deviceMemoryBucket);
  put(map, "touchPoints", signals.touchPointsBucket);
  put(map, "gpu", signals.gpu);
  put(map, "gpuLimits", signals.gpuLimits);
  put(map, "gpuExtensions", signals.gpuExtensions);
  put(map, "graphics", signals.graphics);
  put(map, "audioDevice", signals.audioDevice);
  put(map, "colorGamut", signals.colorGamut);
  put(map, "hdrCapable", signals.hdrCapable);
  put(map, "canvas", signals.canvasHash);
  put(map, "audio", signals.audioHash);
  put(map, "fonts", signals.fontsHash);
  put(map, "webgl", signals.webglHash);
  put(map, "speechVoices", signals.speechVoicesHash);
  put(map, "platform", signals.platform);
  put(map, "osFamily", signals.osFamily);
  put(map, "browserFamily", signals.browserFamily);
  put(map, "platformVersion", signals.platformVersion);
  put(map, "architecture", signals.architecture);
  put(map, "bitness", signals.bitness);
  put(map, "timezone", signals.timezone);
  put(map, "timezoneOffset", signals.timezoneOffsetBucket);
  put(map, "locale", signals.locale);
  put(map, "languagesClass", signals.languagesClass);
  put(map, "languageClass", signals.languageClass);
  put(map, "mediaInputs", signals.mediaInputsBucket);
  put(map, "storageBucket", signals.storageBucket);
  put(map, "codecs", signals.codecs);
  put(map, "keyboardLayout", signals.keyboardLayout);
  put(map, "plugins", signals.plugins);
  put(map, "mimeTypes", signals.mimeTypes);
  put(map, "pdfViewer", signals.pdfViewer);
  return map;
}

/**
 * Whether a feature is part of the browser's self-description (what a user-agent switcher edits).
 *
 * Used to tell "this machine told us a different story about which browser it is" — suspicious on a
 * machine we already know — from "this machine changed".
 */
export function isPresentationFeature(key: string): boolean {
  return FEATURE_BY_KEY.get(key)?.presentation === true;
}

/** Whether a feature is part of the rendering stack (canvas, audio, WebGL, GPU limits). */
export function isRenderingFeature(key: string): boolean {
  return FEATURE_BY_KEY.get(key)?.graphics === true;
}

/** Only the machine traits: the basis of the machine identity. */
export function machineFeatureMap(features: DeviceFeatureMap): DeviceFeatureMap {
  const machine: DeviceFeatureMap = {};
  for (const [key, value] of Object.entries(features)) {
    if (FEATURE_BY_KEY.get(key)?.machine) machine[key] = value;
  }
  return machine;
}

export function featureDigest(secret: Buffer, key: string, value: string): string {
  return hmacHex(secret, `lmdg-feat-v1:${key}`, value).slice(0, 32);
}

/** Reduces a feature map to keyed digests. What is stored is never the observed value. */
export function digestFeatureMap(secret: Buffer, map: DeviceFeatureMap): DeviceFeatureMap {
  const digests: DeviceFeatureMap = {};
  for (const [key, value] of Object.entries(map)) {
    if (!FEATURE_BY_KEY.has(key)) continue;
    digests[key] = featureDigest(secret, key, value);
  }
  return digests;
}

/**
 * The machine identity: one keyed digest over the machine traits, ordered by key so the value is
 * canonical. Two browsers on one computer produce the same machine key, because none of the traits
 * it covers is produced by the browser's rendering layer; two machines that share every machine
 * trait would too, which is the price of a hard one-machine rule.
 *
 * Returns null when too few machine traits were reported for the key to mean anything, in which
 * case the caller falls back to the browser-scoped key rather than inventing an identity.
 */
export function machineKeyHash(secret: Buffer, features: DeviceFeatureMap): string | null {
  const entries = Object.entries(machineFeatureMap(features)).sort(([left], [right]) => left.localeCompare(right));
  if (entries.length < MIN_MACHINE_FEATURES) return null;
  const material = entries.map(([key, value]) => `${key}=${featureDigest(secret, key, value)}`).join("&");
  return hmacHex(secret, "lmdg-machine-v1", material);
}

/**
 * Which machine traits a machine key was built from, as digests — stored so an operator can see
 * *why* two accounts shared a machine, and so a later observation can be matched against it.
 */
export function machineProfileOf(secret: Buffer, features: DeviceFeatureMap): MiningDeviceFeatureProfile {
  return learnFeatureProfile(null, digestFeatureMap(secret, machineFeatureMap(features)));
}

/**
 * Folds one observation into a device profile: each feature keeps its most recent (bounded) set of
 * digests plus an observation count. Returns a new profile; the input is never mutated.
 */
export function learnFeatureProfile(
  profile: MiningDeviceFeatureProfile | null | undefined,
  observedDigests: DeviceFeatureMap,
): MiningDeviceFeatureProfile {
  const next: MiningDeviceFeatureProfile = {};
  for (const [key, entry] of Object.entries(profile ?? {})) {
    if (!FEATURE_BY_KEY.has(key)) continue;
    next[key] = { digests: [...entry.digests].slice(-MAX_FEATURE_VALUES), count: entry.count };
  }
  for (const [key, digest] of Object.entries(observedDigests)) {
    const entry = next[key] ?? { digests: [], count: 0 };
    const kept = entry.digests.filter((value) => value !== digest);
    next[key] = { digests: [...kept, digest].slice(-MAX_FEATURE_VALUES), count: entry.count + 1 };
  }
  return next;
}

// ---------------------------------------------------------------------------
// Weighted agreement
// ---------------------------------------------------------------------------

export interface DeviceCandidateFeatures {
  /** Learned digest history; null for records created before the profile existed. */
  featureProfile: MiningDeviceFeatureProfile | null;
  /** Latest observation as raw normalized buckets; the fallback when there is no profile. */
  featureSnapshot: DeviceFeatureMap | null;
  browserKeyPublicKey: string | null;
  fingerprintVisitorIdHash: string | null;
}

export interface ClusterMatch {
  /** Weighted agreement over the features both sides reported, 0..100. */
  score: number;
  matched: string[];
  drifted: string[];
  /** Machine traits agreed on — the evidence that says "same machine". */
  matchedMachine: string[];
  /** Weighted agreement over the *machine* traits both sides reported, 0..100. */
  machineScore: number;
  /** Class traits (CPU class, memory class) both sides reported. */
  classCompared: string[];
  /** Class traits the two sides disagree about: a difference of machine, not of browser. */
  classDrifted: string[];
  /** A high-entropy trait the candidate has already shown that this observation omits. */
  missingHighEntropy: boolean;
  /** A rendering-stack trait agreed on — corroboration, never required for a verdict. */
  matchedGraphics: boolean;
}

export interface ObservedFeatures {
  digests: DeviceFeatureMap;
  raw: DeviceFeatureMap;
  /** The hardware-only subset in raw form, kept so the machine key can be recomputed per record. */
  machine: DeviceFeatureMap;
}

/**
 * Weighted agreement of one observation against one candidate device.
 *
 * Only features *both* sides reported take part, so a device that simply cannot expose a trait
 * (Safari has no `deviceMemory`) is not penalised for it. A feature matches when the observed
 * digest is anywhere in the candidate's learned ring, or — for records with no profile — when its
 * latest snapshot (digested here) agrees with the observation.
 *
 * Three figures come out of the same pass: the overall agreement (`score`), the agreement over the
 * machine traits alone (`machineScore`, the one a verdict is allowed to use), and the class traits
 * the two sides disagreed about (`classDrifted`, which veto a verdict).
 */
export function matchDeviceFeatures(
  candidate: DeviceCandidateFeatures,
  observed: ObservedFeatures,
  secret: Buffer,
): ClusterMatch {
  let totalWeight = 0;
  let matchedWeight = 0;
  let machineWeight = 0;
  let machineMatchedWeight = 0;
  const matched: string[] = [];
  const drifted: string[] = [];
  const matchedMachine: string[] = [];
  const classCompared: string[] = [];
  const classDrifted: string[] = [];
  let missingHighEntropy = false;
  let matchedGraphics = false;

  for (const feature of DEVICE_FEATURES) {
    const observedDigest = observed.digests[feature.key];
    const ring = candidate.featureProfile?.[feature.key]?.digests ?? [];
    const snapshotValue = candidate.featureSnapshot?.[feature.key];
    const snapshotDigest = snapshotValue ? featureDigest(secret, feature.key, snapshotValue) : undefined;
    const candidateHasEvidence = ring.length > 0 || snapshotDigest !== undefined;

    if (!candidateHasEvidence) continue;
    if (!observedDigest) {
      if (feature.highEntropy) missingHighEntropy = true;
      continue;
    }
    totalWeight += feature.weight;
    const agreed = ring.includes(observedDigest) || snapshotDigest === observedDigest;
    if (feature.machine) {
      machineWeight += feature.weight;
      if (feature.machineClass) {
        classCompared.push(feature.key);
        if (!agreed) classDrifted.push(feature.key);
      }
      if (agreed) {
        machineMatchedWeight += feature.weight;
        matchedMachine.push(feature.key);
      }
    }
    if (agreed) {
      matchedWeight += feature.weight;
      matched.push(feature.key);
      if (feature.graphics) matchedGraphics = true;
    } else {
      drifted.push(feature.key);
    }
  }

  const score = totalWeight === 0 ? 0 : Math.round((matchedWeight / totalWeight) * 100);
  const machineScore = machineWeight === 0 ? 0 : Math.round((machineMatchedWeight / machineWeight) * 100);
  return { score, matched, drifted, matchedMachine, machineScore, classCompared, classDrifted, missingHighEntropy, matchedGraphics };
}

export type ClusterVerdict = "same" | "ambiguous" | "different";

/**
 * A positive "same device" verdict is a statement about the *computer*, so it is decided on the
 * machine traits and never on the rendering stack.
 *
 * A class disagreement — the CPU or memory class the two sides report differs — is a disagreement
 * about the machine itself and no amount of agreement elsewhere overrules it, not even a rendering
 * stack that matches byte for byte. It is not a "different machine" verdict either: a computer does
 * not change its core count or its memory class, so the honest reading is that one of the two
 * observations is not describing the machine truthfully. That lands in the middle, where it is
 * evidence for the risk engine rather than a decision.
 *
 * With the class agreed, the verdict is the machine-trait agreement. This is the path that
 * recognises one computer running two browsers — including a privacy browser that randomizes
 * canvas, audio and WebGL and reports its GPU as `brave`, and a second window on a different
 * monitor — which a rendering-gated rule cannot, because those are exactly the traits it would
 * require to agree.
 *
 * The strict legacy path stays for a machine whose class traits were never reported by either side:
 * full agreement, rendering stack included.
 *
 * `ambiguous` is the conservative middle: enough agreement to be worth a challenge or a risk bump,
 * not enough to deny a start on. `different` never blocks anything on its own.
 */
export function decideClusterMatch(match: ClusterMatch, highThreshold: number, ambiguousThreshold: number): ClusterVerdict {
  if (match.classDrifted.length > 0) {
    return match.score >= ambiguousThreshold ? "ambiguous" : "different";
  }
  if (match.classCompared.length >= MIN_MACHINE_CLASS_FEATURES && match.machineScore >= highThreshold) return "same";
  if (match.score >= highThreshold && match.matchedGraphics) return "same";
  if (match.score >= ambiguousThreshold) return "ambiguous";
  return "different";
}
