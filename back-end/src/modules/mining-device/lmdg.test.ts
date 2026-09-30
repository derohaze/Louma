import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bucketDeviceMemory,
  bucketHardwareConcurrency,
  bucketLanguageClass,
  bucketMediaInputs,
  bucketPixelRatio,
  bucketPlatformVersion,
  bucketScreenClass,
  bucketScreenDepth,
  bucketTimezoneOffset,
  detectImpossibleUaPlatform,
  ipFamilyOf,
  normalizeSignals,
  parseBrowserFamily,
  parseOsFamily,
  sanitizeEvidence,
  type NormalizedDeviceSignals,
} from "./signals.js";
import {
  buildFeatureMap,
  decideClusterMatch,
  deviceKeyHash,
  digestFeatureMap,
  hmacHex,
  isPresentationFeature,
  isRenderingFeature,
  learnFeatureProfile,
  machineFeatureMap,
  machineKeyHash,
  MIN_MACHINE_FEATURES,
  matchDeviceFeatures,
  normalizedDeviceSignature,
  buildNormalizedVector,
  type ObservedFeatures,
} from "./identity.js";
import { evaluateMiningDeviceTrust } from "./risk.js";
import { detectEvidenceContradictions, detectSimultaneousTraitReplacement } from "./consistency.js";
import { consumeEnrollmentBudget, nextTrustState, trustStateOf } from "./enrollment.js";

/**
 * LMDG unit tests: pure domain logic without a database.
 *
 * These pin the security-relevant invariants: normalization buckets, keyed (never plain) hashes,
 * a matching model that refuses to treat shared Wi-Fi as shared hardware but recognises one machine
 * across browsers and harmless drift, and a deterministic risk engine whose lease-conflict rule
 * denies another account's active device.
 */

const SECRET = Buffer.alloc(32, 7);

const CHROME_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const FIREFOX_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0";

/** A machine's evidence as the client sends it, with per-test overrides. */
function evidence(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    fingerprintConfidence: 0.95,
    fingerprintVersion: "v5",
    platform: "Win32",
    userAgent: CHROME_UA,
    screenWidth: 1920,
    screenHeight: 1080,
    pixelRatio: 1,
    timezone: "Africa/Cairo",
    timezoneOffsetMinutes: -180,
    language: "en-US",
    hardwareConcurrency: 8,
    deviceMemory: 8,
    maxTouchPoints: 0,
    webglHash: "webgl-x",
    canvasHash: "canvas-x",
    audioHash: "audio-x",
    fontsHash: "fonts-x",
    colorGamut: "srgb",
    mediaAudioInputs: 1,
    mediaVideoInputs: 1,
    platformVersion: "10.0.0",
    integrity: { webdriver: false, headlessHint: false, impossibleUaPlatform: false, missingCapabilities: false },
    ...overrides,
  };
}

function observedOf(rawEvidence: Record<string, unknown>): { features: ObservedFeatures; signals: NormalizedDeviceSignals } {
  const signals = normalizeSignals(sanitizeEvidence(rawEvidence));
  const raw = buildFeatureMap(signals);
  return { features: { raw, digests: digestFeatureMap(SECRET, raw), machine: machineFeatureMap(raw) }, signals };
}

function profileOf(rawEvidence: Record<string, unknown>) {
  const { features } = observedOf(rawEvidence);
  return { features, profile: learnFeatureProfile(null, features.digests) };
}

test("signal buckets absorb small hardware differences but keep machines apart", () => {
  assert.equal(bucketHardwareConcurrency(7), 8);
  assert.equal(bucketHardwareConcurrency(8), 8);
  assert.equal(bucketHardwareConcurrency(null), 0);
  assert.equal(bucketDeviceMemory(16), 16);
  assert.equal(bucketDeviceMemory(null), null);
  assert.equal(bucketScreenClass(1920, 1080), "medium");
  assert.equal(bucketScreenClass(null, null), "unknown");
  assert.equal(bucketLanguageClass("en-US"), "en");
  assert.equal(bucketLanguageClass(null), "unknown");
  assert.equal(ipFamilyOf("1.2.3.4"), "ipv4");
  assert.equal(ipFamilyOf("::1"), "ipv6");
});

test("display, timezone and capture-device traits bucket into stable labels", () => {
  assert.equal(bucketPixelRatio(1), "dpr-1");
  assert.equal(bucketPixelRatio(1.25), "dpr-1.25");
  assert.equal(bucketPixelRatio(0), "unknown");
  assert.equal(bucketTimezoneOffset(-180), "utc+3");
  assert.equal(bucketTimezoneOffset(300), "utc-5");
  assert.equal(bucketTimezoneOffset(0), "utc+0");
  assert.equal(bucketMediaInputs(1, 1), "1x1");
  assert.equal(bucketMediaInputs(4, 0), "3+x0");
  assert.equal(bucketMediaInputs(null, null), "unknown");
  assert.equal(bucketPlatformVersion("10.0.22631"), "pv-10.0");
  assert.equal(bucketPlatformVersion(null), "unknown");
  assert.equal(bucketScreenDepth(24), "depth-24");
  assert.equal(bucketScreenDepth(30), "depth-30");
  assert.equal(bucketScreenDepth(null), "unknown");
  assert.equal(bucketScreenDepth(0), "unknown");
});

