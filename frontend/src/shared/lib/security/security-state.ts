import type { ApiSecurityOverview } from "@/shared/api";
import { currentLocale, translate } from "@/shared/i18n";
import { securityFeatures, securityScoreMax, type SecurityFeatureId } from "./security-catalog";

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
      if (!overview?.twoFactor.enabled) return translate("security.state.twoFactor.off");
      const remaining = overview.twoFactor.recoveryCodesRemaining;
      return translate(
        remaining === 1
          ? "security.state.twoFactor.codesRemainingOne"
          : "security.state.twoFactor.codesRemaining",
        { count: remaining },
      );
    }
    case "transfer-password": {
      if (!overview?.transferPassword.enabled) {
        return translate("security.state.transferPassword.off");
      }
      const changedAt = overview.transferPassword.changedAt;
      return changedAt
        ? translate("security.state.transferPassword.lastChanged", {
            date: new Date(changedAt).toLocaleDateString(currentLocale()),
          })
        : translate("security.state.transferPassword.set");
    }
  }
}

/** Which string each recorded event type reads as; an unknown type falls back to the generic one. */
const eventKeys: Record<string, string> = {
  login: "login",
  login_failed: "loginFailed",
  logout: "logout",
  password_changed: "passwordChanged",
  two_factor_enabled: "twoFactorEnabled",
  two_factor_disabled: "twoFactorDisabled",
  two_factor_login_failed: "twoFactorLoginFailed",
  two_factor_login_succeeded: "twoFactorLoginSucceeded",
  two_factor_setup_failed: "twoFactorSetupFailed",
  recovery_codes_regenerated: "recoveryCodesRegenerated",
  session_revoked: "sessionRevoked",
  transfer_completed: "transferCompleted",
  transfer_failed: "transferFailed",
  wallet_frozen: "walletFrozen",
  wallet_unfrozen: "walletUnfrozen",
  profile_updated: "profileUpdated",
  transfer_password_set: "transferPasswordSet",
  transfer_password_changed: "transferPasswordChanged",
  wallet_unfreeze_authorized: "walletUnfreezeAuthorized",
  wallet_address_changed: "walletAddressChanged",
  refresh_token_reuse_detected: "refreshTokenReuseDetected",
};

export function securityEventTitle(eventType: string): string {
  const key = eventKeys[eventType];
  return key
    ? translate(`security.state.events.${key}`)
    : translate("security.state.events.unknown");
}

/** Outcome of the recorded event, mapped to the tone the alert list renders. */
export function securityEventLevel(outcome: "success" | "failure"): "success" | "warning" {
  return outcome === "success" ? "success" : "warning";
}

/**
 * A country code as the reader's language writes it (the platform's own region names), so the list
 * is not a second dictionary to keep translated.
 */
export function countryName(code: string | null): string {
  if (!code) return translate("common.state.notSet");
  try {
    return new Intl.DisplayNames([currentLocale()], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** The regions offered in the profile form; their names come from `countryName`. */
export const geoCountries: readonly string[] = ["EG", "AE", "SA", "DE", "GB", "US"];
