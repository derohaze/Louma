/**
 * LMDG device signals: normalization of untrusted client evidence.
 *
 * Every value in `DeviceEvidence` is attacker-controlled. Normalization only puts values into
 * stable buckets so the server can correlate — it never makes them trustworthy. Trust comes from
 * combining many signals server-side (see identity.ts), from the shape of their agreement, and
 * from proof-of-possession (service.ts).
 *
 * The signal set is split by *what an attacker would have to change to defeat it*:
 *
 *   - Machine traits — CPU class, display scale, touch class, audio device, display gamut and colour
 *     depth. These are properties of the computer and its operating system, so they are the same
 *     whichever browser is running: they are the machine identity (identity.ts,
 *     `machineKeyHash`) and not just one more vote in a score. The machine-level traits an engine
 *     may decline to *report* — the capture-device counts, the engine-variant memory class, the
 *     installed font and codec sets — are evidence instead of identity, because "this browser does
 *     not answer" is a fact about the browser, not about the machine.
 *   - Browser traits — the GPU strings and limits, canvas/audio/WebGL digests, speech voices, the
 *     screen geometry of the window, locale, storage quota, plugins. They are strong evidence when
 *     they agree and tamper evidence when they move, but they describe the *browser session*: a
 *     privacy browser randomizes the rendering stack on purpose (Brave reports its WebGL renderer
 *     as `brave`), and a second browser on the same computer sits on a different monitor. Reading
 *     any of them as machine identity is what lets one computer hold two mining cycles.
 *   - Presentation strings — user agent, platform, client hints. Cheap to change and worth little;
 *     they identify the *browser*, not the machine.
 */

export interface DeviceIntegrityEvidence {
  webdriver: boolean | null;
  headlessHint: boolean | null;
  impossibleUaPlatform: boolean | null;
  missingCapabilities: boolean | null;
}

export interface DeviceEvidence {
  // --- identity continuity (browser-side, not hardware) ---
  visitorId: string | null;
  fingerprintConfidence: number | null;
  fingerprintVersion: string | null;
  browserKeyPublicKey: string | null;
  // --- presentation strings (cheap to change) ---
  platform: string | null;
  userAgent: string | null;
  platformVersion: string | null;
  architecture: string | null;
  bitness: string | null;
  // --- machine traits: properties of the computer and its operating system ---
  screenWidth: number | null;
  screenHeight: number | null;
  screenAvailWidth: number | null;
  screenAvailHeight: number | null;
  screenColorDepth: number | null;
  pixelRatio: number | null;
  hardwareConcurrency: number | null;
  deviceMemory: number | null;
  maxTouchPoints: number | null;
  // --- browser traits: the GPU identity the browser's own graphics layer reports ---
  webglVendor: string | null;
  webglRenderer: string | null;
  webglLimitsHash: string | null;
  webglExtensionsHash: string | null;
  webgpuHash: string | null;
  // --- machine traits, continued: the audio device and the display the system negotiated ---
  audioSampleRate: number | null;
  audioChannels: number | null;
  colorGamut: string | null;
  hdr: boolean | null;
  // --- browser traits, continued: rendering digests — strong corroboration when they agree, tamper
  //     evidence when they move, and never machine identity, because they are what two browsers on
  //     one computer disagree about. `fontsHash` is the exception: the installed font set belongs to
  //     the operating system, not to the browser ---
  canvasHash: string | null;
  audioHash: string | null;
  fontsHash: string | null;
  webglHash: string | null;
  speechVoicesHash: string | null;
  // --- environment ---
  timezone: string | null;
  timezoneOffsetMinutes: number | null;
  locale: string | null;
  languages: string | null;
  language: string | null;
  mediaAudioInputs: number | null;
  mediaVideoInputs: number | null;
  /** Storage quota the origin was granted. Only the quota is used; usage churns with cache churn. */
  storageQuotaBytes: number | null;
  pluginsHash: string | null;
  mimeTypesHash: string | null;
  codecsHash: string | null;
  keyboardLayoutHash: string | null;
  pdfViewerEnabled: boolean | null;
  integrity: DeviceIntegrityEvidence | null;
}

