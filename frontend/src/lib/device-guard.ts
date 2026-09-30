import { api, ApiError } from "@/lib/api";

/**
 * Louma Mining Device Guard — mining-page helper only.
 *
 * Collects device evidence (FingerprintJS + normalized browser traits), holds the browser's
 * ECDSA proof-of-possession key (private key non-exportable, IndexedDB-persisted, never sent),
 * and performs the server challenge/prove handshake before `startMining()`.
 *
 * The frontend never decides trust: it only supplies evidence. The server resolves the device
 * cluster, checks the lease, and returns `mining_device_already_in_use` when another account
 * holds this device's active cycle. No fingerprint identifiers, IPs, or risk data are displayed.
 *
 * The collected set spans both sides of the browser/machine line on purpose: the machine traits
 * (CPU and memory class, display scale and colour depth, capture devices, audio device, gamut, font
 * set, codec set) are what the server turns into the machine identity, and the browser traits (the
 * GPU strings, the rendering digests, the window geometry) are what corroborate it and what exposes
 * tampering. Every collector is best-effort and time-boxed — a blocked or slow API must degrade the
 * evidence, never block the customer's start.
 */

export const DEVICE_IN_USE_MESSAGE =
  "Mining is already active on this device. One device can run one mining cycle at a time. Try again after the current mining cycle ends or use a different device.";

export interface DeviceEvidencePayload {
  visitorId: string | null;
  fingerprintConfidence: number | null;
  fingerprintVersion: string | null;
  // Presentation: what the browser says about itself. Cheap to change, so worth little.
  platform: string | null;
  userAgent: string | null;
  platformVersion: string | null;
  architecture: string | null;
  bitness: string | null;
  // Machine traits: properties of the computer and its operating system, the same whichever browser
  // is running. The server turns these into the machine identity that one mining lease is taken on.
  screenWidth: number | null;
  screenHeight: number | null;
  screenAvailWidth: number | null;
  screenAvailHeight: number | null;
  screenColorDepth: number | null;
  pixelRatio: number | null;
  hardwareConcurrency: number | null;
  deviceMemory: number | null;
  maxTouchPoints: number | null;
  // Browser traits: the GPU identity this browser's graphics layer reports. Evidence, not identity.
  webglVendor: string | null;
  webglRenderer: string | null;
  webglLimitsHash: string | null;
  webglExtensionsHash: string | null;
  webgpuHash: string | null;
  // Machine traits, continued: the audio device and the display the system negotiated.
  audioSampleRate: number | null;
  audioChannels: number | null;
  colorGamut: string | null;
  hdr: boolean | null;
  // Browser traits, continued: rendering digests, plus the operating system's font set. Strong
  // corroboration when they agree, tamper evidence when they move, and never machine identity — a
  // privacy browser randomizes the rendering stack and reports its GPU as `brave`, and a second
  // window sits on a different monitor.
  webglHash: string | null;
  canvasHash: string | null;
  audioHash: string | null;
  fontsHash: string | null;
  speechVoicesHash: string | null;
  // Environment.
  timezone: string | null;
  timezoneOffsetMinutes: number | null;
  locale: string | null;
  languages: string | null;
  language: string | null;
  mediaAudioInputs: number | null;
  mediaVideoInputs: number | null;
  storageQuotaBytes: number | null;
  pluginsHash: string | null;
  mimeTypesHash: string | null;
  codecsHash: string | null;
  keyboardLayoutHash: string | null;
  pdfViewerEnabled: boolean | null;
  browserKeyPublicKey: string | null;
  integrity: {
    webdriver: boolean | null;
    headlessHint: boolean | null;
    impossibleUaPlatform: boolean | null;
    missingCapabilities: boolean | null;
  } | null;
}

/** Resolves with the fallback instead of hanging on a collector that stalls. */
function withTimeout<T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => resolve(fallback), timeoutMs);
    promise
      .then((value) => {
        window.clearTimeout(timer);
        resolve(value);
      })
      .catch(() => {
        window.clearTimeout(timer);
        resolve(fallback);
      });
  });
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Everything the graphics stack will say about itself: the driver-reported GPU identity, the limits
 * the driver exposes, and the extensions it supports.
 *
 * The GPU identity and its limits are the most machine-specific values a browser can be asked for,
 * and none of them is derived from the user agent — which is exactly why they anchor the machine
 * key. They are returned raw and hashed in one place, so the payload stays bounded.
 */
