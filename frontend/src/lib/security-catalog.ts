import type { HugeiconsIcon } from "@hugeicons/react";
import {
  Clock01Icon,
  DeviceAccessIcon,
  FirewallIcon,
  FingerPrintIcon,
  GlobeLockIcon,
  MoneyLockIcon,
  SecurityCheckIcon,
  SecurityPasswordIcon,
  SnowIcon,
  SquareLockPasswordIcon,
  UserCheck01Icon,
} from "@hugeicons/core-free-icons";

type IconData = Parameters<typeof HugeiconsIcon>[0]["icon"];

/**
 * Static description of the wallet's security controls: what exists, what it is called, and how
 * much it counts towards the security score. The sidebar, the routes, and the demo store all read
 * this catalog so a feature can never be listed in the navigation without a page behind it.
 *
 * Names mirror the controls of the previous wallet so the redesign stays recognisable.
 */
export type SecurityHref =
  | "/security"
  | "/security/password"
  | "/security/two-factor"
  | "/security/transfer-password"
  | "/security/daily-limit"
  | "/security/auto-sign-in"
  | "/security/time-access"
  | "/security/geo-lock"
  | "/security/ip-whitelist"
  | "/security/transfer-approval"
  | "/security/freeze"
  | "/security/devices";

/** What every Security page exposes: enough for the sidebar, the route head, and the page title. */
export interface SecurityPage {
  /** Page title, e.g. the breadcrumb and the browser tab. */
  title: string;
  /** Sidebar label; shorter than the title so it never wraps in the panel. */
  label: string;
  href: SecurityHref;
  icon: IconData;
  description: string;
}

export type SecurityFeatureId =
  | "two-factor"
  | "transfer-password"
  | "daily-limit"
  | "auto-sign-in"
  | "time-access"
  | "geo-lock"
  | "ip-whitelist";

export interface SecurityFeature extends SecurityPage {
  id: SecurityFeatureId;
  /**
   * Weight in the security score. The enabled weights add up to 100, so the score reads as
   * "how much of the available protection is switched on".
   */
  importance: number;
}

/** Landing page of the section: status, score, and the switch list for every feature. */
export const securityCenter: SecurityPage = {
  title: "Security Center",
  label: "Security Center",
  href: "/security",
  icon: SecurityCheckIcon,
  description: "Layered sign-in and transfer controls for your wallet.",
};

/** The credential that opens the wallet. It is a page, not a toggle, so it sits outside the score. */
export const securityWalletPassword: SecurityPage = {
  title: "Wallet Password",
  label: "Wallet Password",
  href: "/security/password",
  icon: SquareLockPasswordIcon,
  description: "Change the password that opens this wallet.",
};

/** Chooses which protection approves a transfer; it holds no score of its own. */
export const securityTransferApproval: SecurityPage = {
  title: "Transfer Approval",
  label: "Transfer Approval",
  href: "/security/transfer-approval",
  icon: SecurityPasswordIcon,
  description: "Decide what must be entered before a transfer leaves the wallet.",
};

/** The emergency stop: instant, reversible, and outside the score. */
export const securityFreezeWallet: SecurityPage = {
  title: "Freeze Wallet",
  label: "Freeze Wallet",
  href: "/security/freeze",
  icon: SnowIcon,
  description: "Stop every transfer and sign-in right away, then unfreeze when you are ready.",
};

/** Devices signed in to the wallet, with a revoke action per row. */
export const securityDevices: SecurityPage = {
  title: "Devices & Sessions",
  label: "Devices",
  href: "/security/devices",
  icon: DeviceAccessIcon,
  description: "See every device signed in to this wallet and end the ones you do not recognise.",
};

/**
 * Pages that control the wallet without counting towards the score: a credential, the transfer
 * approval choice, the emergency freeze, and the device list.
 */
export const securityControls: readonly SecurityPage[] = [
  securityWalletPassword,
  securityTransferApproval,
  securityFreezeWallet,
  securityDevices,
];

export const securityFeatures: readonly SecurityFeature[] = [
  {
    id: "two-factor",
    title: "Two-Factor Authentication",
    label: "Two-Factor",
    href: "/security/two-factor",
    icon: FingerPrintIcon,
    description: "Ask for a one-time code from your authenticator app at every sign-in.",
    importance: 25,
  },
  {
    id: "transfer-password",
    title: "Transfer Password",
    label: "Transfer Password",
    href: "/security/transfer-password",
    icon: SecurityPasswordIcon,
    description: "Require a separate password before a transfer is approved.",
    importance: 10,
  },
  {
    id: "daily-limit",
    title: "Daily Transfer Limit",
    label: "Daily Limit",
    href: "/security/daily-limit",
    icon: MoneyLockIcon,
    description: "Cap how much LMA can leave the wallet in a single day.",
    importance: 8,
  },
  {
    id: "auto-sign-in",
    title: "Auto Sign-In",
    label: "Auto Sign-In",
    href: "/security/auto-sign-in",
    icon: UserCheck01Icon,
    description: "Stay signed in on this device without entering credentials again.",
    importance: 7,
  },
  {
    id: "time-access",
    title: "Time-based Access",
    label: "Time Access",
    href: "/security/time-access",
    icon: Clock01Icon,
    description: "Only allow wallet access during the hours you choose.",
    importance: 7,
  },
  {
    id: "geo-lock",
    title: "Geo-Lock",
    label: "Geo-Lock",
    href: "/security/geo-lock",
    icon: GlobeLockIcon,
    description: "Allow sign-ins from the countries you choose, and nothing else.",
    importance: 15,
  },
  {
    id: "ip-whitelist",
    title: "IP Whitelist",
    label: "IP Whitelist",
    href: "/security/ip-whitelist",
    icon: FirewallIcon,
    description: "Approve the IP addresses that may reach this wallet, starting with this device.",
    importance: 28,
  },
];

export const securityScoreMax = securityFeatures.reduce(
  (total, feature) => total + feature.importance,
  0,
);

/**
 * Every Security page in sidebar order: the center, the protections that make up the score, then
 * the controls that sit outside it. The nav renders this list, so adding a page here is all it
 * takes to give it a sidebar entry.
 */
export const securityPages: readonly SecurityPage[] = [
  securityCenter,
  ...securityFeatures,
  ...securityControls,
];

export const securityFeature = (id: SecurityFeatureId): SecurityFeature => {
  const feature = securityFeatures.find((item) => item.id === id);
  if (!feature) throw new Error(`Unknown security feature: ${id}`);
  return feature;
};