export interface NormalizedDeviceSignals {
  platform: string;
  osFamily: string;
  browserFamily: string;
  platformVersion: string;
  architecture: string;
  bitness: string;
  screenGeometry: string;
  screenClass: string;
  /** Colour depth of the display, which — unlike the window geometry — does not move with it. */
  screenDepth: string;
  pixelRatioBucket: string;
  hardwareConcurrencyBucket: number;
  deviceMemoryBucket: number | null;
  touchPointsBucket: string;
  gpu: string;
  gpuLimits: string;
  gpuExtensions: string;
  graphics: string;
  audioDevice: string;
  colorGamut: string;
  hdrCapable: string;
  canvasHash: string;
  audioHash: string;
  fontsHash: string;
  webglHash: string;
  speechVoicesHash: string;
  timezone: string;
  timezoneOffsetBucket: string;
  locale: string;
  languagesClass: string;
  languageClass: string;
  mediaInputsBucket: string;
  storageBucket: string;
  plugins: string;
  mimeTypes: string;
  codecs: string;
  keyboardLayout: string;
  pdfViewer: string;
  fingerprintVersion: string;
}

const MAX_FIELD = 128;

/**
 * Values a client produces when a collector *failed*, rather than a real observation. Two machines
 * with blocked WebGL would otherwise "share" the literal `no-webgl` and match on it, so failure
 * markers are normalized to `unknown` and drop out of correlation entirely.
 */
const FAILURE_MARKERS = new Set([
  "no-webgl",
  "webgl-error",
  "no-canvas",
  "canvas-error",
  "no-audio",
  "audio-error",
  "no-fonts",
  "fonts-error",
  "no-gpu",
  "no-webgpu",
  "webgpu-error",
  "no-speech",
  "no-keyboard",
  "no-codecs",
  "no-plugins",
  "no-storage",
  "no-media",
]);

function clean(value: string | null | undefined): string {
  if (typeof value !== "string") return "unknown";
  const trimmed = value.trim().slice(0, MAX_FIELD);
  return trimmed ? trimmed.toLowerCase() : "unknown";
}

function cleanDigest(value: string | null | undefined): string {
  const cleaned = clean(value);
  return FAILURE_MARKERS.has(cleaned) ? "unknown" : cleaned;
}

function cleanKeepCase(value: string | null | undefined): string {
  if (typeof value !== "string") return "unknown";
  const trimmed = value.trim().slice(0, MAX_FIELD);
  return trimmed ? trimmed : "unknown";
}

/** Buckets a core count so small differences (SMT on/off) do not fork the identity. */
export function bucketHardwareConcurrency(value: number | null): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return 0;
  if (value <= 2) return 2;
  if (value <= 4) return 4;
  if (value <= 8) return 8;
  if (value <= 16) return 16;
  return 32;
}

export function bucketDeviceMemory(value: number | null): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  if (value <= 2) return 2;
  if (value <= 4) return 4;
  if (value <= 8) return 8;
  return 16;
}

export function bucketScreenClass(width: number | null, height: number | null): string {
  if (typeof width !== "number" || typeof height !== "number" || width <= 0 || height <= 0) return "unknown";
  const area = width * height;
  if (area < 800_000) return "small";
  if (area < 2_100_000) return "medium";
  if (area < 4_200_000) return "large";
  return "xlarge";
}

/**
 * Exact screen geometry, not a size class.
 *
 * Kept exact because it separates two displays well — but it is *evidence*, not identity: the
 * geometry reported is the one of the display the window currently sits on, so one computer with a
 * second monitor, or two browsers sized differently, legitimately disagree about it. The machine
 * identity therefore uses `screenDepth` (a property of the panel) instead.
 */
export function screenGeometryOf(evidence: DeviceEvidence): string {
  const part = (value: number | null, scale = 1): string =>
    typeof value === "number" && Number.isFinite(value) && value > 0 ? String(Math.round(value * scale)) : "?";
  const geometry = [
    part(evidence.screenWidth),
    part(evidence.screenHeight),
    part(evidence.screenAvailWidth),
    part(evidence.screenAvailHeight),
    part(evidence.screenColorDepth),
  ].join("x");
  return geometry === "?x?x?x?x?" ? "unknown" : geometry;
}

/**
 * Colour depth of the display in bits.
 *
 * Part of the machine identity where the window geometry is not: it is a property of the panel, so
 * it does not move when the window is resized, moved to a second monitor or zoomed.
 */
export function bucketScreenDepth(value: number | null): string {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > 64) return "unknown";
  return `depth-${Math.round(value)}`;
}

export function bucketLanguageClass(language: string | null): string {
  if (typeof language !== "string" || !language.trim()) return "unknown";
  const primary = language.trim().split(/[-_]/)[0]?.toLowerCase() ?? "";
  return /^[a-z]{2,3}$/.test(primary) ? primary : "unknown";
}

