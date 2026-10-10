import { createHmac, createPublicKey } from "node:crypto";
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
 *      system* rather than to the browser session, and that every engine reports identically: CPU
 *      class, pointer touch class, negotiated audio device, display gamut, HDR capability and panel
 *      colour depth (see CORE_MACHINE_FEATURES). None of them is produced by the browser's
 *      rendering layer, so none of them moves when a second browser, a private window, a container
 *      tab or a cleared profile is used on the same computer — which is what makes the key an
 *      identity rather than a vote, and what makes it the namespace a mining lease is taken on.
 *
 *      Machine-level traits whose *observation* is engine policy rather than machine fact — the
 *      capture-device counts above all, plus the engine-variant memory class, font and codec sets —
 *      stay weighted evidence: they corroborate a match when both sides report them and their drift
 *      is tamper evidence, but they no longer vote on the identity, because an engine that declines
 *      to answer for one of them would otherwise fork the key for the same computer.
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

/** Compare public key material, not JSON ordering, metadata or base64 padding. No hardware claim. */
export function canonicalBrowserKey(text: string | null): string | null {
  if (!text || text.length > 2048) return null;
  try {
    const jwk = JSON.parse(text) as Record<string, unknown>;
    if (jwk?.["kty"] !== "EC" || jwk["crv"] !== "P-256" || typeof jwk["x"] !== "string" || typeof jwk["y"] !== "string") return null;
    if (jwk["x"].length > 128 || jwk["y"].length > 128) return null;
    const key = createPublicKey({ key: { kty: "EC", crv: "P-256", x: jwk["x"], y: jwk["y"] }, format: "jwk" });
    const canonical = key.export({ format: "jwk" });
    return `${canonical.x}|${canonical.y}`;
  } catch {
    return null;
  }
}

export function visitorIdHash(secret: Buffer, visitorId: string | null): string | null {
  if (!visitorId || visitorId.length > 512) return null;
  return hmacHex(secret, "lmdg-visitor-v1", visitorId.trim().toLowerCase());
}

export function ipHash(secret: Buffer, ip: string | null): string | null {
  if (!ip) return null;
  return hmacHex(secret, "lmdg-ip-v1", ip.trim().toLowerCase());
}

