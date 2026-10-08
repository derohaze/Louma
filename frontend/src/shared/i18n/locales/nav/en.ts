/**
 * The names of the sections and pages. The navigation, the search dialog, and the page headers all
 * read these, so a page is named in exactly one place.
 *
 * `search` is what the search dialog matches on top of the visible label: the page's full name plus
 * the words an owner would type to find it. It is translated too — the match is made against what
 * the reader sees and types in their own language.
 */
export default {
  sections: {
    home: "Home",
    wallet: "Wallet",
    transfer: "Transfer",
    mining: "Mining",
    transactions: "Transactions",
    billing: "Billing",
    profile: "Profile",
    security: "Security",
    settings: "Settings",
  },
  pages: {
    overview: {
      label: "Overview",
      search: "balance dashboard home overview",
    },
    analytics: {
      label: "Analytics",
      search: "analytics charts insights income expenses mining transfers activity",
    },
    notifications: {
      label: "Notifications",
      search: "notifications notices alerts security transfers unread",
    },
    wallet: {
      label: "Wallet",
      search: "balance receiving address",
    },
    customAddress: {
      label: "Custom Address",
      search: "receiving address qr code",
    },
    transfer: {
      label: "Transfer",
      search: "send transfer receive funds",
    },
    recipients: {
      label: "Recipients",
      search: "saved recent recipients favorites addresses",
    },
    mining: {
      label: "Mining",
      search: "mining rewards rate cycle earn lma",
    },
    miningPools: {
      label: "Mining Pools",
      search: "mining pools join room community low medium",
    },
    miningHistory: {
      label: "History",
      search: "mining cycles history earnings collected past",
    },
    transactions: {
      label: "Transactions",
      search: "transactions history transfers search filter",
    },
    billing: {
      label: "Billing",
      search: "billing subscription plan pro benefits dates",
    },
    billingBenefits: {
      label: "Plan benefits",
      search: "plan benefits compare free pro history ranges custom address",
    },
    profile: {
      label: "Profile",
      search: "account details identity",
    },
    securityCenter: {
      label: "Security Center",
      search: "security center score layered sign-in transfer controls protections",
    },
    twoFactor: {
      label: "Two-Factor",
      search: "two-factor authentication authenticator one-time code sign-in",
    },
    transferPassword: {
      label: "Transfer Password",
      search: "transfer password separate confirmation approved",
    },
    freeze: {
      label: "Freeze Wallet",
      search: "freeze wallet emergency stop refused transfers unfreeze",
    },
    devices: {
      label: "Devices",
      search: "devices sessions signed in recognise revoke",
    },
    account: {
      label: "Account",
      search: "settings account management identity lifecycle",
    },
  },
  chrome: {
    more: "More",
    pro: "Pro",
    allPages: "All pages",
    allPagesDescription: "Every Louma page, grouped by section.",
    primaryNav: "Primary",
    pageInSection: "{section} section",
  },
};