interface WebglDetails {
  vendor: string | null;
  renderer: string | null;
  limitsHash: string | null;
  extensionsHash: string | null;
}

const NO_WEBGL: WebglDetails = {
  vendor: null,
  renderer: null,
  limitsHash: null,
  extensionsHash: null,
};

async function webglDetails(): Promise<WebglDetails> {
  try {
    const canvas = document.createElement("canvas");
    const gl = (canvas.getContext("webgl") ??
      canvas.getContext("experimental-webgl")) as WebGLRenderingContext | null;
    if (!gl) return NO_WEBGL;
    const debug = gl.getExtension("WEBGL_debug_renderer_info");
    const parameter = (name: number | undefined): string | null => {
      if (name === undefined) return null;
      try {
        const value = gl.getParameter(name);
        return value === null || value === undefined ? null : String(value).slice(0, 256);
      } catch {
        return null;
      }
    };
    const limitNames: (number | undefined)[] = [
      gl.MAX_TEXTURE_SIZE,
      gl.MAX_RENDERBUFFER_SIZE,
      gl.MAX_VIEWPORT_DIMS,
      gl.ALIASED_LINE_WIDTH_RANGE,
      gl.MAX_VERTEX_ATTRIBS,
      gl.MAX_VARYING_VECTORS,
      gl.MAX_TEXTURE_IMAGE_UNITS,
      gl.MAX_COMBINED_TEXTURE_IMAGE_UNITS,
      gl.MAX_CUBE_MAP_TEXTURE_SIZE,
      gl.MAX_FRAGMENT_UNIFORM_VECTORS,
      gl.MAX_VERTEX_UNIFORM_VECTORS,
      // WebGL2-only: undefined on a WebGL1 context, where it is filtered out of the limit set.
      (gl as WebGLRenderingContext & Partial<WebGL2RenderingContext>).MAX_SAMPLES,
    ];
    const limits = limitNames
      .filter((name): name is number => name !== undefined)
      .map((name) => `${name}:${parameter(name) ?? "?"}`)
      .join("|");
    const extensions = (gl.getSupportedExtensions() ?? []).slice().sort().join(",");
    return {
      vendor: parameter(debug ? debug.UNMASKED_VENDOR_WEBGL : gl.VENDOR),
      renderer: parameter(debug ? debug.UNMASKED_RENDERER_WEBGL : gl.RENDERER),
      limitsHash: limits ? await sha256Hex(limits) : null,
      extensionsHash: extensions ? await sha256Hex(extensions) : null,
    };
  } catch {
    return NO_WEBGL;
  }
}

/**
 * WebGPU adapter identity, when the browser has it. A second, independent view of the GPU: the
 * adapter exposes vendor/architecture/device strings that WebGL does not.
 */
async function webgpuSignature(): Promise<string | null> {
  try {
    const gpu = (
      navigator as Navigator & {
        gpu?: { requestAdapter?: () => Promise<{ info?: Record<string, unknown> } | null> };
      }
    ).gpu;
    if (!gpu?.requestAdapter) return "no-webgpu";
    const adapter = await gpu.requestAdapter();
    if (!adapter) return "no-webgpu";
    const info = adapter.info ?? {};
    const text = ["vendor", "architecture", "device", "description"]
      .map((key) => String(info[key] ?? ""))
      .join("~");
    return text.replace(/~/g, "") ? await sha256Hex(text) : "no-webgpu";
  } catch {
    return "webgpu-error";
  }
}

/**
 * The audio stack's own configuration: the sample rate and channel count the machine negotiated.
 *
 * This is a hardware property of the sound device that no user-agent edit touches, and it is what a
 * virtualized or headless machine most often reports differently.
 */
function audioDeviceInfo(): { sampleRate: number | null; channels: number | null } {
  try {
    const Context =
      window.AudioContext ??
      (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Context) return { sampleRate: null, channels: null };
    const context = new Context();
    const info = {
      sampleRate: typeof context.sampleRate === "number" ? context.sampleRate : null,
      channels:
        typeof context.destination?.channelCount === "number"
          ? context.destination.channelCount
          : null,
    };
    void context.close().catch(() => undefined);
    return info;
  } catch {
    return { sampleRate: null, channels: null };
  }
}

