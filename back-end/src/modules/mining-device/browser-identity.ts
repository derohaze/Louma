import { badRequest } from "../../shared/errors.js";
import { buildFeatureMap, canonicalBrowserKey, digestFeatureMap, hmacHex } from "./identity.js";
import { normalizeSignals, sanitizeEvidence } from "./signals.js";

/** These identify key possession and request intent, never physical hardware. */
export function browserIdentity(secret: Buffer, raw: unknown) {
  const evidence = sanitizeEvidence(raw);
  const canonicalKey = canonicalBrowserKey(evidence.browserKeyPublicKey);
  if (!canonicalKey) throw badRequest("mining_device_evidence_missing", "A supported browser key is required.");
  const keyHash = hmacHex(secret, "lmdg-browser-key-v1", canonicalKey);
  const signals = normalizeSignals(evidence);
  const features = digestFeatureMap(secret, buildFeatureMap(signals));
  const normalized = { ...evidence, browserKeyPublicKey: canonicalKey };
  const intentHash = hmacHex(secret, "lmdg-browser-intent-v1", JSON.stringify(normalized, (_key, value: unknown) =>
    value && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))) : value));
  return { keyHash, intentHash, canonicalKey, evidence, features, signals, publicId: `browser:${keyHash}` };
}

export type BrowserIdentity = ReturnType<typeof browserIdentity>;
