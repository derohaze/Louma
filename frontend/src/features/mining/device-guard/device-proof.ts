import { api, ApiError } from "@/shared/api";
import {
  audioDeviceInfo,
  audioSignature,
  canvasSignature,
  clientHints,
  codecsSignature,
  colorGamut,
  detectImpossibleUaPlatform,
  fontsSignature,
  hdrSupported,
  keyboardLayoutSignature,
  mediaInputCounts,
  mimeTypesSignature,
  NO_WEBGL,
  pluginsSignature,
  sha256Hex,
  speechVoicesSignature,
  storageQuota,
  webglDetails,
  webgpuSignature,
  withTimeout,
} from "@/features/mining/device-guard/evidence-collectors";
import {
  getOrCreateKeyPair,
  publicKeyMarker,
  toBase64Url,
} from "@/features/mining/device-guard/device-key";
import {
  DEVICE_IN_USE_MESSAGE,
  type DeviceEvidencePayload,
} from "@/features/mining/device-guard/evidence-types";

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
    // Roomier budget than its neighbours on purpose: this is the one machine trait that has to be
    // *asked for* rather than read off a synchronous API. The first `enumerateDevices()` call starts
    // the browser's media stack, which in Firefox takes longer than a few hundred milliseconds — and
    // a collector that times out reports no capture devices at all, which used to be exactly enough
    // to make the same computer look like a second machine.
    withTimeout(mediaInputCounts(), 1500, { audio: null, video: null }),
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

async function provePossession(
  nonce: string,
  payload: string,
  device: DeviceEvidencePayload,
): Promise<boolean> {
  const pair = await getOrCreateKeyPair();
  if (!pair) return false;
  const publicKeyJwk = (await crypto.subtle.exportKey("jwk", pair.publicKey)) as Record<
    string,
    unknown
  >;
  // The signature covers the server's canonical bound payload (protocol version, action, origin,
  // account, device, nonce window) — not a bare nonce. The server recomputes the same bytes from
  // its own records, so a signature minted for another account, origin, or action verifies nowhere.
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    pair.privateKey,
    new TextEncoder().encode(payload),
  );
  // The same evidence is sent back so the server can independently recompute the enrollment binding
  // it committed to at challenge time: the device slot in the signed payload is a server-resolved
  // anchor, not anything the client names.
  await api.post("/api/v1/mining/device/prove", {
    nonce,
    signature: toBase64Url(signature),
    publicKeyJwk,
    device,
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
      const challenge = await api.post<{ nonce: string; payload: string }>(
        "/api/v1/mining/device/challenge",
        { device },
      );
      await provePossession(challenge.nonce, challenge.payload, device);
      return api.post("/api/v1/mining/start", { device });
    }
    throw error;
  }
}

export const DEVICE_EVIDENCE_MISSING_MESSAGE =
  "We could not verify this device, so mining cannot start. Reload the page — and if it keeps failing, turn off content blockers for this site — then try again.";

export const POOL_REQUIRED_MESSAGE =
  "Join a mining pool before starting a cycle. Open Mining Pools and pick Low or Medium.";

export function messageForMiningError(
  error: unknown,
  fallback: (error: unknown) => string,
): string {
  if (error instanceof ApiError && error.code === "mining_pool_required")
    return POOL_REQUIRED_MESSAGE;
  if (error instanceof ApiError && error.code === "mining_device_already_in_use")
    return DEVICE_IN_USE_MESSAGE;
  if (error instanceof ApiError && error.code === "mining_device_evidence_required")
    return DEVICE_EVIDENCE_MISSING_MESSAGE;
  return fallback(error);
}