/**
 * Installed speech voices.
 *
 * The synth list is a property of the operating system's speech engine, so it separates machines
 * that agree on everything a browser normally exposes. Chromium fills it asynchronously, so an
 * empty list is waited for (bounded) rather than hashed — an empty hash would be shared by every
 * machine that answered too early.
 */
async function speechVoicesSignature(): Promise<string | null> {
  try {
    const synth = window.speechSynthesis;
    if (!synth) return "no-speech";
    const read = (): string =>
      (synth.getVoices() ?? [])
        .map((voice) => `${voice.name}/${voice.lang}/${voice.localService ? "l" : "r"}`)
        .sort()
        .join("|");
    let voices = read();
    if (!voices) {
      await new Promise<void>((resolve) => {
        const timer = window.setTimeout(() => resolve(), 400);
        synth.addEventListener(
          "voiceschanged",
          () => {
            window.clearTimeout(timer);
            resolve();
          },
          { once: true },
        );
      });
      voices = read();
    }
    return voices ? await sha256Hex(voices) : "no-speech";
  } catch {
    return "no-speech";
  }
}

/**
 * Which media formats this machine can actually decode. Codec support follows the installed platform
 * and its media stack, and — unlike the user agent — cannot be edited by an extension.
 */
async function codecsSignature(): Promise<string | null> {
  try {
    const probe = document.createElement("video");
    const candidates = [
      'video/mp4; codecs="avc1.42E01E"',
      'video/mp4; codecs="avc1.4D401F"',
      'video/mp4; codecs="hvc1.1.6.L93.B0"',
      'video/mp4; codecs="av01.0.05M.08"',
      'video/webm; codecs="vp8"',
      'video/webm; codecs="vp9"',
      'video/webm; codecs="vp09.00.10.08"',
      "audio/mpeg",
      'audio/ogg; codecs="vorbis"',
      'audio/ogg; codecs="opus"',
      'audio/wav; codecs="1"',
      "audio/flac",
      'audio/mp4; codecs="mp4a.40.2"',
    ];
    // "probably" only: "maybe" is what a browser says when it is merely willing to try.
    const supported = candidates.filter((type) => probe.canPlayType(type) === "probably");
    return supported.length > 0 ? await sha256Hex(supported.join("|")) : "no-codecs";
  } catch {
    return "no-codecs";
  }
}

/**
 * The active keyboard layout, read as the characters a fixed set of physical keys produce: an
 * Arabic, AZERTY or QWERTY layout answers differently, and the answer comes from the OS.
 */
async function keyboardLayoutSignature(): Promise<string | null> {
  try {
    const keyboard = (
      navigator as Navigator & { keyboard?: { getLayoutMap?: () => Promise<Map<string, string>> } }
    ).keyboard;
    if (!keyboard?.getLayoutMap) return "no-keyboard";
    const layout = await keyboard.getLayoutMap();
    const keys = [
      "KeyQ",
      "KeyW",
      "KeyY",
      "KeyZ",
      "Semicolon",
      "Quote",
      "Comma",
      "Period",
      "Minus",
      "Equal",
      "BracketLeft",
      "BracketRight",
      "Backslash",
      "Slash",
      "Backquote",
      "IntlBackslash",
    ];
    return await sha256Hex(keys.map((key) => `${key}:${layout.get(key) ?? "?"}`).join("|"));
  } catch {
    return "no-keyboard";
  }
}

/** Plugins and MIME types as this engine exposes them (Chromium reports its fixed PDF entries). */
async function pluginsSignature(): Promise<string | null> {
  try {
    const plugins = Array.from(navigator.plugins ?? [])
      .map((plugin) => plugin.name)
      .sort();
    return plugins.length > 0 ? await sha256Hex(plugins.join("|")) : "no-plugins";
  } catch {
    return "no-plugins";
  }
}

async function mimeTypesSignature(): Promise<string | null> {
  try {
    const types = Array.from(navigator.mimeTypes ?? [])
      .map((type) => type.type)
      .sort();
    return types.length > 0 ? await sha256Hex(types.join("|")) : "no-plugins";
  } catch {
    return "no-plugins";
  }
}