test("UA parsing spots the common families and impossible combinations", () => {
  assert.equal(parseOsFamily(CHROME_UA, "Win32"), "windows");
  assert.equal(parseBrowserFamily(CHROME_UA), "chrome");
  assert.equal(parseBrowserFamily(FIREFOX_UA), "firefox");
  assert.equal(
    detectImpossibleUaPlatform("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)", "Win32"),
    true,
  );
  assert.equal(detectImpossibleUaPlatform(CHROME_UA, "Win32"), false);
});

test("evidence sanitization drops hostile shapes and oversized values", () => {
  const sanitized = sanitizeEvidence({
    visitorId: "abc123",
    fingerprintConfidence: 5,
    platform: "  Win32  ",
    userAgent: "x".repeat(10_000),
    screenWidth: Number.NaN,
    integrity: { webdriver: true, headlessHint: "yes" },
    extra: "ignored",
  });
  assert.equal(sanitized.visitorId, "abc123");
  assert.equal(sanitized.fingerprintConfidence, 1);
  assert.equal(sanitized.platform, "  Win32  ");
  assert.equal(sanitized.userAgent?.length, 512, "an oversized UA is truncated, not dropped");
  assert.equal(sanitized.screenWidth, null);
  assert.equal(sanitized.integrity?.webdriver, true);
  assert.equal(sanitized.integrity?.headlessHint, null);
  const normalized = normalizeSignals(sanitized);
  assert.equal(normalized.platform, "win32");
});

test("collector failures never become shared evidence", () => {
  // Two machines with blocked WebGL both report "no-webgl"; that must not read as a shared trait.
  const { features } = observedOf(evidence({ webglHash: "no-webgl", canvasHash: "canvas-error", audioHash: "no-audio" }));
  assert.equal(features.raw["webgl"], undefined);
  assert.equal(features.raw["canvas"], undefined);
  assert.equal(features.raw["audio"], undefined);
  assert.equal(features.raw["fonts"], "fonts-x");
});

test("device hashes are keyed HMACs, deterministic per secret, and secret-sensitive", () => {
  const vector = buildNormalizedVector(
    normalizeSignals(sanitizeEvidence({ platform: "Win32", timezone: "Africa/Cairo" })),
    { ipFamily: "ipv4", asn: "AS123", country: "EG" },
  );
  const first = normalizedDeviceSignature(SECRET, vector);
  assert.equal(first, normalizedDeviceSignature(SECRET, vector));
  assert.equal(first.length, 64);
  assert.notEqual(first, normalizedDeviceSignature(Buffer.alloc(32, 8), vector));
  assert.notEqual(first, hmacHex(SECRET, "other-domain", vector));
  const keyA = deviceKeyHash(SECRET, "public-key-a", first);
  assert.notEqual(keyA, deviceKeyHash(SECRET, "public-key-b", first));
});

test("one machine behind two browsers is the same device", () => {
  const { profile } = profileOf(evidence());
  const firefox = observedOf(evidence({ userAgent: FIREFOX_UA }));
  const match = matchDeviceFeatures(
    { featureProfile: profile, featureSnapshot: null, browserKeyPublicKey: "key-chrome", fingerprintVisitorIdHash: "v1" },
    firefox.features,
    SECRET,
  );
  assert.ok(match.matchedGraphics, "the rendering stack agreed");
  assert.ok(match.score >= 90, `same machine, different browser must correlate, got ${match.score}`);
  assert.equal(decideClusterMatch(match, 78, 55), "same");
});

test("two different laptops on the same home Wi-Fi do not collapse into one device", () => {
  const laptopX = profileOf(evidence());
  const laptopY = observedOf(
    evidence({
      platform: "MacIntel",
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15",
      screenWidth: 2560,
      screenHeight: 1600,
      pixelRatio: 2,
      hardwareConcurrency: 16,
      platformVersion: "14.5.0",
      webglHash: "webgl-y",
      canvasHash: "canvas-y",
      audioHash: "audio-y",
      fontsHash: "fonts-y",
    }),
  );
  const match = matchDeviceFeatures(
    { featureProfile: laptopX.profile, featureSnapshot: null, browserKeyPublicKey: "key-x", fingerprintVisitorIdHash: "vx" },
    laptopY.features,
    SECRET,
  );
  assert.ok(match.score < 55, `shared Wi-Fi must not identify a machine, got ${match.score}`);
  assert.equal(decideClusterMatch(match, 78, 55), "different");
});

test("harmless drift keeps the device: the learned profile absorbs a changing field", () => {
  // A browser/driver update changes the canvas and audio digests. Without a profile the old score
  // would fall into "ambiguous"; with one, the machine is still itself.
  const { profile } = profileOf(evidence());
  const drifted = observedOf(evidence({ canvasHash: "canvas-updated", audioHash: "audio-updated" }));
  const match = matchDeviceFeatures(
    { featureProfile: profile, featureSnapshot: null, browserKeyPublicKey: "key-chrome", fingerprintVisitorIdHash: "v1" },
    drifted.features,
    SECRET,
  );
  assert.ok(match.score >= 78, `drift must not fork the device, got ${match.score}`);
  assert.equal(decideClusterMatch(match, 78, 55), "same");
  assert.ok(match.drifted.includes("canvas") && match.drifted.includes("audio"));
});

