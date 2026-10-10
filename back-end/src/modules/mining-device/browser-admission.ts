import type { AppConfig } from "../../config/env.js";
import type { Collections } from "../../infrastructure/mongodb/collections.js";
import { BROWSER_RISK_FEATURES, browserProofFilter, readBrowserAdmissionEvidence } from "../../infrastructure/mongodb/browser-mining.js";
import { AppError, conflict, forbidden, serviceUnavailable } from "../../shared/errors.js";
import { findLiveLeases } from "./repository.js";
import { browserIdentity } from "./browser-identity.js";
import { consumeEnrollmentBudget } from "./enrollment.js";
import { proveMiningAccount } from "../security/service.js";
import { recordSecurityEvent } from "../security/audit.js";

export interface MiningAccountVerification { password: string; twoFactorCode?: string | undefined }

export async function prepareBrowserAdmission(input: {
  collections: Collections; config: Pick<AppConfig, "lmdg" | "encryptionKey">; ownerUserId: string;
  correlationId: string;
  evidenceRaw: unknown; nonce?: string | undefined; origin: string | null; verification?: MiningAccountVerification | undefined;
}) {
  const identity = browserIdentity(input.config.encryptionKey, input.evidenceRaw);
  const proof = input.nonce ? await input.collections.miningDeviceNonces.findOne(
    browserProofFilter(identity, input.ownerUserId, input.nonce, input.origin, new Date())) : null;
  if (!proof) throw forbidden("mining_device_challenge_required", "Confirm this browser before starting.");
  const history = await readBrowserAdmissionEvidence(input.collections, identity, input.config.encryptionKey, input.ownerUserId).catch(error => {
    if (error instanceof AppError) throw error;
    throw serviceUnavailable("mining_start_busy", "Browser verification is busy. Try again.");
  });
  if (history.device?.status && history.device.status !== "active" || history.legacy.some(device => device.status !== "active")) {
    throw forbidden("mining_device_unavailable", "This browser enrollment is unavailable.");
  }
  const leaseKeys = [identity.keyHash, identity.publicId, ...history.legacy.map(device => device.publicId)];
  if ((await findLiveLeases(input.collections, leaseKeys, Date.now())).some(lease => lease.ownerUserId !== input.ownerUserId)) {
    throw conflict("mining_device_already_in_use", "This browser identity is already mining on another account.");
  }
  const reasons: string[] = [];
  if (history.overflow) reasons.push("history_uncertain");
  if (history.previous?.deviceId && history.previous.deviceId !== identity.publicId) reasons.push("account_key_change");
  const integrity = identity.evidence.integrity;
  if (integrity?.webdriver || integrity?.headlessHint || integrity?.impossibleUaPlatform) reasons.push("reported_automation_or_contradiction");
  const present = BROWSER_RISK_FEATURES.filter(key => identity.features[key]);
  if (present.length < 2) reasons.push("sparse_evidence");
  if (history.peers.some(peer => present.filter(key => peer.admissionEvidenceTokens?.includes(`${key}:${identity.features[key]}`)).length >= 3)) reasons.push("correlated_history");
  if (history.device && present.filter(key => history.device!.featureSnapshot?.[key] && history.device!.featureSnapshot[key] !== identity.features[key]).length >= 3) reasons.push("coordinated_drift");
  let accountProof: Awaited<ReturnType<typeof proveMiningAccount>> | null = null;
  if (reasons.length) {
    await recordSecurityEvent({ collections: input.collections, ownerUserId: input.ownerUserId, sessionId: null,
      eventType: "mining_device_suspicious", outcome: "failure", correlationId: input.correlationId,
      metadata: { policy: "browser-v1", reason: reasons.join(","), response: "account_verification_required" } }).catch(() => undefined);
    if (!input.verification) throw forbidden("mining_account_verification_required", "Confirm your account password and, if enabled, your authenticator code before starting.");
    accountProof = await proveMiningAccount({ ...input, ...input.verification });
  }
  if (!history.device) {
    // Account-only enrollment attempt budget. Sharing a NAT never spends another user's budget.
    const budget = await consumeEnrollmentBudget({ collections: input.collections, limits: input.config.lmdg,
      ownerUserId: input.ownerUserId, ipHash: null, identityKey: identity.keyHash, nowMs: Date.now() });
    if (!budget.allowed) throw forbidden("mining_device_enrollment_limited", "Too many browser enrollments. Try again later.");
  }
  return { identity, nonce: input.nonce!, origin: input.origin, proof, reasons, accountProof,
    previousId: history.previous?.publicId ?? null, deviceUpdatedAt: history.device?.updatedAt ?? null,
    leaseKeys };
}