/** The storage quota the origin was granted: a coarse platform- and profile-level trait. */
async function storageQuota(): Promise<number | null> {
  try {
    if (!navigator.storage?.estimate) return null;
    const estimate = await navigator.storage.estimate();
    return typeof estimate.quota === "number" ? estimate.quota : null;
  } catch {
    return null;
  }
}

function hdrSupported(): boolean | null {
  try {
    return window.matchMedia("(dynamic-range: high)").matches;
  } catch {
    return null;
  }
}

function canvasSignature(): string {
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 220;
    canvas.height = 40;
    const ctx = canvas.getContext("2d");
    if (!ctx) return "no-canvas";
    ctx.textBaseline = "top";
    ctx.font = "16px Arial";
    ctx.fillStyle = "#f60";
    ctx.fillRect(0, 0, 220, 40);
    ctx.fillStyle = "#069";
    ctx.fillText("Louma device check 123", 4, 8);
    ctx.strokeStyle = "#000";
    ctx.arc(180, 20, 12, 0, Math.PI * 2);
    ctx.stroke();
    return canvas.toDataURL().slice(0, 4096);
  } catch {
    return "canvas-error";
  }
}

/**
 * Renders a short tone through an OfflineAudioContext and hashes the samples.
 *
 * Audio output is processed by the platform's audio stack, so the same machine reproduces the same
 * tiny numeric differences while a different machine (or a virtualized one) does not. "no-audio"
 * tells the server the collector failed rather than that the device sounds like every other device.
 */
async function audioSignature(): Promise<string | null> {
  try {
    const OfflineContext =
      window.OfflineAudioContext ??
      (window as Window & { webkitOfflineAudioContext?: typeof OfflineAudioContext })
        .webkitOfflineAudioContext;
    if (!OfflineContext) return "no-audio";
    const context = new OfflineContext(1, 4096, 44100);
    const oscillator = context.createOscillator();
    const compressor = context.createDynamicsCompressor();
    oscillator.type = "triangle";
    oscillator.frequency.value = 10000;
    compressor.threshold.value = -50;
    compressor.knee.value = 40;
    compressor.ratio.value = 12;
    compressor.attack.value = 0;
    compressor.release.value = 0.25;
    oscillator.connect(compressor);
    compressor.connect(context.destination);
    oscillator.start(0);
    const buffer = await context.startRendering();
    const channel = buffer.getChannelData(0);
    let signature = "";
    for (let index = 3000; index < channel.length; index += 8) {
      signature += (channel[index] ?? 0).toFixed(7);
    }
    return await sha256Hex(signature);
  } catch {
    return "audio-error";
  }
}

/**
 * Detects installed fonts by measuring text width against three generic families.
 *
 * A machine's font set survives a browser change and a cookie wipe and is expensive to fake
 * consistently, which is what makes it worth one measurement per candidate.
 */
async function fontsSignature(): Promise<string | null> {
  try {
    const candidates = [
      "Arial",
      "Calibri",
      "Cambria",
      "Consolas",
      "Courier New",
      "Georgia",
      "Impact",
      "Segoe UI",
      "Tahoma",
      "Times New Roman",
      "Trebuchet MS",
      "Verdana",
      "Noto Sans",
      "Roboto",
      "Inter",
      "Menlo",
      "Monaco",
      "Helvetica",
      "San Francisco",
    ];
    const bases = ["monospace", "sans-serif", "serif"];
    const sample = "mmmmmmmmmmlli Louma 0123456789";
    const container = document.createElement("div");
    container.style.cssText = "position:absolute;left:-9999px;top:-9999px;visibility:hidden;";
    document.documentElement.appendChild(container);
    const measure = (fontFamily: string): string => {
      const span = document.createElement("span");
      span.style.cssText = `font-family:${fontFamily};font-size:72px;line-height:normal;white-space:nowrap;`;
      span.textContent = sample;
      container.appendChild(span);
      const metric = `${span.offsetWidth}x${span.offsetHeight}`;
      span.remove();
      return metric;
    };
    const baselines = bases.map((base) => measure(base));
    const detected = candidates.filter((font) =>
      bases.some((base, index) => measure(`"${font}",${base}`) !== baselines[index]),
    );
    container.remove();
    return await sha256Hex(detected.join("|"));
  } catch {
    return "fonts-error";
  }
}