test("the learned ring keeps a previously seen value comparable", () => {
  const first = profileOf(evidence());
  const second = observedOf(evidence({ canvasHash: "canvas-v2" }));
  const merged = learnFeatureProfile(first.profile, second.features.digests);
  for (const observation of [first.features, second.features]) {
    const match = matchDeviceFeatures(
      { featureProfile: merged, featureSnapshot: null, browserKeyPublicKey: null, fingerprintVisitorIdHash: null },
      observation,
      SECRET,
    );
    assert.equal(match.score, 100, "both observed values stay in the profile");
  }
  assert.equal(merged["canvas"]?.digests.length, 2);
});

test("a hidden rendering stack no longer hides the machine, and is still recorded as tampering", () => {
  // Blanked canvas/audio/WebGL is what a spoofer does — and also what a privacy browser does on
  // purpose, which is why it must not fork the machine identity. The machine traits still agree, so
  // the verdict is "same"; the disappearance stays on the record and is what feeds the risk score.
  const { profile } = profileOf(evidence());
  const blank = observedOf(evidence({ webglHash: "no-webgl", canvasHash: "no-canvas", audioHash: "no-audio" }));
  const match = matchDeviceFeatures(
    { featureProfile: profile, featureSnapshot: null, browserKeyPublicKey: null, fingerprintVisitorIdHash: null },
    blank.features,
    SECRET,
  );
  assert.equal(match.matchedGraphics, false);
  assert.equal(match.missingHighEntropy, true, "the hidden high-entropy traits stay on the record");
  assert.deepEqual(match.classDrifted, [], "no class trait disagreed");
  assert.equal(decideClusterMatch(match, 78, 55), "same", "the machine traits are what identify the machine");
  // A rendering digest that *moves* rather than disappears is drift — recorded, and equally not a
  // new machine.
  const moved = matchDeviceFeatures(
    { featureProfile: profile, featureSnapshot: null, browserKeyPublicKey: null, fingerprintVisitorIdHash: null },
    observedOf(evidence({ canvasHash: "canvas-elsewhere" })).features,
    SECRET,
  );
  assert.ok(moved.drifted.some(isRenderingFeature), "the moved rendering digest is on the record");
  assert.equal(decideClusterMatch(moved, 78, 55), "same");
});

test("a different machine class is never a positive match, however much else agrees", () => {
  // Two machines of the same model but a different CPU SKU: everything the browser reports agrees,
  // and the CPU class does not. That is not one computer, and no amount of agreement overrules it.
  const { profile } = profileOf(evidence());
  const other = observedOf(evidence({ hardwareConcurrency: 16 }));
  const match = matchDeviceFeatures(
    { featureProfile: profile, featureSnapshot: null, browserKeyPublicKey: null, fingerprintVisitorIdHash: null },
    other.features,
    SECRET,
  );
  assert.deepEqual(match.classDrifted, ["hardwareConcurrency"]);
  // The class traits alone carry the veto, so the exact similarity ratio is calibration, not the
  // invariant — the machine core still mostly agrees, and is still never allowed to decide "same".
  assert.ok(match.machineScore >= 50, `everything else agrees, got ${match.machineScore}`);
  assert.equal(decideClusterMatch(match, 78, 55), "ambiguous", "the class disagreement is what vetoes a match");
});

test("one computer running two browsers is one machine, whatever the browsers disagree about", () => {
  // The reported bypass at the model level: the same computer, a second browser. The two
  // observations disagree about everything the *browser* owns — a privacy browser reports its GPU as
  // `brave`, randomizes the rendering digests, and the second window sits on another monitor — and
  // agree about everything the *computer* owns.
  const machine = {
    screenColorDepth: 24,
    audioSampleRate: 48000,
    audioChannels: 2,
    hdr: false,
    hardwareConcurrency: 16,
    deviceMemory: 16,
    pixelRatio: 1.25,
    mediaAudioInputs: 1,
    mediaVideoInputs: 1,
    timezone: "Africa/Cairo",
    timezoneOffsetMinutes: -180,
    fontsHash: "fonts-windows",
    codecsHash: "codecs-windows",
    mimeTypesHash: "mime-types-windows",
  };
  const chrome = observedOf(
    evidence({
      ...machine,
      screenWidth: 1536,
      screenHeight: 864,
      screenAvailWidth: 1536,
      screenAvailHeight: 816,
      webglVendor: "Google Inc. (AMD)",
      webglRenderer: "ANGLE (AMD, AMD Radeon(TM) Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)",
      webglLimitsHash: "limits-amd",
      webglExtensionsHash: "extensions-amd",
      webglHash: "webgl-amd",
      canvasHash: "canvas-chrome",
      audioHash: "audio-chrome",
      speechVoicesHash: "voices-chrome",
    }),
  );
  const privacyBrowser = observedOf(
    evidence({
      ...machine,
      screenWidth: 1680,
      screenHeight: 1050,
      screenAvailWidth: 1680,
      screenAvailHeight: 1050,
      webglVendor: "brave",
      webglRenderer: "brave",
      webglLimitsHash: "limits-brave",
      webglExtensionsHash: "extensions-brave",
      webglHash: "webgl-brave",
      canvasHash: "canvas-brave",
      audioHash: "audio-brave",
      speechVoicesHash: "voices-brave",
      locale: "en-GB",
      languages: "en-GB,en",
    }),
  );
  assert.equal(
    machineKeyHash(SECRET, privacyBrowser.features.raw),
    machineKeyHash(SECRET, chrome.features.raw),
    "one computer, one machine key — the browser traits are not part of it",
  );
  const match = matchDeviceFeatures(
    { featureProfile: learnFeatureProfile(null, chrome.features.digests), featureSnapshot: null, browserKeyPublicKey: "key-chrome", fingerprintVisitorIdHash: "visitor-chrome" },
    privacyBrowser.features,
    SECRET,
  );
  assert.deepEqual(match.classDrifted, []);
  assert.equal(match.machineScore, 100, "every machine trait both sides reported agrees");
  assert.equal(decideClusterMatch(match, 78, 55), "same");
  for (const drifted of ["gpu", "gpuLimits", "canvas", "audio", "webgl", "screenGeometry"]) {
    assert.ok(match.drifted.includes(drifted), `${drifted} moved with the browser and is recorded as drift`);
  }
});