/** The language preference *list*, normalized to its ordered primary subtags. */
export function languagesClassOf(languages: string | null, fallback: string | null): string {
  const raw = typeof languages === "string" && languages.trim() ? languages : (fallback ?? "");
  if (!raw.trim()) return "unknown";
  const parts = raw
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 8);
  return parts.length > 0 ? parts.join(">") : "unknown";
}

/**
 * Device pixel ratio to a quarter step: 1, 1.25, 1.5, 2 and 3 are hardware choices, while the
 * fractional noise between them (1.1000000000000001) is not.
 */
export function bucketPixelRatio(value: number | null): string {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > 16) return "unknown";
  return `dpr-${Math.round(value * 4) / 4}`;
}

/** Timezone offset in 30-minute steps (a few regions use :30/:45, every zone uses whole minutes). */
export function bucketTimezoneOffset(minutes: number | null): string {
  if (typeof minutes !== "number" || !Number.isFinite(minutes) || Math.abs(minutes) > 16 * 60) return "unknown";
  // `getTimezoneOffset()` returns UTC minus local time, so the label's sign is its opposite.
  const hours = -(Math.round(minutes / 30) * 30) / 60;
  return `utc${hours >= 0 ? "+" : ""}${hours}`;
}

export function bucketTouchPoints(value: number | null): string {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return "unknown";
  if (value === 0) return "touch-0";
  if (value <= 5) return "touch-1-5";
  return "touch-6+";
}

/**
 * Connected capture devices. Only the *counts* are used: `enumerateDevices` labels are empty
 * without permission, so the count is the stable part — and it is the part that differs between a
 * laptop, a desktop with a webcam and a machine that has neither.
 *
 * Evidence, never identity: whether an engine answers at all is its own policy and timing —
 * Firefox's first call reports nothing until its media stack has started, and a hardened profile
 * reports less than a plain one — so a machine cannot be identified by a count one of its browsers
 * never sends. It corroborates a match when both sides do report it (see `matchDeviceFeatures`),
 * and it is deliberately absent from CORE_MACHINE_FEATURES.
 */
export function bucketMediaInputs(audioInputs: number | null, videoInputs: number | null): string {
  const bucket = (value: number | null): string => {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return "?";
    if (value === 0) return "0";
    if (value === 1) return "1";
    if (value === 2) return "2";
    return "3+";
  };
  const audio = bucket(audioInputs);
  const video = bucket(videoInputs);
  return audio === "?" && video === "?" ? "unknown" : `${audio}x${video}`;
}

/** A closed set, so an odd or hostile value cannot become part of the identity vector. */
export function bucketColorGamut(value: string | null): string {
  const cleaned = clean(value);
  return ["srgb", "p3", "rec2020"].includes(cleaned) ? `gamut-${cleaned}` : "unknown";
}

/** Major.minor only: the patch number of a browser release changes monthly and is not a device trait. */
export function bucketPlatformVersion(value: string | null): string {
  if (typeof value !== "string") return "unknown";
  const match = /^(\d{1,3})(?:\.(\d{1,3}))?/.exec(value.trim());
  if (!match?.[1]) return "unknown";
  return `pv-${match[1]}${match[2] ? `.${match[2]}` : ""}`;
}

/** Storage quota/usage as coarse powers of two: the absolute bytes drift with cache churn. */
export function bucketStorage(bytes: number | null): string {
  if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes <= 0) return "unknown";
  const exponent = Math.floor(Math.log2(bytes));
  return `2^${Math.min(exponent, 60)}`;
}

/**
 * The GPU identity: vendor plus renderer, exactly as the driver reports them.
 *
 * Strong evidence, but not identity: the strings go through the browser's WebGL layer, and a
 * privacy browser replaces them (Brave answers `brave~brave` for both), so two browsers on one
 * computer can disagree about the GPU they are both running on.
 */
export function gpuOf(evidence: DeviceEvidence): string {
  const vendor = clean(evidence.webglVendor);
  const renderer = clean(evidence.webglRenderer);
  if (vendor === "unknown" && renderer === "unknown") return "unknown";
  return `${vendor}~${renderer}`.slice(0, 256);
}

export function parseOsFamily(userAgent: string | null, platform: string | null): string {
  const ua = (userAgent ?? "").toLowerCase();
  const pf = (platform ?? "").toLowerCase();
  if (/windows/.test(ua) || /win32|win64|windows/.test(pf)) return "windows";
  if (/android/.test(ua)) return "android";
  if (/iphone|ipad|ios/.test(ua) || /iphone|ipad/.test(pf)) return "ios";
  if (/mac os|macintosh/.test(ua) || /mac/.test(pf)) return "macos";
  if (/linux/.test(ua) || /linux/.test(pf)) return "linux";
  if (/cros/.test(ua)) return "chromeos";
  return "unknown";
}

