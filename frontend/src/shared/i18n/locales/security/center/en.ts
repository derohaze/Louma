export default {
  frozen: {
    banner: "The wallet is frozen, so every transfer is refused until you unfreeze it.",
    unfreeze: "Unfreeze wallet",
  },
  score: {
    title: "Security score",
    summary: "{enabled} of {total} protections are on. {hint}",
    hintPartial: "Enable the remaining controls to close the gaps.",
    hintFull: "Every available control is enabled.",
  },
  devices: {
    title: "Signed-in devices",
    description: "{count} {unit} on this wallet.",
    all: "All devices",
    body: "A device stays signed in until its session expires or you revoke it. Revoking ends the session on that device's next request.",
  },
  protections: {
    title: "Protections",
    description: "Open a control to turn it on or off; the change is applied by the backend.",
    toggle: "Open {title} settings",
  },
  controls: {
    title: "Wallet controls",
    description: "The emergency freeze and the list of signed-in devices.",
  },
  alerts: {
    title: "Security alerts",
    description: "What the wallet recorded on this account, most recent first.",
    refreshFailed: "Security alerts could not be refreshed",
    empty: "No security events have been recorded yet.",
  },
};