test("a user-agent switch on one machine cannot move the machine key", () => {
  // The reported bypass: a browser extension changed the user agent, the weighted score fell below
  // the matching threshold, and the observation was classified as a different machine — so a second
  // account mined on the same computer. The machine key is built from machine traits only,
  // so the switch leaves it untouched: it is an identity, not one more vote in the score.
  const hardware = {
    screenWidth: 1920,
    screenHeight: 1080,
    screenAvailWidth: 1920,
    screenAvailHeight: 1040,
    screenColorDepth: 24,
    webglVendor: "Google Inc. (NVIDIA)",
    webglRenderer: "ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)",
    webglLimitsHash: "limits-rtx3060",
    webglExtensionsHash: "ext-rtx3060",
    webgpuHash: "webgpu-rtx3060",
    audioSampleRate: 48000,
    audioChannels: 2,
    hdr: false,
  };
  const before = observedOf(evidence({ ...hardware, platform: "Win32", userAgent: CHROME_UA }));
  const switched = observedOf(
    evidence({
      ...hardware,
      platform: "MacIntel",
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0 Safari/537.36",
      platformVersion: "14.6.0",
    }),
  );
  const beforeKey = machineKeyHash(SECRET, before.features.raw);
  const switchedKey = machineKeyHash(SECRET, switched.features.raw);
  assert.ok(beforeKey, "a machine key exists once machine traits are reported");
  assert.equal(switchedKey, beforeKey, "the user-agent switch must not create a second machine identity");
  assert.notEqual(before.signals.platform, switched.signals.platform, "the switch really moved the UA/platform");
  assert.notEqual(before.signals.osFamily, switched.signals.osFamily);

  // The score-based correlation is what the switch used to defeat: it drifts, the identity does not.
  const { profile } = profileOf(evidence({ ...hardware, platform: "Win32", userAgent: CHROME_UA }));
  const match = matchDeviceFeatures(
    { featureProfile: profile, featureSnapshot: null, browserKeyPublicKey: "key-chrome", fingerprintVisitorIdHash: "v1" },
    switched.features,
    SECRET,
  );
  assert.ok(match.matchedMachine.length >= 3, `the machine traits still agree, got ${match.matchedMachine.join(",")}`);
  assert.ok(match.drifted.some(isPresentationFeature), "the switch is visible as presentation drift");
});

test("the machine key survives what a browser randomizes and forks on what a machine changes", () => {
  const machine = {
    screenAvailWidth: 1920,
    screenAvailHeight: 1040,
    screenColorDepth: 24,
    audioSampleRate: 48000,
    audioChannels: 2,
    webglVendor: "Intel Inc.",
    webglRenderer: "Intel Iris OpenGL Engine",
    webglLimitsHash: "limits-intel",
  };
  const plain = observedOf(evidence({ ...machine }));
  const plainKey = machineKeyHash(SECRET, plain.features.raw);
  assert.ok(plainKey, "a machine key exists once machine traits are reported");
  // Randomized rendering digests, farbled GPU strings and a window on another display: all browser
  // traits, none of them the machine.
  const browserSide = observedOf(
    evidence({
      ...machine,
      webglVendor: "brave",
      webglRenderer: "brave",
      webglLimitsHash: "limits-brave",
      webglExtensionsHash: "extensions-brave",
      webglHash: "webgl-random",
      canvasHash: "canvas-random",
      audioHash: "audio-random",
      speechVoicesHash: "voices-random",
      screenWidth: 1680,
      screenHeight: 1050,
      screenAvailWidth: 1680,
      screenAvailHeight: 1050,
    }),
  );
  assert.equal(machineKeyHash(SECRET, browserSide.features.raw), plainKey, "browser traits must not fork the identity");
  // Fonts are cross-engine-variant evidence now (each engine probes widths through its own text
  // stack), so a different font set no longer forks the identity — it is scored drift instead.
  assert.equal(
    machineKeyHash(SECRET, observedOf(evidence({ ...machine, fontsHash: "fonts-other" })).features.raw),
    plainKey,
    "a cross-engine-variant font set is evidence, not a new machine",
  );
  assert.notEqual(
    machineKeyHash(SECRET, observedOf(evidence({ ...machine, hardwareConcurrency: 16 })).features.raw),
    plainKey,
    "a different CPU class is a different machine",
  );
  // Memory class is engine-variant (Firefox has no navigator.deviceMemory), so it vetoes similarity
  // verdicts instead of being a core slot — see the class-veto test.
  assert.equal(
    machineKeyHash(SECRET, observedOf(evidence({ ...machine, deviceMemory: 16 })).features.raw),
    plainKey,
    "an engine-variant memory class is evidence, not a new machine",
  );
});