export function parseBrowserFamily(userAgent: string | null): string {
  const ua = (userAgent ?? "").toLowerCase();
  if (/edg\//.test(ua)) return "edge";
  if (/opr\/|opera/.test(ua)) return "opera";
  if (/firefox|fxios/.test(ua)) return "firefox";
  if (/crios|chrome/.test(ua)) return "chrome";
  if (/safari/.test(ua)) return "safari";
  return "unknown";
}

/** Detects UA/platform pairs no genuine browser produces (spoofing evidence, not proof). */
export function detectImpossibleUaPlatform(userAgent: string | null, platform: string | null): boolean {
  const ua = (userAgent ?? "").toLowerCase();
  const pf = (platform ?? "").toLowerCase();
  if (!ua || !pf || pf === "unknown") return false;
  if (pf.includes("iphone") && /windows|linux/.test(ua)) return true;
  if (pf.includes("win32") && /iphone|android/.test(ua)) return true;
  if (/macintosh/.test(ua) && pf.includes("linux")) return true;
  return false;
}

/**
 * The client's own claim that it is running under automation. `navigator.webdriver` is the one the
 * browser sets itself; the rest are heuristics and are only ever evidence.
 */
export function detectAnnouncedAutomation(evidence: DeviceEvidence): boolean {
  return evidence.integrity?.webdriver === true;
}

function clampConfidence(value: number | null): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.min(1, Math.max(0, value));
}

export function sanitizeEvidence(input: unknown): DeviceEvidence {
  const raw = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;
  const str = (v: unknown): string | null => (typeof v === "string" && v.length <= 512 ? v : null);
  const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const bool = (v: unknown): boolean | null => (typeof v === "boolean" ? v : null);
  const integrityRaw = raw["integrity"];
  const integrity =
    typeof integrityRaw === "object" && integrityRaw !== null
      ? {
          webdriver: bool((integrityRaw as Record<string, unknown>)["webdriver"]),
          headlessHint: bool((integrityRaw as Record<string, unknown>)["headlessHint"]),
          impossibleUaPlatform: bool((integrityRaw as Record<string, unknown>)["impossibleUaPlatform"]),
          missingCapabilities: bool((integrityRaw as Record<string, unknown>)["missingCapabilities"]),
        }
      : null;
  return {
    visitorId: str(raw["visitorId"]),
    fingerprintConfidence: clampConfidence(num(raw["fingerprintConfidence"])),
    fingerprintVersion: str(raw["fingerprintVersion"]),
    platform: str(raw["platform"]),
    userAgent: typeof raw["userAgent"] === "string" ? (raw["userAgent"] as string).slice(0, 512) : null,
    platformVersion: str(raw["platformVersion"]),
    architecture: str(raw["architecture"]),
    bitness: str(raw["bitness"]),
    screenWidth: num(raw["screenWidth"]),
    screenHeight: num(raw["screenHeight"]),
    screenAvailWidth: num(raw["screenAvailWidth"]),
    screenAvailHeight: num(raw["screenAvailHeight"]),
    screenColorDepth: num(raw["screenColorDepth"]),
    pixelRatio: num(raw["pixelRatio"]),
    hardwareConcurrency: num(raw["hardwareConcurrency"]),
    deviceMemory: num(raw["deviceMemory"]),
    maxTouchPoints: num(raw["maxTouchPoints"]),
    webglVendor: str(raw["webglVendor"]),
    webglRenderer: str(raw["webglRenderer"]),
    webglLimitsHash: str(raw["webglLimitsHash"]),
    webglExtensionsHash: str(raw["webglExtensionsHash"]),
    webgpuHash: str(raw["webgpuHash"]),
    audioSampleRate: num(raw["audioSampleRate"]),
    audioChannels: num(raw["audioChannels"]),
    colorGamut: str(raw["colorGamut"]),
    hdr: bool(raw["hdr"]),
    canvasHash: str(raw["canvasHash"]),
    audioHash: str(raw["audioHash"]),
    fontsHash: str(raw["fontsHash"]),
    webglHash: str(raw["webglHash"]),
    speechVoicesHash: str(raw["speechVoicesHash"]),
    timezone: str(raw["timezone"]),
    timezoneOffsetMinutes: num(raw["timezoneOffsetMinutes"]),
    locale: str(raw["locale"]),
    languages: str(raw["languages"]),
    language: str(raw["language"]),
    mediaAudioInputs: num(raw["mediaAudioInputs"]),
    mediaVideoInputs: num(raw["mediaVideoInputs"]),
    storageQuotaBytes: num(raw["storageQuotaBytes"]),
    pluginsHash: str(raw["pluginsHash"]),
    mimeTypesHash: str(raw["mimeTypesHash"]),
    codecsHash: str(raw["codecsHash"]),
    keyboardLayoutHash: str(raw["keyboardLayoutHash"]),
    pdfViewerEnabled: bool(raw["pdfViewerEnabled"]),
    browserKeyPublicKey: typeof raw["browserKeyPublicKey"] === "string" ? (raw["browserKeyPublicKey"] as string).slice(0, 2048) : null,
    integrity,
  };
}

