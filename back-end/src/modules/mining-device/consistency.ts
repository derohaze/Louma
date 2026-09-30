import { parseBrowserFamily, parseOsFamily, type DeviceEvidence } from "./signals.js";

/**
 * LMDG evidence consistency engine.
 *
 * Type validation asks "is this field a string of the right shape?". This module asks the harder
 * question: "does this collection of claims make sense together?" Every rule here is *evidence*,
 * never proof: an unusual browser is not a liar, and a determined attacker can produce a fully
 * consistent synthetic identity. What the rules do is make the cheap, sloppy forgery visible, and
 * give the risk engine something to weigh when a client's claims contradict each other.
 */

const PLAUSIBLE_COLOR_DEPTHS = new Set([1, 8, 15, 16, 24, 30, 32]);

/**
 * Environment features: user- and profile-scoped traits (language, timezone, storage, keyboard).
 * They are strong corroboration and drift evidence, and — unlike presentation or rendering — they
 * are legitimately different for two profiles of one person, so they only ever contribute weight.
 */
const ENVIRONMENT_FEATURES = new Set([
  "timezone",
  "timezoneOffset",
  "locale",
  "languagesClass",
  "languageClass",
  "storageBucket",
  "keyboardLayout",
  "plugins",
  "pdfViewer",
]);

export function isEnvironmentFeatureKey(key: string): boolean {
  return ENVIRONMENT_FEATURES.has(key);
}

function platformFamily(platform: string | null): string {
  const pf = (platform ?? "").toLowerCase();
  if (!pf || pf === "unknown") return "unknown";
  if (/win32|win64|windows/.test(pf)) return "windows";
  if (/iphone|ipad|ipod/.test(pf)) return "ios";
  if (/android/.test(pf)) return "android";
  if (/macintel|macppc|mac68k|macintosh/.test(pf) || pf === "mac") return "macos";
  if (/linux|x11|cros/.test(pf)) return "linux";
  return "unknown";
}

const DESKTOP_FAMILIES = new Set(["windows", "macos", "linux", "chromeos"]);

/**
 * Contradictions inside one observation. Returns stable flag names (bounded set, safe to persist as
 * audit metadata) — the risk engine decides what they are worth.
 */
export function detectEvidenceContradictions(evidence: DeviceEvidence): string[] {
  const flags = new Set<string>();
  const ua = evidence.userAgent;
  const platform = evidence.platform;
  const uaFamily = parseOsFamily(ua, platform);
  const pfFamily = platformFamily(platform);

  // A platform declaration that cannot belong to the operating system the user agent claims. Mobile
  // platforms report Linux/iOS kernel strings through `navigator.platform` by design, so only the
  // desktop families are compared.
  if (
    pfFamily !== "unknown" &&
    uaFamily !== "unknown" &&
    pfFamily !== uaFamily &&
    DESKTOP_FAMILIES.has(pfFamily) &&
    DESKTOP_FAMILIES.has(uaFamily)
  ) {
    flags.add("platform_ua_os_mismatch");
  }

  // Safari ships on Apple platforms only.
  if (parseBrowserFamily(ua) === "safari" && uaFamily !== "unknown" && uaFamily !== "macos" && uaFamily !== "ios") {
    flags.add("safari_on_non_apple_os");
  }

  // Values no real environment reports. Generous ceilings: the point is to catch the obviously
  // impossible, never to punish an unusual machine.
  const impossible =
    (typeof evidence.hardwareConcurrency === "number" && (evidence.hardwareConcurrency <= 0 || evidence.hardwareConcurrency > 256)) ||
    (typeof evidence.deviceMemory === "number" && (evidence.deviceMemory <= 0 || evidence.deviceMemory > 256)) ||
    (typeof evidence.maxTouchPoints === "number" && (evidence.maxTouchPoints < 0 || evidence.maxTouchPoints > 64)) ||
    (typeof evidence.screenWidth === "number" && (evidence.screenWidth <= 0 || evidence.screenWidth > 100_000)) ||
    (typeof evidence.screenHeight === "number" && (evidence.screenHeight <= 0 || evidence.screenHeight > 100_000)) ||
    (typeof evidence.pixelRatio === "number" && (evidence.pixelRatio <= 0 || evidence.pixelRatio > 16)) ||
    (typeof evidence.screenColorDepth === "number" && !PLAUSIBLE_COLOR_DEPTHS.has(evidence.screenColorDepth)) ||
    (typeof evidence.timezoneOffsetMinutes === "number" && Math.abs(evidence.timezoneOffsetMinutes) > 16 * 60) ||
    (typeof evidence.audioSampleRate === "number" && (evidence.audioSampleRate < 4000 || evidence.audioSampleRate > 384_000)) ||
    (typeof evidence.audioChannels === "number" && (evidence.audioChannels <= 0 || evidence.audioChannels > 32));
  if (impossible) flags.add("impossible_hardware_values");

  return [...flags];
}

/**
 * The shape of a *change* against a machine the server already knows.
 *
 * One trait moving is drift (a driver update, a new monitor). Many stable traits across several
 * categories moving together, on a request that also presents a different browser key, is the
 * fingerprint-changer shape — not proof, but the strongest single consistency signal the server can
 * compute without hardware attestation.
 */
export function detectSimultaneousTraitReplacement(input: {
  driftedKeys: string[];
  presentationKeys: string[];
  renderingKeys: string[];
  environmentKeys: string[];
  browserKeyChanged: boolean;
}): string[] {
  const flags = new Set<string>();
  const categories = [input.presentationKeys, input.renderingKeys, input.environmentKeys].filter((keys) => keys.length > 0).length;
  if (input.driftedKeys.length >= 4 && categories >= 2) flags.add("simultaneous_trait_replacement");
  if (input.driftedKeys.length >= 3 && input.browserKeyChanged) flags.add("key_replacement_with_trait_rewrite");
  return [...flags];
}