test("a capture-device answer an engine never gives is not a second machine", () => {
  // Values read out of the production device records: one Windows machine — 16 cores, a depth-24
  // panel, no touch points, a 48 kHz stereo output, sRGB, no HDR — mined in Chrome and then mined
  // again in Firefox. Chrome enumerated `1x1` capture devices; Firefox answered for none, because
  // its media stack only starts on the first `enumerateDevices()` call. That single absence was
  // enough to fork the machine key and admit a second cycle on the same computer.
  const machine = {
    screenColorDepth: 24,
    audioSampleRate: 48000,
    audioChannels: 2,
    hdr: false,
    hardwareConcurrency: 16,
    pixelRatio: 1.25,
    deviceMemory: 16,
  };
  const enumerated = observedOf(evidence({ ...machine, mediaAudioInputs: 1, mediaVideoInputs: 1 }));
  const silent = observedOf(evidence({ ...machine, mediaAudioInputs: null, mediaVideoInputs: null }));
  const enumeratedKey = machineKeyHash(SECRET, enumerated.features.raw);
  assert.ok(enumeratedKey, "the machine key exists once the machine traits are reported");
  assert.equal(
    machineKeyHash(SECRET, silent.features.raw),
    enumeratedKey,
    "an unanswered capture-device probe must not fork the identity",
  );
  // The trait is not thrown away: it corroborates a match when both sides report it, and its absence
  // is never read as a difference.
  const candidate = {
    featureProfile: learnFeatureProfile(null, enumerated.features.digests),
    featureSnapshot: null,
    browserKeyPublicKey: null,
    fingerprintVisitorIdHash: null,
  };
  assert.ok(matchDeviceFeatures(candidate, enumerated.features, SECRET).matchedMachine.includes("mediaInputs"));
  assert.ok(!matchDeviceFeatures(candidate, silent.features, SECRET).drifted.includes("mediaInputs"));
});

test("a second engine on one computer is a positive match without a memory class or capture devices", () => {
  // The verdict half of the same reported bypass: the record was written by Chrome (memory class and
  // capture devices reported), the observation comes from Firefox, which can report neither. The
  // class gate must accept the one class trait both engines have, and the machine-trait agreement
  // must carry the verdict on its own — the rendering stack cannot help here, because two engines
  // measure it differently by construction.
  const machine = {
    screenColorDepth: 24,
    audioSampleRate: 48000,
    audioChannels: 2,
    hdr: false,
    hardwareConcurrency: 16,
    pixelRatio: 1.25,
  };
  const chrome = profileOf(evidence({ ...machine, deviceMemory: 16, mediaAudioInputs: 1, mediaVideoInputs: 1 }));
  const firefox = observedOf(
    evidence({
      ...machine,
      deviceMemory: undefined,
      mediaAudioInputs: null,
      mediaVideoInputs: null,
      userAgent: FIREFOX_UA,
      webglHash: "webgl-firefox",
      canvasHash: "canvas-firefox",
      audioHash: "audio-firefox",
      fontsHash: "fonts-firefox",
      codecsHash: "codecs-firefox",
      mimeTypesHash: "mime-types-firefox",
    }),
  );
  const match = matchDeviceFeatures(
    { featureProfile: chrome.profile, featureSnapshot: null, browserKeyPublicKey: "key-chrome", fingerprintVisitorIdHash: "visitor-chrome" },
    firefox.features,
    SECRET,
  );
  assert.deepEqual(match.classDrifted, [], "no class trait was contradicted");
  assert.equal(match.classCompared.length, 1, "only the CPU class is comparable across engines");
  assert.equal(match.machineScore, 100, "every machine trait both sides reported agrees");
  assert.ok(match.matchedMachine.length >= 3, `the machine traits agree, got ${match.matchedMachine.join(",")}`);
  assert.equal(match.matchedGraphics, false, "the rendering stack disagreed, so it cannot be what matches");
  assert.equal(decideClusterMatch(match, 78, 55), "same");
});

test("too little hardware evidence yields no machine key rather than a fake identity", () => {
  const thin = observedOf(
    evidence({
      pixelRatio: undefined,
      hardwareConcurrency: undefined,
      deviceMemory: undefined,
      maxTouchPoints: undefined,
      colorGamut: null,
    }),
  );
  assert.ok(Object.keys(thin.features.machine).length < MIN_MACHINE_FEATURES);
  assert.equal(machineKeyHash(SECRET, thin.features.raw), null, "a thin report must not become an identity");
});

