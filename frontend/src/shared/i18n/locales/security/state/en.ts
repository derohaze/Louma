/**
 * Copy derived from the security API response: the one line of state beside each protection, the
 * label of every recorded event, and the counts the Security pages print.
 *
 * These strings are read through `translate()` inside `shared/lib/security`, which is not a
 * component, so they live here rather than in the page that happens to render them.
 */
export default {
  twoFactor: {
    off: "Authenticator codes are not required",
    codesRemainingOne: "{count} recovery code remaining",
    codesRemaining: "{count} recovery codes remaining",
  },
  transferPassword: {
    off: "No separate transfer password is set",
    set: "Transfer password is set",
    lastChanged: "Last changed {date}",
  },
  wallet: {
    frozen: "Frozen",
    active: "Active",
  },
  devices: {
    one: "{count} signed-in device",
    other: "{count} signed-in devices",
  },
  sessions: {
    one: "{count} active session on this wallet.",
    other: "{count} active sessions on this wallet.",
  },
  events: {
    unknown: "Security activity",
    login: "Successful sign-in",
    loginFailed: "Failed sign-in attempt",
    logout: "Signed out",
    passwordChanged: "Password changed",
    twoFactorEnabled: "Two-factor authentication enabled",
    twoFactorDisabled: "Two-factor authentication disabled",
    twoFactorLoginFailed: "Failed authenticator check",
    twoFactorLoginSucceeded: "Signed in with a second factor",
    twoFactorSetupFailed: "Authenticator setup failed",
    recoveryCodesRegenerated: "Recovery codes regenerated",
    sessionRevoked: "Session revoked",
    transferCompleted: "Transfer completed",
    transferFailed: "Transfer failed",
    walletFrozen: "Wallet frozen",
    walletUnfrozen: "Wallet unfrozen",
    profileUpdated: "Profile updated",
    transferPasswordSet: "Transfer password set",
    transferPasswordChanged: "Transfer password changed",
    walletUnfreezeAuthorized: "Unfreeze authorized",
    walletAddressChanged: "Receiving address changed",
    refreshTokenReuseDetected: "Suspicious session reuse detected",
  },
};
