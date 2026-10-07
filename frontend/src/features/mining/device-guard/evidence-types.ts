/**
 * Louma Mining Device Guard — evidence payload shape.
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

// Must match the server's `DEVICE_IN_USE_MESSAGE` byte for byte: the cycle hook uses this constant
// as a sentinel (`error === DEVICE_IN_USE_MESSAGE`), and the start wrapper returns it verbatim for
// `mining_device_already_in_use`.
export const DEVICE_IN_USE_MESSAGE =
  "A mining cycle is already active on this device, or on a machine the guard identifies as the same hardware. One device runs one mining cycle at a time. Try again after the current cycle ends, or use a different device.";

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