test("presentation and rendering features are classified for tamper detection", () => {
  assert.equal(isPresentationFeature("platform"), true);
  assert.equal(isPresentationFeature("osFamily"), true);
  assert.equal(isPresentationFeature("gpu"), false);
  assert.equal(isPresentationFeature("canvas"), false);
  assert.equal(isRenderingFeature("canvas"), true);
  assert.equal(isRenderingFeature("webgl"), true);
  assert.equal(isRenderingFeature("fonts"), false, "fonts are not part of the rendering stack");
  assert.equal(isRenderingFeature("timezone"), false);
});

test("records from before the profile existed still compare through their snapshot", () => {
  const stored = observedOf(evidence({ fontsHash: undefined }));
  const current = observedOf(evidence({ fontsHash: undefined }));
  const match = matchDeviceFeatures(
    { featureProfile: null, featureSnapshot: stored.features.raw, browserKeyPublicKey: null, fingerprintVisitorIdHash: null },
    current.features,
    SECRET,
  );
  assert.equal(match.score, 100);
  assert.equal(decideClusterMatch(match, 78, 55), "same");
});

/**
 * Enrollment-model inputs at their neutral values: an established cluster, no churn or findings, no
 * competing network lease, no unverified key. Neutral so the pre-existing expectations below keep
 * measuring exactly what they measured before the fields existed.
 */
const RISK_NEUTRAL = {
  clusterTrust: "established" as const,
  identityChurn: 0,
  consistencyFindings: 0,
  networkLeaseConflict: false,
  unverifiedBrowserKey: false,
};

test("risk engine denies another account's active lease and never leaks through allow", () => {
  const base = {
    clusterVerdict: "same" as const,
    clusterScore: 95, activeLeaseConflict: true, conflictOwnerIsSelf: false, deviceBlocked: false,
    browserKeyPresent: true, browserKeyRequired: false, fingerprintConfidence: 0.9,
    webdriver: false, headlessHint: false, impossibleUaPlatform: false, missingCapabilities: false,
    missingHighEntropyFields: false, keyChangedForKnownDevice: false,
    uaChangedForKnownMachine: false, renderingTamperForKnownMachine: false,
    ...RISK_NEUTRAL,
    anonymity: { vpn: false, proxy: false, tor: false, hosting: false, anonymous: false },
    history: { accountsOnDevice: 1, devicesOnAccount: 1, recentRejectsOnDevice: 0, recentRejectsOnAccount: 0, ipChurnDuringCycle: 0, geoJump: false },
  };
  const same = evaluateMiningDeviceTrust({ ...base, clusterVerdict: "same" });
  assert.equal(same.decision, "deny");
  assert.equal(same.reasonCode, "device_lease_active");
  const ambiguous = evaluateMiningDeviceTrust({ ...base, clusterVerdict: "ambiguous", clusterScore: 60 });
  assert.equal(ambiguous.decision, "challenge");
  // Self-conflict is not a device denial: the mining service owns the one-cycle rule.
  const self = evaluateMiningDeviceTrust({ ...base, clusterVerdict: "same" as const, conflictOwnerIsSelf: true });
  assert.notEqual(self.reasonCode, "device_lease_active");
});

test("risk engine escalates hostile integrity signals without banning on one weak hint", () => {
  const calm = {
    clusterVerdict: "different" as const, clusterScore: 10, activeLeaseConflict: false, conflictOwnerIsSelf: false,
    deviceBlocked: false, browserKeyPresent: false, browserKeyRequired: false, fingerprintConfidence: 0.9,
    webdriver: false, headlessHint: false, impossibleUaPlatform: false, missingCapabilities: false,
    missingHighEntropyFields: false, keyChangedForKnownDevice: false,
    uaChangedForKnownMachine: false, renderingTamperForKnownMachine: false,
    ...RISK_NEUTRAL,
    anonymity: { vpn: false, proxy: false, tor: false, hosting: false, anonymous: false },
    history: { accountsOnDevice: 1, devicesOnAccount: 1, recentRejectsOnDevice: 0, recentRejectsOnAccount: 0, ipChurnDuringCycle: 0, geoJump: false },
  };
  assert.equal(evaluateMiningDeviceTrust(calm).decision, "allow");
  // An anonymized network alone raises the score but never bans by itself.
  assert.equal(evaluateMiningDeviceTrust({ ...calm, anonymity: { vpn: true, proxy: false, tor: false, hosting: false, anonymous: true } }).decision, "allow");
  assert.equal(evaluateMiningDeviceTrust({ ...calm, anonymity: { vpn: false, proxy: false, tor: true, hosting: true, anonymous: true } }).decision, "allow");
  // But it feeds the score: combined with automation hints it escalates to a challenge.
  assert.equal(
    evaluateMiningDeviceTrust({ ...calm, webdriver: true, headlessHint: true, anonymity: { vpn: false, proxy: false, tor: true, hosting: true, anonymous: true } }).decision,
    "challenge",
  );
  const hostile = evaluateMiningDeviceTrust({ ...calm, webdriver: true, headlessHint: true, impossibleUaPlatform: true, history: { ...calm.history, geoJump: true } });
  assert.equal(hostile.decision, "deny");
  const blocked = evaluateMiningDeviceTrust({ ...calm, deviceBlocked: true });
  assert.equal(blocked.decision, "deny");
  assert.equal(blocked.reasonCode, "device_blocked");
});

