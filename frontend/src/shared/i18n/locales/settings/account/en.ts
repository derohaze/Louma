export default {
  title: "Account Management",
  description: "Your wallet identity and the account lifecycle.",
  appearance: {
    title: "Appearance",
    description: "Choose how the dashboard looks on this device.",
    darkMode: "Dark mode",
    darkModeDetail: "Switch the dashboard to a darker color scheme.",
  },
  identity: {
    title: "Wallet identity",
    description: "Details tied to this wallet account.",
    email: "Sign-in email",
    accountId: "Account ID",
    address: "Wallet address",
    status: "Wallet status",
    created: "Created",
  },
  delete: {
    title: "Delete wallet account",
    description: "Permanently removes the wallet, its ledger accounts, and its history.",
    button: "Delete account",
    confirmTitle: "Delete this wallet account?",
    confirmBody:
      "The wallet, its address, and every transfer would be removed permanently. This cannot be undone.",
    keep: "Keep my wallet",
    unavailable:
      "Account deletion is not available yet. Nothing was deleted; ask support to close an account with a balance.",
    warning:
      "Withdraw your balance before deleting the account: anything left in the wallet cannot be recovered afterwards.",
  },
};
