import type { ApiSecurityOverview } from "@/lib/api";
import { securityFeatures, securityScoreMax, type SecurityFeatureId } from "@/lib/security-catalog";

/**
 * The Security pages read one API response (`/api/v1/security`). Everything the screens need to
 * render it — score, wording, event labels — is derived here so no page re-implements the rules.
 */

export function securityScore(overview: ApiSecurityOverview | null) {
  const enabled: Record<SecurityFeatureId, boolean> = {
    "two-factor": overview?.twoFactor.enabled ?? false,
    "transfer-password": overview?.transferPassword.enabled ?? false,
  };
  const enabledCount = securityFeatures.filter((feature) => enabled[feature.id]).length;
  return {
    enabled,
    score: securityFeatures.reduce(
      (total, feature) => total + (enabled[feature.id] ? feature.importance : 0),
      0,
    ),
    max: securityScoreMax,
    enabledCount,
    total: securityFeatures.length,
  };
}

export function securityStateText(
  id: SecurityFeatureId,
  overview: ApiSecurityOverview | null,
): string {
  switch (id) {
    case "two-factor": {
      if (!overview?.twoFactor.enabled) return "Authenticator codes are not required";
      return `${overview.twoFactor.recoveryCodesRemaining} recovery codes remaining`;
    }
    case "transfer-password": {
      if (!overview?.transferPassword.enabled) return "No separate transfer password is set";
      const changedAt = overview.transferPassword.changedAt;
      return changedAt
        ? `Last changed ${new Date(changedAt).toLocaleDateString()}`
        : "Transfer password is set";
    }
  }
}

const eventLabels: Record<string, string> = {
  login: "Successful sign-in",
  login_failed: "Failed sign-in attempt",
  logout: "Signed out",
  password_changed: "Password changed",
  two_factor_enabled: "Two-factor authentication enabled",
  two_factor_disabled: "Two-factor authentication disabled",
  two_factor_login_failed: "Failed authenticator check",
  two_factor_login_succeeded: "Signed in with a second factor",
  two_factor_setup_failed: "Authenticator setup failed",
  recovery_codes_regenerated: "Recovery codes regenerated",
  session_revoked: "Session revoked",
  transfer_completed: "Transfer completed",
  transfer_failed: "Transfer failed",
  wallet_frozen: "Wallet frozen",
  wallet_unfrozen: "Wallet unfrozen",
  profile_updated: "Profile updated",
  transfer_password_set: "Transfer password set",
  transfer_password_changed: "Transfer password changed",
  wallet_unfreeze_authorized: "Unfreeze authorized",
  wallet_address_changed: "Receiving address changed",
  refresh_token_reuse_detected: "Suspicious session reuse detected",
};

export function securityEventTitle(eventType: string): string {
  return eventLabels[eventType] ?? "Security activity";
}

/** Outcome of the recorded event, mapped to the tone the alert list renders. */
export function securityEventLevel(outcome: "success" | "failure"): "success" | "warning" {
  return outcome === "success" ? "success" : "warning";
}

export function countryName(code: string | null): string {
  if (!code) return "Not set";
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

export const geoCountries: readonly { code: string; name: string }[] = [
  { code: "EG", name: "Egypt" },
  { code: "AE", name: "United Arab Emirates" },
  { code: "SA", name: "Saudi Arabia" },
  { code: "DE", name: "Germany" },
  { code: "GB", name: "United Kingdom" },
  { code: "US", name: "United States" },
];