test("hiding traits on a known device feeds the score without banning on its own", () => {
  const calm = {
    clusterVerdict: "different" as const, clusterScore: 10, activeLeaseConflict: false, conflictOwnerIsSelf: false,
    deviceBlocked: false, browserKeyPresent: true, browserKeyRequired: false, fingerprintConfidence: 0.9,
    webdriver: false, headlessHint: false, impossibleUaPlatform: false, missingCapabilities: false,
    missingHighEntropyFields: false, keyChangedForKnownDevice: false,
    uaChangedForKnownMachine: false, renderingTamperForKnownMachine: false,
    ...RISK_NEUTRAL,
    anonymity: { vpn: false, proxy: false, tor: false, hosting: false, anonymous: false },
    history: { accountsOnDevice: 1, devicesOnAccount: 1, recentRejectsOnDevice: 0, recentRejectsOnAccount: 0, ipChurnDuringCycle: 0, geoJump: false },
  };
  const evidenceOnly = evaluateMiningDeviceTrust({ ...calm, missingHighEntropyFields: true, keyChangedForKnownDevice: true });
  assert.equal(evidenceOnly.decision, "allow");
  assert.equal(evidenceOnly.riskScore, 20);
  const withAutomation = evaluateMiningDeviceTrust({
    ...calm, missingHighEntropyFields: true, keyChangedForKnownDevice: true, webdriver: true, headlessHint: true,
  });
  assert.equal(withAutomation.decision, "challenge");
});

/**
 * Minimal in-memory stand-in for the quota collection: the production path is one `$inc` upsert on a
 * deterministic `_id`, which is exactly what this models (create-or-increment, atomically), so the
 * budget logic can be tested without a database.
 */
function fakeQuotas() {
  const docs = new Map<string, Record<string, number | string | Date>>();
  return {
    findOneAndUpdate: async (filter: { _id: string }, update: { $inc?: Record<string, number>; $setOnInsert?: Record<string, unknown> }) => {
      const existing = docs.get(filter._id);
      if (!existing) {
        const created = { _id: filter._id, ...(update.$setOnInsert ?? {}), ...(update.$inc ?? {}) } as Record<string, number | string | Date>;
        docs.set(filter._id, created);
        return created;
      }
      for (const [key, delta] of Object.entries(update.$inc ?? {})) {
        existing[key] = (existing[key] as number) + delta;
      }
      return existing;
    },
    findOne: async (filter: { _id: string }) => docs.get(filter._id) ?? null,
  };
}

test("enrollment budget: new machine identities are capped per account and per network", async () => {
  const quotas = fakeQuotas();
  const limits = { maxNewClustersPerAccountPerDay: 3, maxNewClustersPerNetworkPerHour: 2, maxNewClustersPerNetworkPerDay: 10 };
  const now = Date.UTC(2026, 0, 1, 12, 0, 0);
  const charge = (owner: string, ip: string) =>
    consumeEnrollmentBudget({ collections: { miningDeviceQuotas: quotas } as never, limits, ownerUserId: owner, ipHash: ip, nowMs: now });
  // One account: the fourth new identity of the day is refused.
  assert.equal((await charge("acct", "ip-1")).allowed, true);
  assert.equal((await charge("acct", "ip-2")).allowed, true);
  assert.equal((await charge("acct", "ip-3")).allowed, true);
  const overAccount = await charge("acct", "ip-4");
  assert.equal(overAccount.allowed, false);
  assert.equal(overAccount.hit?.scope, "account");
  // Another account behind one network: the network's hourly cap is the binding limit.
  assert.equal((await charge("acct-2", "shared-ip")).allowed, true);
  assert.equal((await charge("acct-3", "shared-ip")).allowed, true);
  const overNetwork = await charge("acct-4", "shared-ip");
  assert.equal(overNetwork.allowed, false);
  assert.equal(overNetwork.hit?.scope, "network");
  // The counters are bucketed, so the next window starts clean.
  const nextHour = await consumeEnrollmentBudget({
    collections: { miningDeviceQuotas: quotas } as never, limits, ownerUserId: "acct-4", ipHash: "shared-ip", nowMs: now + 60 * 60 * 1000,
  });
  assert.equal(nextHour.allowed, true);
});