export function normalizeSignals(evidence: DeviceEvidence): NormalizedDeviceSignals {
  return {
    platform: clean(evidence.platform),
    osFamily: parseOsFamily(evidence.userAgent, evidence.platform),
    browserFamily: parseBrowserFamily(evidence.userAgent),
    platformVersion: bucketPlatformVersion(evidence.platformVersion),
    architecture: clean(evidence.architecture),
    bitness: clean(evidence.bitness),
    screenGeometry: screenGeometryOf(evidence),
    screenClass: bucketScreenClass(evidence.screenWidth, evidence.screenHeight),
    screenDepth: bucketScreenDepth(evidence.screenColorDepth),
    pixelRatioBucket: bucketPixelRatio(evidence.pixelRatio),
    hardwareConcurrencyBucket: bucketHardwareConcurrency(evidence.hardwareConcurrency),
    deviceMemoryBucket: bucketDeviceMemory(evidence.deviceMemory),
    touchPointsBucket: bucketTouchPoints(evidence.maxTouchPoints),
    gpu: gpuOf(evidence),
    gpuLimits: cleanDigest(evidence.webglLimitsHash),
    gpuExtensions: cleanDigest(evidence.webglExtensionsHash),
    graphics: cleanDigest(evidence.webgpuHash),
    audioDevice:
      typeof evidence.audioSampleRate === "number" && Number.isFinite(evidence.audioSampleRate) && evidence.audioSampleRate > 0
        ? `sr-${Math.round(evidence.audioSampleRate)}ch-${typeof evidence.audioChannels === "number" ? evidence.audioChannels : "?"}`
        : "unknown",
    colorGamut: bucketColorGamut(evidence.colorGamut),
    hdrCapable: typeof evidence.hdr === "boolean" ? `hdr-${evidence.hdr}` : "unknown",
    canvasHash: cleanDigest(evidence.canvasHash),
    audioHash: cleanDigest(evidence.audioHash),
    fontsHash: cleanDigest(evidence.fontsHash),
    webglHash: cleanDigest(evidence.webglHash),
    speechVoicesHash: cleanDigest(evidence.speechVoicesHash),
    timezone: cleanKeepCase(evidence.timezone).slice(0, 64),
    timezoneOffsetBucket: bucketTimezoneOffset(evidence.timezoneOffsetMinutes),
    locale: cleanKeepCase(evidence.locale).slice(0, 32).toLowerCase(),
    languagesClass: languagesClassOf(evidence.languages, evidence.language).toLowerCase(),
    languageClass: bucketLanguageClass(evidence.language),
    mediaInputsBucket: bucketMediaInputs(evidence.mediaAudioInputs, evidence.mediaVideoInputs),
    storageBucket: bucketStorage(evidence.storageQuotaBytes),
    plugins: cleanDigest(evidence.pluginsHash),
    mimeTypes: cleanDigest(evidence.mimeTypesHash),
    codecs: cleanDigest(evidence.codecsHash),
    keyboardLayout: cleanDigest(evidence.keyboardLayoutHash),
    pdfViewer: typeof evidence.pdfViewerEnabled === "boolean" ? `pdf-${evidence.pdfViewerEnabled}` : "unknown",
    fingerprintVersion: cleanKeepCase(evidence.fingerprintVersion),
  };
}

/** Normalizes an observed IP into a family label (supporting evidence only, never identity). */
export function ipFamilyOf(ip: string | null): string {
  if (!ip) return "unknown";
  if (ip.includes(":")) return "ipv6";
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip.trim())) return "ipv4";
  return "unknown";
}
