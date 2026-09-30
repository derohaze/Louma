import type { ClusterVerdict } from "./identity.js";

/**
 * LMDG deterministic server-side risk evaluation.
 *
 * Pure function: no clock reads, no database access. All inputs are server-observed or
 * server-derived; client values arrive only as sanitized evidence. Thresholds come from
 * `LMDG_*` configuration — never hard-code cutoffs at call sites.
 */

export type RiskDecision = "allow" | "deny" | "challenge";

export interface RiskHistory {
  accountsOnDevice: number;
  devicesOnAccount: number;
  recentRejectsOnDevice: number;
  recentRejectsOnAccount: number;
  ipChurnDuringCycle: number;
  geoJump: boolean;
}

export interface NetworkAnonymity {
  vpn: boolean;
  proxy: boolean;
  tor: boolean;
  hosting: boolean;
  anonymous: boolean;
}

export interface RiskInput {
  clusterVerdict: ClusterVerdict;
  clusterScore: number;
  activeLeaseConflict: boolean;
  conflictOwnerIsSelf: boolean;
  deviceBlocked: boolean;
  browserKeyPresent: boolean;
  browserKeyRequired: boolean;
  fingerprintConfidence: number | null;
  webdriver: boolean;
  headlessHint: boolean;
  impossibleUaPlatform: boolean;
  missingCapabilities: boolean;
  /** A known device stopped reporting an expensive-to-fake trait it used to report. */
  missingHighEntropyFields: boolean;
  /** A known device presented a different proof-of-possession key than the one on record. */
  keyChangedForKnownDevice: boolean;
  /**
   * The hardware is a machine we know, but the browser's own description of it (user agent,
   * platform, client hints) changed. This is the fingerprint of a UA switcher, not of a new device.
   */
  uaChangedForKnownMachine: boolean;
  /** The hardware is a machine we know, but its rendering digests all moved at once. */
  renderingTamperForKnownMachine: boolean;
  /** proxycheck detections; all-false when the provider is disabled or degraded. */
  anonymity: NetworkAnonymity;
  history: RiskHistory;
}

export interface RiskResult {
  decision: RiskDecision;
  reasonCode: string;
  confidence: number;
  riskScore: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function evaluateMiningDeviceTrust(input: RiskInput): RiskResult {
  // Blocked devices are terminal regardless of any other signal.
  if (input.deviceBlocked) {
    return { decision: "deny", reasonCode: "device_blocked", confidence: 1, riskScore: 100 };
  }

  // An operator who requires proof-of-possession means it: without a browser key there is nothing
  // to challenge, and a risk score in the 30s would otherwise allow the start. Deny outright.
  if (input.browserKeyRequired && !input.browserKeyPresent) {
    return { decision: "deny", reasonCode: "browser_key_required", confidence: 0.9, riskScore: 85 };
  }

  let risk = 0;
  if (input.webdriver) risk += 25;
  if (input.headlessHint) risk += 20;
  if (input.impossibleUaPlatform) risk += 25;
  if (input.missingCapabilities) risk += 10;
  if (input.fingerprintConfidence !== null && input.fingerprintConfidence < 0.5) risk += 8;
  // A known device that hides the traits it used to expose, or swaps its key, is the shape of a
  // client that is being impersonated — evidence for the risk score, never a verdict by itself.
  if (input.missingHighEntropyFields) risk += 12;
  if (input.keyChangedForKnownDevice) risk += 8;
  // A machine we have already seen whose software description or rendering digests moved is the
  // observed shape of a fingerprint-changer. Weigh it as evidence, and let the machine key (which
  // does not move) carry the enforcement.
  if (input.uaChangedForKnownMachine) risk += 15;
  if (input.renderingTamperForKnownMachine) risk += 20;
  if (!input.browserKeyPresent) risk += 5;
  if (input.history.accountsOnDevice >= 5) risk += 25;
  else if (input.history.accountsOnDevice >= 3) risk += 12;
  if (input.history.devicesOnAccount >= 10) risk += 10;
  if (input.history.recentRejectsOnDevice >= 3) risk += 15;
  if (input.history.recentRejectsOnAccount >= 5) risk += 10;
  if (input.history.ipChurnDuringCycle >= 5) risk += 12;
  if (input.history.geoJump) risk += 18;
  // Anonymized networks are evidence of evasion, never identity and never an auto-ban alone.
  if (input.anonymity.tor) risk += 20;
  else if (input.anonymity.vpn) risk += 12;
  else if (input.anonymity.proxy) risk += 10;
  if (input.anonymity.hosting) risk += 8;
  if (input.anonymity.anonymous && !input.anonymity.tor && !input.anonymity.vpn && !input.anonymity.proxy) risk += 8;
  if (input.clusterVerdict === "ambiguous") risk += 12;
  if (input.clusterVerdict === "different") risk += 0;
  risk = clamp(Math.round(risk), 0, 100);

  // The core business rule: another account's unexpired lease on this cluster denies the start.
  // Same-account reads are never denied here — the mining service owns the one-cycle-per-account
  // rule separately, and `conflictOwnerIsSelf` converges on the existing cycle.
  if (input.activeLeaseConflict && !input.conflictOwnerIsSelf) {
    if (input.clusterVerdict === "same") {
      return { decision: "deny", reasonCode: "device_lease_active", confidence: clamp(input.clusterScore / 100, 0.7, 1), riskScore: Math.max(risk, 60) };
    }
    // Ambiguous evidence against an active conflicting lease: challenge, never silent allow.
    return { decision: "challenge", reasonCode: "device_cluster_ambiguous", confidence: clamp(input.clusterScore / 100, 0.4, 0.75), riskScore: Math.max(risk, 45) };
  }

  if (risk >= 80) return { decision: "deny", reasonCode: "device_risk_high", confidence: 0.85, riskScore: risk };
  if (risk >= 55) return { decision: "challenge", reasonCode: "device_risk_review", confidence: 0.6, riskScore: risk };
  return { decision: "allow", reasonCode: "device_trusted", confidence: clamp(0.5 + (100 - risk) / 200, 0.5, 1), riskScore: risk };
}
