/**
 * Louma Mining Device Guard service.
 *
 * Server-authoritative admission control for mining starts. Client evidence is sanitized and
 * correlated here; the database (partial unique index on active leases) is the final guarantee
 * under concurrency, never an application-level `findOne` check alone.
 *
 * One capability per module; this barrel keeps the public surface stable:
 * `ip-intel` (network intelligence, cached and degraded), `resolution` (identity
 * correlation), `credit` (committed-admission trust), `proof` (challenge/proof
 * handshake), `admission` (start eligibility), `lease` (cycle leases + status).
 */
export { clearIpIntelCacheForTests, resolveIpIntel, type IpIntel } from "./ip-intel.js";
export { resolveOrCreateDevice, type DeviceResolution } from "./resolution.js";
export { applyCommittedCredit, creditGrantedStart } from "./credit.js";
export {
  buildProofPayload,
  issueChallenge,
  p256KeyFingerprint,
  resolveDeviceBinding,
  verifiedP256Jwk,
  verifyProof,
  type DeviceBinding,
} from "./proof.js";
export { assessMiningStart, type StartEligibility } from "./admission.js";
export { getDeviceStatus, insertLeaseInSession } from "./lease.js";
