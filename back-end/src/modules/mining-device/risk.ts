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
  /**
   * Server-owned trust state of the cluster this start resolves to. A `provisional` cluster is one
   * fabricated request old; `established` has survived repeated admission or a bound proof;
   * `suspicious` has accumulated contradictions. It is never a client value.
   */
  clusterTrust: "provisional" | "established" | "suspicious" | "blocked";
  /** New machine identities enrolled on this network in the last day (churn evidence). */
  identityChurn: number;
  /** Contradictions found inside this observation plus simultaneous-trait-replacement findings. */
  consistencyFindings: number;
  /** Another account holds a live lease on a *different* cluster behind this network. */
  networkLeaseConflict: boolean;
  /**
   * The live-lease similarity backstop compared only the newest `LIVE_LEASE_BACKSTOP_LIMIT` cycles,
   * so an older live lease was not compared against this observation. This is not proof of anything —
   * the identity-keyed checks are complete and unaffected — but on a platform this busy a machine
   * that also changed its keys cannot be ruled out by comparison, so the request carries the weight.
   */
  leaseBackstopTruncated: boolean;
  /** A browser key was presented that this deployment has never verified by proof-of-possession. */
  unverifiedBrowserKey: boolean;
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
  // Identity churn: the account/network has been creating machine identities. Each individual
  // enrollment is allowed (a real new device must work); the rate at which they appear is the abuse
  // signal, and the hard cap lives in the enrollment budget, not here.
  if (input.clusterTrust === "suspicious") risk += 20;
  else if (input.clusterTrust === "provisional") risk += 6;
  if (input.identityChurn >= 8) risk += 15;
  else if (input.identityChurn >= 4) risk += 8;
  if (input.consistencyFindings >= 3) risk += 16;
  else if (input.consistencyFindings === 2) risk += 10;
  else if (input.consistencyFindings === 1) risk += 5;
  if (input.networkLeaseConflict) risk += 15;
  // The truncated similarity backstop is a gap in one heuristic comparison, not evidence about
  // this caller: on a platform with more than 200 live leases it would otherwise add risk to every
  // start. It only matters when this observation could plausibly be an uncompared lease holder
  // whose keys changed — an ambiguous correlation, a swapped key, moved machine traits, hidden
  // high-entropy fields, or an unverified browser key. Without such caller-specific uncertainty the
  // identity-keyed checks already compared everything relevant, so unrelated load adds nothing.
  const backstopRelevant =
    input.clusterVerdict === "ambiguous" ||
    input.missingHighEntropyFields ||
    input.keyChangedForKnownDevice ||
    input.uaChangedForKnownMachine ||
    input.renderingTamperForKnownMachine ||
    input.unverifiedBrowserKey;
  if (input.leaseBackstopTruncated && backstopRelevant) risk += 18;
  if (input.unverifiedBrowserKey) risk += 4;
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