/** A symmetric conflict token for two correlated records; it does not merge their identities. */
export function ambiguousLeaseKey(secret: Buffer, firstDeviceId: string, secondDeviceId: string): string {
  return hmacHex(secret, "lmdg-ambiguous-lease-v1", JSON.stringify([firstDeviceId, secondDeviceId].sort()));
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
  // Machine traits, engine-stable CORE: every engine reports the same values for these on one
  // computer. They are the identity (see machineKeyHash).
  { key: "hardwareConcurrency", weight: 3, machine: true, machineClass: true },
  { key: "touchPoints", weight: 1, machine: true },
  { key: "audioDevice", weight: 2, machine: true },
  { key: "colorGamut", weight: 1, machine: true },
  { key: "hdrCapable", weight: 1, machine: true },
  { key: "screenDepth", weight: 1, machine: true },
  // Machine traits, cross-engine-VARIANT: real properties of the computer, but their browser
  // measurement differs per engine (font probing runs through each engine's text stack; codec
  // support follows each browser's bundled media stack; navigator.deviceMemory does not exist in
  // Firefox; whether enumerateDevices answers at all — and how many devices it lists — is engine
  // policy and timing, not a fact about the machine). Weighted evidence and class-veto input, never
  // identity — one computer running four browsers used to yield four machine keys because of
  // exactly these.
  { key: "deviceMemory", weight: 2, machineClass: true },
  { key: "mediaInputs", weight: 2, machine: true },
  { key: "fonts", weight: 3, highEntropy: true },
  { key: "codecs", weight: 2 },
  { key: "mimeTypes", weight: 1 },
  // Browser traits: strong evidence, never identity. The screen geometry of the current window, the
  // GPU strings the browser's WebGL layer reports, and the rendering digests are exactly what two
  // browsers on one computer disagree about — a privacy browser randomizes the rendering stack on
  // purpose, and a second window sits on a different monitor. `pixelRatio` is here for the same
  // reason: it is the OS scale factor of the monitor the window currently sits on, so a second
  // display legitimately moves it — a splitting risk if it carried identity weight.
  { key: "screenGeometry", weight: 5 },
  { key: "pixelRatio", weight: 2 },
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

/**
 * The engine-stable machine core, in fixed slot order — the exact trait list and order the machine
 * key hashes. A trait the observing browser cannot see hashes as an explicit null slot, so the
 * material's shape never depends on which engine reported the observation.
 */
const CORE_MACHINE_FEATURES: readonly string[] = [
  "hardwareConcurrency",
  "touchPoints",
  "audioDevice",
  "colorGamut",
  "hdrCapable",
  "screenDepth",
];

/** The same core slots as a lookup set, for verdicts that must count identity slots only. */
export const CORE_MACHINE_FEATURE_SET: ReadonlySet<string> = new Set(CORE_MACHINE_FEATURES);

/**
 * The near-clone band: a candidate that agrees with a known record on at least four engine-stable
 * identity slots while at least two of the same six report different hardware.
 *
 * Both edges matter. Fewer than four agreements is not enough shared identity to say anything —
 * two ordinary machines can share a CPU class, a touch class and a panel depth. Two moved slots
 * is where a client that keeps a machine's identity while editing its hardware story lands —
 * measured: two accounts mined one computer by reporting the same CPU, touch class, panel depth
 * and HDR support with a different audio device and display gamut, on two networks, while the
 * weighted score stayed below the ambiguity threshold because the engine-owned corroborators
 * (fonts, capture devices, memory class) had also moved. The verdict is the conservative middle:
 * the one-machine rule refuses it while the known machine holds a live lease, and a genuinely
 * different machine is free to enroll once that machine stops. It is deliberately *not* "same":
 * the two observations are never merged into one record on this evidence.
 *
 * The band cannot be decided by the weighted score, because the corroborators it would weigh are
 * exactly the traits two browsers of one computer disagree about by construction; it is counted
 * on the identity slots alone.
 */
export const MIN_CORE_IDENTITY_AGREEMENTS = 4;
export const MIN_CORE_IDENTITY_MOVES = 2;

/** How many core slots must be reported before a machine key is allowed to exist. */
export const MIN_MACHINE_FEATURES = 4;

/**
 * How many class traits must have been reported by both sides before a positive verdict may rest on
 * them. One is enough, deliberately: `navigator.hardwareConcurrency` exists in every engine, while
 * `navigator.deviceMemory` does not exist in Firefox or Safari at all. Requiring two therefore made
 * a cross-engine pair structurally unable to produce a positive machine verdict — the comparison
 * fell through to the rendering-agreement path, which two engines can never satisfy because each
 * measures its own rendering stack (and a privacy browser randomizes it on purpose). That is exactly
 * how a Firefox start on a machine already mining in Chrome was admitted: it was denied by nothing,
 * because a console-verified Firefox and Chrome observation of one computer compared as "different".
 *
 * A disagreement about a class trait still vetoes the verdict outright; only the count requirement
 * changed.
 */
export const MIN_MACHINE_CLASS_FEATURES = 1;

/**
 * How many machine traits must have *agreed* before the machine path may return "same".
 *
 * Breadth, not only a high ratio: a comparison over one or two traits — a hardened client that
 * reports little more than its CPU class — scores 100% while saying nothing about which computer
 * this is, so it must not be allowed to carry a verdict. Three is the same "we know this machine"
 * bar the decision path uses when it weighs whether an observation looks like a known device (see
 * `uaChangedForKnownMachine` in service.ts).
 */
export const MIN_MACHINE_TRAITS_MATCHED = 3;

/** Bounded profile growth: five recent digests per feature is enough for real drift, and finite. */
export const MAX_FEATURE_VALUES = 5;

/**
 * A feature must have been seen this many times before a *contradiction* of it is treated as an
 * untrusted observation instead of drift. A brand-new record's first observation is its baseline
 * and cannot contradict anything; from the second, a value outside the ring is either drift or a
 * forgery, and learning stops deciding which until the shape repeats.
 */
export const LEARN_MIN_OBSERVATIONS = 2;

/**
 * How many observations of a drifted shape reset a feature's ring before the new value is trusted.
 *
 * It is what keeps poisoning from being cheap: an attacker cannot walk a stored identity to a value
 * of their choosing with one fabricated report — they would have to repeat the same forged shape
 * this many consecutive times, while the untrusted observations remain on the record for the risk
 * engine. A genuine change (a browser update, a new monitor) needs the same patience, which is the
 * honest price of a write path a hostile client can drive.
 */
export const LEARN_DRIFT_RESET_OBSERVATIONS = 3;

/** The result of folding one observation into a profile, including how it was allowed to learn. */
export interface LearnResult {
  profile: MiningDeviceFeatureProfile;
  /** A trusted observation: the value was seen before, or the feature had no baseline to contradict. */
  learned: string[];
  /** A contradiction of an established value: recorded as drift evidence, never folded in. */
  drift: string[];
}

/**
 * Whether a feature is established enough that a contradiction is drift rather than a baseline.
 * A feature absent from the profile, or observed only once, is still being learned.
 */
function featureEstablished(entry: { digests: string[]; count: number } | undefined): boolean {
  return entry !== undefined && entry.count >= LEARN_MIN_OBSERVATIONS;
}

/**
 * Whether an established feature's ring is worth keeping: not yet contradicted more times than
 * `LEARN_DRIFT_RESET_OBSERVATIONS` allows, so a repeated forged shape can eventually reset it.
 */
function featureReset(elapsed: number): boolean {
  return elapsed < LEARN_DRIFT_RESET_OBSERVATIONS;
}

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

/**
 * Reduces a feature map to keyed digests. What is stored is never the observed value.
 *
 * New records persist these digests as their snapshot (see service.ts): the database holds no
 * reversible fingerprint data. Records written before that change persist raw normalized buckets
 * instead, and the matcher below accepts both — a 32-hex snapshot value is compared as a digest,
 * anything else is digested with the secret first. A raw value that happens to be 32 hex therefore
 * compares as a digest and can only miss, never falsely match.
 */
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
 * canonical.
 *
 * The engine-stable CORE is what the hash actually covers: only the traits that every browser
 * engine — Chromium, Firefox, WebKit — reports identically on one physical computer, because none
 * of them passes through a rendering, media-stack or *permission* difference: the CPU core class,
 * the pointer touch class, the negotiated audio output device, the display gamut and HDR
 * capability, and the panel colour depth. Each trait occupies a FIXED slot, so a partially
 * reporting browser hashes over material of the same shape and length rather than a shorter one.
 *
 * A fixed slot is not enough on its own, and this is the trap the core has to keep clear of: a
 * `null` slot still differs from a present one, so any trait an engine may simply not answer for
 * forks the key for that engine even though the machine is the same. `mediaInputs` was in this list
 * and did exactly that — Firefox answers `enumerateDevices()` only once its media stack has
 * started, so a first start reports no capture devices at all, the same computer hashed to a second
 * machine key, and a second account could start a second cycle on it (observed in production: one
 * Windows machine, Chrome `1x1` capture devices against Firefox reporting none, two active cycles).
 * The rule is therefore: a trait belongs in the core only when every engine answers for it.
 *
 * Cross-engine-variant traits (installed fonts, codec support, memory class, the capture-device
 * counts, GPU strings, window geometry, presentation) are deliberately NOT in the core. They differ
 * across engines by construction — a font probe measures widths through each engine's own text
 * stack, codec support follows each browser's bundled media stack, `deviceMemory` does not exist in
 * Firefox, and whether `enumerateDevices` answers is engine policy and timing — so one computer
 * running Chrome and Firefox and Brave used to produce one machine key PER BROWSER and hold one
 * mining cycle each. They remain weighted evidence in the similarity sweep and their drift is
 * tamper evidence; they just no longer vote on the identity.
 *
 * Two machines that share every core trait produce the same key too, which is the honest price of
 * a hard one-machine rule in a browser-only architecture.
 *
 * Returns null when fewer than MIN_MACHINE_FEATURES core slots were reported, in which case the
 * caller falls back to the browser-scoped key rather than inventing an identity.
 */
export function machineKeyHash(secret: Buffer, features: DeviceFeatureMap): string | null {
  const present = CORE_MACHINE_FEATURES.filter((key) => features[key] !== undefined).length;
  if (present < MIN_MACHINE_FEATURES) return null;
  const material = CORE_MACHINE_FEATURES.map((key) => {
    const value = features[key];
    return `${key}=${value === undefined ? "null" : featureDigest(secret, key, value)}`;
  }).join("&");
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
  return learnFeatureProfileChecked(profile, observedDigests).profile;
}

/**
 * The controlled-learning fold: the profile write plus what the observation was allowed to teach.
 *
 * Trust is decided per feature, not per observation. A feature is *established* once it has been
 * seen `LEARN_MIN_OBSERVATIONS` times; an established feature whose ring does not contain the new
 * value is a contradiction — the value is recorded in the profile's own drift log (bounded like
 * everything else) and returned as evidence, but it does not enter the ring and does not replace
 * the established value. Only when the same contradictory shape repeats `LEARN_DRIFT_RESET_OBSERVATIONS`
 * consecutive times is the ring reset to the new value: a browser update or a new monitor earns its
 * way back with patience, while a forger has to repeat the identical forged shape — and leave the
 * drift evidence — to move a value, which is exactly the "train the server" path this closes.
 *
 * Known-shape observations (a value the ring already holds) are always trusted: real drift returns
 * repeatedly (the user opens the same second browser again), while poisoned values walk. The count
 * only ever moves with trusted observations, so forged reports cannot age out a value they dislike.
 */
export function learnFeatureProfileChecked(
  profile: MiningDeviceFeatureProfile | null | undefined,
  observedDigests: DeviceFeatureMap,
): LearnResult {
  const next: MiningDeviceFeatureProfile = {};
  const drift: string[] = [];
  const learned: string[] = [];
  // Kept verbatim, then re-bounded by each write below: unknown keys cannot enter the profile, and
  // the contradiction log cannot exceed what a fold of this observation can produce.
  for (const [key, entry] of Object.entries(profile ?? {})) {
    if (!FEATURE_BY_KEY.has(key)) continue;
    next[key] = { digests: [...entry.digests].slice(-MAX_FEATURE_VALUES), count: entry.count, ...(entry.drift === undefined ? {} : { drift: [...entry.drift].slice(-MAX_FEATURE_VALUES) }) };
  }
  for (const [key, digest] of Object.entries(observedDigests)) {
    const entry = next[key] ?? { digests: [], count: 0 };
    if (entry.digests.includes(digest)) {
      // Seen before: drift only unlearns what nothing confirms. A repeat of a known shape is the
      // confirmation that resets a contradiction run.
      const kept = entry.digests.filter((value) => value !== digest);
      next[key] = { digests: [...kept, digest].slice(-MAX_FEATURE_VALUES), count: entry.count + 1, drift: [] };
      learned.push(key);
      continue;
    }
    const driftRun = entry.drift ?? [];
    // The reset run is *consecutive repeats of the same value*: a different contradiction restarts
    // it instead of extending it, so three different values can never pool their counts to smuggle
    // a fourth arbitrary value into the trusted ring.
    const run = driftRun.length > 0 && driftRun[driftRun.length - 1] !== digest ? [] : driftRun;
    if (featureEstablished(entry) && featureReset(run.length)) {
      // Established value, contradiction not yet repeated enough times: record, never learn.
      next[key] = { digests: entry.digests, count: entry.count, drift: [...run, digest].slice(-MAX_FEATURE_VALUES) };
      drift.push(key);
      continue;
    }
    // New feature, or a contradiction that has repeated enough consecutive times to be trusted:
    // the value enters the ring (and a reset clears the run).
    const kept = entry.digests.filter((value) => value !== digest);
    next[key] = { digests: [...kept, digest].slice(-MAX_FEATURE_VALUES), count: entry.count + 1, drift: [] };
    learned.push(key);
  }
  return { profile: next, learned, drift };
}

// ---------------------------------------------------------------------------
// Weighted agreement
// ---------------------------------------------------------------------------

export interface DeviceCandidateFeatures {
  /** Learned digest history; null for records created before the profile existed. */
  featureProfile: MiningDeviceFeatureProfile | null;
  /**
   * Latest observation as keyed digests on new records, or as raw normalized buckets on records
   * written before digest snapshots; the fallback when there is no profile. Never raw PII going
   * forward — see `digestFeatureMap`.
   */
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
 * digest is anywhere in the candidate's learned ring, is the value the candidate was observed
 * contradicting itself with (a repeated drift is as identifying as a stored value, and it is how a
 * genuinely moving value stays comparable during the reset window), or — for records with no
 * profile — when its latest snapshot (digested here) agrees with the observation.
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
    const entry = candidate.featureProfile?.[feature.key];
    const ring = entry?.digests ?? [];
  // A value the candidate was observed contradicting itself with: during the reset window it is
  // as identifying as a stored value (except for class traits, where it must still veto), and
  // without it a genuinely moving trait would be blind to the candidate for
  // LEARN_DRIFT_RESET_OBSERVATIONS observations.
    const driftRing = entry?.drift ?? [];
    const snapshotValue = candidate.featureSnapshot?.[feature.key];
    // Snapshots persisted as digests compare directly; legacy raw snapshots are digested here.
    const snapshotDigest =
      snapshotValue === undefined
        ? undefined
        : /^[0-9a-f]{32}$/.test(snapshotValue)
          ? snapshotValue
          : featureDigest(secret, feature.key, snapshotValue);
    const candidateHasEvidence = ring.length > 0 || snapshotDigest !== undefined;

    if (!candidateHasEvidence) continue;
    if (!observedDigest) {
      if (feature.highEntropy) missingHighEntropy = true;
      continue;
    }
    totalWeight += feature.weight;
    // A value the candidate was observed contradicting itself with is as identifying as a stored
    // value during the reset window — except for class traits. A CPU or memory class contradiction
    // is a difference of machine, so counting it as agreement would suppress the class veto and
    // let a reported contradiction help produce a "same machine" verdict.
    const driftAgreed = !feature.machineClass && driftRing.includes(observedDigest);
    const agreed = ring.includes(observedDigest) || snapshotDigest === observedDigest || driftAgreed;
    // Class traits veto regardless of engine availability: they carry a difference of MACHINE, not
    // of browser. A trait one engine cannot report (deviceMemory in Firefox) is simply not compared.
    if (feature.machineClass) {
      classCompared.push(feature.key);
      if (!agreed) classDrifted.push(feature.key);
    }
    if (feature.machine) {
      machineWeight += feature.weight;
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
 * The near-clone band: the machine class was compared, and the two sides agree
 * on at least `MIN_CORE_IDENTITY_AGREEMENTS` core identity slots while at least
 * `MIN_CORE_IDENTITY_MOVES` of them moved.
 *
 * A class contradiction excludes the band: an honest computer does not change its CPU or memory
 * class, and two records that disagree there must not share an economic allowance.
 *
 * Exported because it is not only a verdict. A caller that binds an *economic* limit to the machine
 * (the shared 10h device quota) has to recognise the same band: a near clone is enrolled as its own
 * record with its own immutable anchor, so a quota keyed on that anchor alone would open a fresh
 * allowance beside the matched machine's stopped segment — one machine collecting an allowance per
 * edited slot. The verdict stays `ambiguous` (the record is still not merged, and a live lease on the
 * known machine still refuses the start); only the machine the allowance belongs to becomes shared.
 */
export function isNearCloneMatch(match: ClusterMatch): boolean {
  const matchedCoreSlots = match.matchedMachine.filter((key) => CORE_MACHINE_FEATURE_SET.has(key)).length;
  const movedCoreSlots = match.drifted.filter((key) => CORE_MACHINE_FEATURE_SET.has(key)).length;
  return (
    match.classDrifted.length === 0 &&
    match.classCompared.length >= MIN_MACHINE_CLASS_FEATURES &&
    matchedCoreSlots >= MIN_CORE_IDENTITY_AGREEMENTS &&
    movedCoreSlots >= MIN_CORE_IDENTITY_MOVES
  );
}

/**
 * The one identity slot two engines may disagree about while still describing one computer.
 *
 * `audioDevice` is read from the audio context each engine opens for the same hardware: it is a real
 * property of the machine, but the value each engine negotiates for it is not guaranteed to be the
 * same one. Every other core slot is read from the same place by every engine — CPU class, pointer
 * touch class, display gamut, HDR capability, panel depth — so at most one may move before the
 * evidence is describing some other computer.
 */
export const MAX_ENGINE_VARIANT_CORE_MOVES = 1;

/**
 * Whether the comparison says "this is the same computer" strongly enough to spend that computer's
 * mining allowance.
 *
 * This is a statement about the *machine*, so it is measured on the machine traits and never on the
 * overall agreement, which is diluted by the rendering stack two engines measure differently by
 * construction.
 *
 * The near clone is one band: the machine's hardware story moved by identity slots, so the record
 * stays separate — the machine is not merged — but the allowance it spends is the known machine's.
 *
 * The second band is the honest cross-engine pair the near clone does not cover, because only *one*
 * identity slot moved. It is the shape the near-clone test alone misses: a machine whose identity
 * slots agree (no CPU or memory class disagreement, at most one negotiated slot moved) while the
 * corroborators only one engine reports — the capture-device counts Firefox answers for only once
 * its media stack has started, the memory class it cannot report at all — and the whole rendering
 * stack differ, as two engines' do by construction. That pair lands *below* the "same" line on the
 * diluted overall score while the machine itself is not in question, and `different` is not a neutral
 * outcome: it enrolls the observation as a new machine with its own immutable anchor, and that anchor
 * is its own 10-hour allowance in the same window. One computer collecting two allowances is the
 * exact failure this band exists to prevent.
 *
 * It cannot over-reach onto the pinned SLOT-EDIT BOUNDARY rows: every row from two moved identity
 * slots on is outside it — the row's own assertion is that the number of moved identity slots equals
 * the number of edits — and the single-moved row is `same` before this band is consulted.
 *
 * The price is the one the near clone already pays and this model already documents: two genuinely
 * different machines of one model that drift a single identity slot and agree on the rest spend one
 * allowance, and a start beside the other's live lease is refused. Breadth keeps that narrow — the
 * band needs at least MIN_MACHINE_TRAITS_MATCHED agreed machine traits, so a machine that shares no
 * more than a CPU class cannot reach it.
 */
export function isMachineIdentityMatch(match: ClusterMatch, ambiguousThreshold: number): boolean {
  if (isNearCloneMatch(match)) return true;
  // A class contradiction is a difference of machine, or an observation that is not describing the
  // machine truthfully: either way it may not share the allowance.
  if (match.classDrifted.length > 0) return false;
  if (match.classCompared.length < MIN_MACHINE_CLASS_FEATURES) return false;
  const movedCoreSlots = match.drifted.filter((key) => CORE_MACHINE_FEATURE_SET.has(key)).length;
  return (
    movedCoreSlots <= MAX_ENGINE_VARIANT_CORE_MOVES &&
    match.matchedMachine.length >= MIN_MACHINE_TRAITS_MATCHED &&
    match.machineScore >= ambiguousThreshold
  );
}

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
 * With the class compared and not contradicted, the verdict is the machine-trait agreement: enough
 * breadth (MIN_MACHINE_TRAITS_MATCHED machine traits both sides reported and agreed on) at a high
 * enough ratio (`machineScore`). This is the path that recognises one computer running two browsers
 * — including a genuinely different engine, which cannot report `navigator.deviceMemory`, measures
 * its own font and codec sets, and answers for its capture devices only when its media stack is
 * running — and also a privacy browser that randomizes canvas, audio and WebGL and reports its GPU
 * as `brave`. A rendering-gated rule cannot do it, because those are exactly the traits the engines
 * disagree about, and a class-count rule that demanded both class traits could not either.
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
  // A known machine whose hardware story moved by identity slots, however well its browser traits
  // agree: a client reporting someone else's machine with edited hardware looks like this, and so
  // does a genuine machine of a very similar model. The conservative middle — refused while the
  // known machine is mining, then enrolable — is the honest answer for both.
  if (isNearCloneMatch(match)) {
    return "ambiguous";
  }
  if (
    match.classCompared.length >= MIN_MACHINE_CLASS_FEATURES &&
    match.matchedMachine.length >= MIN_MACHINE_TRAITS_MATCHED &&
    match.machineScore >= highThreshold
  ) return "same";
  if (match.score >= highThreshold && match.matchedGraphics) return "same";
  // One computer behind two engines whose identity slots agree while the engine-owned corroborators
  // do not: the conservative middle. It is ambiguous rather than different on purpose — different
  // would mint a second machine identity, and therefore a second mining allowance, for one computer.
  if (isMachineIdentityMatch(match, ambiguousThreshold)) return "ambiguous";
  if (match.score >= ambiguousThreshold) return "ambiguous";
  return "different";
}

/**
 * Near-miss parallel-mining telemetry predicate — detection only, never a verdict.
 *
 * True only when `decideClusterMatch` says "different" yet the machine traits alone agree at the
 * ambiguous level with no class contradiction: the edited-identity shape (three or more of the six
 * engine-stable slots moved) that mints a second machine record — and therefore a second mining
 * allowance — for one computer. Blocking it would bind unrelated machines of one model onto a
 * single allowance (measured: hundreds of distinct fixture pairs), so admission only audits it:
 * an allow beside a live foreign lease on these keys emits `mining_device_suspicious` for the ops
 * report instead of refusing an honest user.
 */
export function isParallelMiningRisk(match: ClusterMatch, highThreshold: number, ambiguousThreshold: number): boolean {
  if (decideClusterMatch(match, highThreshold, ambiguousThreshold) !== "different") return false;
  if (match.classDrifted.length > 0) return false;
  if (match.classCompared.length < MIN_MACHINE_CLASS_FEATURES) return false;
  return match.machineScore >= ambiguousThreshold;
}