function colorGamut(): string | null {
  try {
    if (window.matchMedia("(color-gamut: rec2020)").matches) return "rec2020";
    if (window.matchMedia("(color-gamut: p3)").matches) return "p3";
    if (window.matchMedia("(color-gamut: srgb)").matches) return "srgb";
    return null;
  } catch {
    return null;
  }
}

/** Counts only: without permission `enumerateDevices` returns entries with empty labels. */
async function mediaInputCounts(): Promise<{ audio: number | null; video: number | null }> {
  try {
    if (!navigator.mediaDevices?.enumerateDevices) return { audio: null, video: null };
    const devices = await navigator.mediaDevices.enumerateDevices();
    return {
      audio: devices.filter((device) => device.kind === "audioinput").length,
      video: devices.filter((device) => device.kind === "videoinput").length,
    };
  } catch {
    return { audio: null, video: null };
  }
}

/** Chromium's client hints: the OS build, CPU architecture and pointer size; other engines do not. */
async function clientHints(): Promise<{
  platformVersion: string | null;
  architecture: string | null;
  bitness: string | null;
}> {
  const empty = { platformVersion: null, architecture: null, bitness: null };
  try {
    const hints = (
      navigator as Navigator & {
        userAgentData?: {
          getHighEntropyValues?: (hints: string[]) => Promise<Record<string, unknown>>;
        };
      }
    ).userAgentData;
    if (!hints?.getHighEntropyValues) return empty;
    const values = await hints.getHighEntropyValues(["platformVersion", "architecture", "bitness"]);
    const text = (value: unknown): string | null => (typeof value === "string" ? value : null);
    return {
      platformVersion: text(values["platformVersion"]),
      architecture: text(values["architecture"]),
      bitness: text(values["bitness"]),
    };
  } catch {
    return empty;
  }
}