test("trust transitions: nothing is born established, and findings cannot silently upgrade a device", () => {
  assert.equal(trustStateOf({ status: "active" }), "provisional", "a legacy row earns nothing by default");
  const first = nextTrustState({ device: { trustState: "provisional", status: "active", establishedAt: null }, admissionCount: 1, proofCount: 0, findingCount: 0, minAdmissions: 3 });
  assert.equal(first.state, "provisional");
  assert.equal(first.becameEstablished, false);
  const third = nextTrustState({ device: { trustState: "provisional", status: "active", establishedAt: null }, admissionCount: 3, proofCount: 0, findingCount: 0, minAdmissions: 3 });
  assert.equal(third.state, "established");
  assert.equal(third.becameEstablished, true);
  const withProof = nextTrustState({ device: { trustState: "provisional", status: "active", establishedAt: null }, admissionCount: 2, proofCount: 1, findingCount: 0, minAdmissions: 3 });
  assert.equal(withProof.state, "established", "an independent proof substitutes for the third admission");
  const suspicious = nextTrustState({ device: { trustState: "provisional", status: "active", establishedAt: null }, admissionCount: 3, proofCount: 0, findingCount: 6, minAdmissions: 3 });
  assert.equal(suspicious.state, "suspicious", "contradictions block the upgrade");
  const staysEstablished = nextTrustState({ device: { trustState: "established", status: "active", establishedAt: new Date() }, admissionCount: 9, proofCount: 2, findingCount: 6, minAdmissions: 3 });
  assert.equal(staysEstablished.state, "established", "ordinary drift never demotes an established device");
});

const WINDOWS_CHROME_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

test("consistency engine flags claims that cannot hold together, and only those", () => {
  const coherent = sanitizeEvidence({
    platform: "Win32", userAgent: WINDOWS_CHROME_UA, hardwareConcurrency: 8, deviceMemory: 8, maxTouchPoints: 0,
    screenWidth: 1920, screenHeight: 1080, screenColorDepth: 24, pixelRatio: 1, timezoneOffsetMinutes: -120,
    audioSampleRate: 48000, audioChannels: 2,
  });
  assert.deepEqual(detectEvidenceContradictions(coherent), []);
  const safariOnWindows = sanitizeEvidence({ platform: "Win32", userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15" });
  assert.ok(detectEvidenceContradictions(safariOnWindows).includes("safari_on_non_apple_os"));
  const mismatch = sanitizeEvidence({ platform: "MacIntel", userAgent: WINDOWS_CHROME_UA });
  assert.ok(detectEvidenceContradictions(mismatch).includes("platform_ua_os_mismatch"));
  const absurd = sanitizeEvidence({ hardwareConcurrency: 4096, maxTouchPoints: 999, screenColorDepth: 999, pixelRatio: 99, timezoneOffsetMinutes: -99999, audioSampleRate: 1 });
  assert.ok(detectEvidenceContradictions(absurd).includes("impossible_hardware_values"));
  // Mobile platforms report Linux/iOS kernel strings on purpose and must not be flagged.
  const android = sanitizeEvidence({ platform: "Linux armv8l", userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36" });
  assert.deepEqual(detectEvidenceContradictions(android), []);
});

test("consistency engine sees a key swap packaged with a trait rewrite", () => {
  const quiet = detectSimultaneousTraitReplacement({
    driftedKeys: ["canvas"], presentationKeys: [], renderingKeys: ["canvas"], environmentKeys: [], browserKeyChanged: false,
  });
  assert.deepEqual(quiet, [], "one moved rendering digest is drift");
  const rewrite = detectSimultaneousTraitReplacement({
    driftedKeys: ["platform", "browserFamily", "canvas", "webgl", "timezone"],
    presentationKeys: ["platform", "browserFamily"], renderingKeys: ["canvas", "webgl"], environmentKeys: ["timezone"],
    browserKeyChanged: true,
  });
  assert.ok(rewrite.includes("simultaneous_trait_replacement"));
  assert.ok(rewrite.includes("key_replacement_with_trait_rewrite"));
});

test("a changed user agent on a known machine is scored as tampering, never as a new device", () => {
  const calm = {
    clusterVerdict: "same" as const, clusterScore: 95, activeLeaseConflict: false, conflictOwnerIsSelf: false,
    deviceBlocked: false, browserKeyPresent: true, browserKeyRequired: false, fingerprintConfidence: 0.9,
    webdriver: false, headlessHint: false, impossibleUaPlatform: false, missingCapabilities: false,
    missingHighEntropyFields: false, keyChangedForKnownDevice: false,
    uaChangedForKnownMachine: false, renderingTamperForKnownMachine: false,
    ...RISK_NEUTRAL,
    anonymity: { vpn: false, proxy: false, tor: false, hosting: false, anonymous: false },
    history: { accountsOnDevice: 1, devicesOnAccount: 1, recentRejectsOnDevice: 0, recentRejectsOnAccount: 0, ipChurnDuringCycle: 0, geoJump: false },
  };
  const switched = evaluateMiningDeviceTrust({ ...calm, uaChangedForKnownMachine: true });
  assert.equal(switched.riskScore, 15);
  assert.equal(switched.decision, "allow", "one changed string is evidence, not a verdict");
  const tampered = evaluateMiningDeviceTrust({ ...calm, uaChangedForKnownMachine: true, renderingTamperForKnownMachine: true, missingHighEntropyFields: true });
  assert.equal(tampered.riskScore, 47);
  assert.equal(tampered.decision, "allow", "the machine key, not the score, is what blocks the second cycle");
  const hostile = evaluateMiningDeviceTrust({ ...calm, uaChangedForKnownMachine: true, renderingTamperForKnownMachine: true, webdriver: true });
  assert.equal(hostile.decision, "challenge");
});
