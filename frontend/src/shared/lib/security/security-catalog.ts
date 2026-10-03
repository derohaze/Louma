import type { HugeiconsIcon } from "@hugeicons/react";
import {
  DeviceAccessIcon,
  FingerPrintIcon,
  SecurityCheckIcon,
  SecurityPasswordIcon,
  SnowIcon,
} from "@hugeicons/core-free-icons";
import type { TranslationPath } from "@/shared/i18n";

type IconData = Parameters<typeof HugeiconsIcon>[0]["icon"];

/**
 * Static description of the wallet's security controls: what exists, what it is called, and how
 * much it counts towards the security score. The sidebar, the routes, and the Security Center all
 * read this catalog, so a feature can never be listed in the navigation without a page behind it.
 *
 * Names are kept as translation keys rather than text: the catalog is module-level data that is
 * read before a language is known, so the pages render `translate(page.titleKey)` at the moment
 * they paint, and a switch of language re-renders them with the same entry.
 */
export type SecurityHref =
  | "/security"
  | "/security/two-factor"
  | "/security/transfer-password"
  | "/security/freeze"
  | "/security/devices";

/** What every Security page exposes: enough for the sidebar, the route head, and the page title. */
export interface SecurityPage {
  /** Page title, e.g. the breadcrumb and the browser tab. */
  titleKey: TranslationPath;
  /** Sidebar label; shorter than the title so it never wraps in the panel. */
  labelKey: TranslationPath;
  href: SecurityHref;
  icon: IconData;
  descriptionKey: TranslationPath;
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
  titleKey: "security.catalog.pages.center.title",
  labelKey: "nav.pages.securityCenter.label",
  href: "/security",
  icon: SecurityCheckIcon,
  descriptionKey: "security.catalog.pages.center.description",
};

/** The emergency stop: instant, reversible, and outside the score. */
export const securityFreezeWallet: SecurityPage = {
  titleKey: "security.catalog.pages.freeze.title",
  labelKey: "nav.pages.freeze.label",
  href: "/security/freeze",
  icon: SnowIcon,
  descriptionKey: "security.catalog.pages.freeze.description",
};

/** Devices signed in to the wallet, with a revoke action per row. */
export const securityDevices: SecurityPage = {
  titleKey: "security.catalog.pages.devices.title",
  labelKey: "nav.pages.devices.label",
  href: "/security/devices",
  icon: DeviceAccessIcon,
  descriptionKey: "security.catalog.pages.devices.description",
};

/**
 * Pages that control the wallet without counting towards the score: the emergency freeze and the
 * device list.
 */
export const securityControls: readonly SecurityPage[] = [securityFreezeWallet, securityDevices];

export const securityFeatures: readonly SecurityFeature[] = [
  {
    id: "two-factor",
    titleKey: "security.catalog.pages.twoFactor.title",
    labelKey: "nav.pages.twoFactor.label",
    href: "/security/two-factor",
    icon: FingerPrintIcon,
    descriptionKey: "security.catalog.pages.twoFactor.description",
    importance: 25,
  },
  {
    id: "transfer-password",
    titleKey: "security.catalog.pages.transferPassword.title",
    labelKey: "nav.pages.transferPassword.label",
    href: "/security/transfer-password",
    icon: SecurityPasswordIcon,
    descriptionKey: "security.catalog.pages.transferPassword.description",
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
