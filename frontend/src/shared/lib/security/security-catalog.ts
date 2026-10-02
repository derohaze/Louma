import type { HugeiconsIcon } from "@hugeicons/react";
import {
  DeviceAccessIcon,
  FingerPrintIcon,
  SecurityCheckIcon,
  SecurityPasswordIcon,
  SnowIcon,
} from "@hugeicons/core-free-icons";

type IconData = Parameters<typeof HugeiconsIcon>[0]["icon"];

/**
 * Static description of the wallet's security controls: what exists, what it is called, and how
 * much it counts towards the security score. The sidebar, the routes, and the Security Center all
 * read this catalog, so a feature can never be listed in the navigation without a page behind it.
 */
export type SecurityHref =
  | "/security"
  | "/security/two-factor"
  | "/security/transfer-password"
  | "/security/freeze"
  | "/security/devices";

/** What every Security page exposes: enough for the sidebar, the route head, and the page title. */
interface SecurityPage {
  /** Page title, e.g. the breadcrumb and the browser tab. */
  title: string;
  /** Sidebar label; shorter than the title so it never wraps in the panel. */
  label: string;
  href: SecurityHref;
  icon: IconData;
  description: string;
}

export type SecurityFeatureId = "two-factor" | "transfer-password";

interface SecurityFeature extends SecurityPage {
  id: SecurityFeatureId;
  /**
   * Weight in the security score. The weights together make up `securityScoreMax`, so the score
   * reads as "how much of the available protection is switched on".
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
 * Pages that control the wallet without counting towards the score: the emergency freeze and the
 * device list.
 */
export const securityControls: readonly SecurityPage[] = [securityFreezeWallet, securityDevices];

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
