import type { AppConfig } from "../../config/env.js";
import { forbidden } from "../../shared/errors.js";

export const VERIFIED_DEVICE_REQUIRED = "mining_verified_device_required";
export const VERIFIED_DEVICE_MESSAGE =
  "Mining requires an independently verified device. Verified device enrollment is currently unavailable. Your account and existing rewards remain accessible.";

/**
 * Browser mode has key/account assurance only. Strict mode still has no available attestation
 * authority. Legacy heuristics remain restricted to the config-validated isolated audit runner.
 */
export function requireVerifiedMining(config: Pick<AppConfig, "lmdg">): void {
  if (config.lmdg.identityMode !== "browser" && config.lmdg.identityMode !== "legacy-test") throw forbidden(VERIFIED_DEVICE_REQUIRED, VERIFIED_DEVICE_MESSAGE);
}

export function miningIdentityAvailability(config: Pick<AppConfig, "lmdg">) {
  return {
    policy: config.lmdg.identityMode,
    enrollmentAvailable: config.lmdg.identityMode === "browser",
    browserMiningAllowed: config.lmdg.identityMode !== "strict",
    reason: config.lmdg.identityMode === "browser" ? "browser_key_continuity" : config.lmdg.identityMode === "legacy-test" ? "isolated_test_only" : VERIFIED_DEVICE_REQUIRED,
    message: config.lmdg.identityMode === "browser" ? "Browser mining verifies key possession and account eligibility; it does not attest physical devices." : VERIFIED_DEVICE_MESSAGE,
  };
}
