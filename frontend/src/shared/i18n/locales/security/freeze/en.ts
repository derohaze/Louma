export default {
  title: {
    frozen: "The wallet is frozen",
    active: "The wallet is active",
  },
  description: {
    frozen: "Every transfer is refused until you unfreeze it.",
    active: "Freezing takes effect on the next transfer, without a delay.",
  },
  note: {
    frozen:
      "The wallet is frozen. The transfer form refuses every amount, and the wallet is locked on other pages too.",
    active:
      "No freeze is active. Use it when a device is lost or you suspect someone else has your credentials.",
  },
  unfreeze: {
    button: "Unfreeze wallet",
    busy: "Unfreezing…",
    confirmTitle: "Unfreeze this wallet?",
    confirmBody:
      "Confirm with your account password{andCode}. Transfers work again as soon as the wallet is active.",
    andCode: " and a current authenticator code",
    keep: "Keep it frozen",
    password: "Account password",
    code: "Authenticator or recovery code",
  },
  freeze: {
    button: "Freeze wallet",
    confirmTitle: "Freeze this wallet?",
    confirmBody:
      "Every transfer and every new sign-in stops immediately. LMA that is already on its way still arrives, and you can unfreeze from this page at any time.",
  },
  impact: {
    title: "What freezing does",
    description:
      "Freezing stops the wallet, not your access to it: Security stays open so you can undo it.",
    transfersOut: "Transfers out",
    transfersOutDetail: "Refused by the backend before they are submitted",
    signIn: "Sign-in on a new device",
    signInDetail: "Blocked",
    incoming: "LMA sent to you",
    incomingDetail: "Still arrives and shows in Transactions",
    unfreezing: "Unfreezing",
    unfreezingDetail: "Any time from this page, or from Security Center",
  },
  messages: {
    frozen: "Wallet frozen. Nothing leaves it until you unfreeze.",
    unfrozen: "Wallet unfrozen. Transfers work again.",
  },
};