function detectImpossibleUaPlatform(ua: string, platform: string): boolean {
  const lowerUa = ua.toLowerCase();
  const lowerPf = platform.toLowerCase();
  if (lowerPf.includes("iphone") && /windows|linux/.test(lowerUa)) return true;
  if (lowerPf.includes("win32") && /iphone|android/.test(lowerUa)) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Browser device key (Web Crypto ECDSA P-256, IndexedDB-persisted)
// ---------------------------------------------------------------------------

const IDB_NAME = "louma-lmdg";
const IDB_STORE = "keys";
const KEY_ID = "device-key";

function openIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(IDB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(IDB_STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function idbGet(): Promise<CryptoKeyPair | null> {
  try {
    const db = await openIdb();
    try {
      const value = await new Promise<CryptoKeyPair | undefined>((resolve, reject) => {
        const tx = db.transaction(IDB_STORE, "readonly");
        const req = tx.objectStore(IDB_STORE).get(KEY_ID);
        req.onsuccess = () => resolve(req.result as CryptoKeyPair | undefined);
        req.onerror = () => reject(req.error);
      });
      return value ?? null;
    } finally {
      db.close();
    }
  } catch {
    return null;
  }
}

async function idbPut(pair: CryptoKeyPair): Promise<void> {
  const db = await openIdb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readwrite");
      tx.objectStore(IDB_STORE).put(pair, KEY_ID);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

let memoryKeyPair: CryptoKeyPair | null = null;

async function getOrCreateKeyPair(): Promise<CryptoKeyPair | null> {
  try {
    const stored = await idbGet();
    if (stored) return stored;
    const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, [
      "sign",
      "verify",
    ]);
    // Best effort: private browsing may refuse the write; the in-memory key still proves
    // possession for this tab's handshake.
    await idbPut(pair).catch(() => undefined);
    return pair;
  } catch {
    if (!memoryKeyPair) {
      try {
        memoryKeyPair = await crypto.subtle.generateKey(
          { name: "ECDSA", namedCurve: "P-256" },
          false,
          ["sign", "verify"],
        );
      } catch {
        return null;
      }
    }
    return memoryKeyPair;
  }
}

async function publicKeyMarker(pair: CryptoKeyPair): Promise<string | null> {
  try {
    // The marker binds evidence to the key across handshakes. It is the public JWK (never the
    // private key) and the server stores only this public value.
    return JSON.stringify(await crypto.subtle.exportKey("jwk", pair.publicKey));
  } catch {
    return null;
  }
}

function toBase64Url(bytes: ArrayBuffer): string {
  const bin = String.fromCharCode(...new Uint8Array(bytes));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// ---------------------------------------------------------------------------
// Evidence collection (FingerprintJS v5, normalized subset only)
// ---------------------------------------------------------------------------

interface FingerprintResult {
  visitorId: string;
  confidence: { score: number };
  version?: string;
}

async function fingerprint(): Promise<FingerprintResult | null> {
  try {
    const { default: FingerprintJS } = await import("@fingerprintjs/fingerprintjs");
    const agent = await FingerprintJS.load();
    const result = (await agent.get()) as unknown as FingerprintResult;
    if (!result || typeof result.visitorId !== "string") return null;
    return result;
  } catch {
    return null;
  }
}

function localeInfo(): { locale: string | null; languages: string | null } {
  try {
    const resolved = Intl.DateTimeFormat().resolvedOptions();
    return {
      locale: resolved.locale ?? null,
      languages: Array.isArray(navigator.languages) ? navigator.languages.join(",") : null,
    };
  } catch {
    return { locale: null, languages: null };
  }
}

export async function collectDeviceEvidence(): Promise<DeviceEvidencePayload> {
  const nav = window.navigator as Navigator & {
    deviceMemory?: number;
    webdriver?: boolean;
    pdfViewerEnabled?: boolean;
  };
  const ua = nav.userAgent ?? "";
  const platform =
    (nav as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ??
    nav.platform ??
    "";
  const screen = window.screen;
  const { locale, languages } = localeInfo();
  // Every collector is independent and time-boxed: one blocked or slow API degrades its own signal
  // only, and never blocks the customer's start. The hardware collectors are the ones that matter
  // most — they are what the server turns into the machine identity — so they are all attempted on
  // every start rather than sampled.
  const [
    fp,
    webgl,
    webgpu,
    canvasHash,
    audioHash,
    fontsHash,
    voicesHash,
    codecsHash,
    keyboardHash,
    pluginsHash,
    mimeTypesHash,
    storage,
    media,
    hints,
    pair,
  ] = await Promise.all([
    // FingerprintJS is a dynamic import, so on a cold cache or a blocked CDN path it is the one
    // collector that can stall for seconds. It is corroborating evidence only: the server's identity
    // comes from the machine traits below, so a late library degrades this signal and never the
    // customer's start.
    withTimeout(fingerprint(), 1500, null),
    withTimeout(webglDetails(), 600, NO_WEBGL),
    withTimeout(webgpuSignature(), 600, null),
    withTimeout(sha256Hex(canvasSignature()), 500, null),
    withTimeout(audioSignature(), 800, null),
    withTimeout(fontsSignature(), 800, null),
    withTimeout(speechVoicesSignature(), 600, null),
    withTimeout(codecsSignature(), 400, null),
    withTimeout(keyboardLayoutSignature(), 400, null),
    withTimeout(pluginsSignature(), 300, null),
    withTimeout(mimeTypesSignature(), 300, null),
    withTimeout(storageQuota(), 400, null),
    withTimeout(mediaInputCounts(), 400, { audio: null, video: null }),
    withTimeout(clientHints(), 400, { platformVersion: null, architecture: null, bitness: null }),
    getOrCreateKeyPair(),
  ]);
  let timezone: string | null = null;
  let timezoneOffsetMinutes: number | null = null;
  try {
    timezone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? null;
    timezoneOffsetMinutes = new Date().getTimezoneOffset();
  } catch {
    // A locale-less environment simply reports no timezone evidence.
  }
  const audioDevice = audioDeviceInfo();
  return {
    visitorId: fp?.visitorId ?? null,
    fingerprintConfidence: typeof fp?.confidence?.score === "number" ? fp.confidence.score : null,
    fingerprintVersion: fp?.version ?? "v5",
    platform: platform || null,
    userAgent: ua.slice(0, 512) || null,
    platformVersion: hints.platformVersion,
    architecture: hints.architecture,
    bitness: hints.bitness,
    screenWidth: typeof screen?.width === "number" ? screen.width : null,
    screenHeight: typeof screen?.height === "number" ? screen.height : null,
    screenAvailWidth: typeof screen?.availWidth === "number" ? screen.availWidth : null,
    screenAvailHeight: typeof screen?.availHeight === "number" ? screen.availHeight : null,
    screenColorDepth: typeof screen?.colorDepth === "number" ? screen.colorDepth : null,
    pixelRatio: typeof window.devicePixelRatio === "number" ? window.devicePixelRatio : null,
    hardwareConcurrency:
      typeof nav.hardwareConcurrency === "number" ? nav.hardwareConcurrency : null,
    deviceMemory: typeof nav.deviceMemory === "number" ? nav.deviceMemory : null,
    maxTouchPoints: typeof nav.maxTouchPoints === "number" ? nav.maxTouchPoints : null,
    webglVendor: webgl.vendor,
    webglRenderer: webgl.renderer,
    webglLimitsHash: webgl.limitsHash,
    webglExtensionsHash: webgl.extensionsHash,
    webgpuHash: webgpu,
    audioSampleRate: audioDevice.sampleRate,
    audioChannels: audioDevice.channels,
    colorGamut: colorGamut(),
    hdr: hdrSupported(),
    webglHash: webgl.renderer ? await sha256Hex(`${webgl.vendor ?? ""}~${webgl.renderer}`) : null,
    canvasHash,
    audioHash,
    fontsHash,
    speechVoicesHash: voicesHash,
    timezone,
    timezoneOffsetMinutes,
    locale,
    languages,
    language: nav.language ?? null,
    mediaAudioInputs: media.audio,
    mediaVideoInputs: media.video,
    storageQuotaBytes: storage,
    pluginsHash,
    mimeTypesHash,
    codecsHash,
    keyboardLayoutHash: keyboardHash,
    pdfViewerEnabled: typeof nav.pdfViewerEnabled === "boolean" ? nav.pdfViewerEnabled : null,
    browserKeyPublicKey: pair ? await publicKeyMarker(pair) : null,
    integrity: {
      webdriver: typeof nav.webdriver === "boolean" ? nav.webdriver : null,
      headlessHint: /headless/i.test(ua),
      impossibleUaPlatform: platform ? detectImpossibleUaPlatform(ua, platform) : null,
      missingCapabilities: typeof window.WebGLRenderingContext === "undefined",
    },
  };
}

// ---------------------------------------------------------------------------
// Challenge / prove / start orchestration
// ---------------------------------------------------------------------------

async function provePossession(nonce: string): Promise<boolean> {
  const pair = await getOrCreateKeyPair();
  if (!pair) return false;
  const publicKeyJwk = (await crypto.subtle.exportKey("jwk", pair.publicKey)) as Record<
    string,
    unknown
  >;
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    pair.privateKey,
    new TextEncoder().encode(nonce),
  );
  await api.post("/api/v1/mining/device/prove", {
    nonce,
    signature: toBase64Url(signature),
    publicKeyJwk,
  });
  return true;
}

/**
 * Starts mining with LMDG evidence. On `mining_device_challenge_required` it performs one
 * proof-of-possession round and retries once. Throws ApiError otherwise — callers map
 * `mining_device_already_in_use` to DEVICE_IN_USE_MESSAGE.
 */
export async function startMiningWithGuard(): Promise<unknown> {
  const device = await collectDeviceEvidence().catch(() => null);
  try {
    return await api.post("/api/v1/mining/start", device ? { device } : undefined);
  } catch (error) {
    if (error instanceof ApiError && error.code === "mining_device_challenge_required" && device) {
      const challenge = await api.post<{ nonce: string }>("/api/v1/mining/device/challenge", {});
      await provePossession(challenge.nonce);
      return api.post("/api/v1/mining/start", { device });
    }
    throw error;
  }
}

export const DEVICE_EVIDENCE_MISSING_MESSAGE =
  "We could not verify this device, so mining cannot start. Reload the page — and if it keeps failing, turn off content blockers for this site — then try again.";

export function messageForMiningError(
  error: unknown,
  fallback: (error: unknown) => string,
): string {
  if (error instanceof ApiError && error.code === "mining_device_already_in_use")
    return DEVICE_IN_USE_MESSAGE;
  if (error instanceof ApiError && error.code === "mining_device_evidence_required")
    return DEVICE_EVIDENCE_MISSING_MESSAGE;
  return fallback(error);
}
