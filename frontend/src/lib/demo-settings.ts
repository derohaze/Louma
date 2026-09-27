import type { HugeiconsIcon } from "@hugeicons/react";
import { EyeOffIcon, UserSettings01Icon } from "@hugeicons/core-free-icons";

type IconData = Parameters<typeof HugeiconsIcon>[0]["icon"];

/**
 * Wallet preferences that are not part of the wallet row itself. They live in their own in-memory
 * store for the same reason as the other demo stores: the settings API does not exist yet, and the
 * pages that read them (Privacy, Leaderboard) should keep working unchanged once it does.
 */ export type SettingsHref = "/settings" | "/settings/privacy";

export interface SettingsPage {
  /** Page title, e.g. the breadcrumb and the browser tab. */
  title: string;
  /** Sidebar label; shorter than the title so it never wraps in the panel. */
  label: string;
  href: SettingsHref;
  icon: IconData;
  description: string;
}

/** The settings pages, in sidebar order. Each one owns a route with the same href. */
export const settingsPages: readonly SettingsPage[] = [
  {
    title: "Account Management",
    label: "Account",
    href: "/settings",
    icon: UserSettings01Icon,
    description: "Your wallet identity and the account lifecycle.",
  },
  {
    title: "Privacy",
    label: "Privacy",
    href: "/settings/privacy",
    icon: EyeOffIcon,
    description: "Choose what the wallet shows and what others can see.",
  },
];

export const settingsPage = (href: SettingsHref): SettingsPage => {
  const page = settingsPages.find((item) => item.href === href);
  if (!page) throw new Error(`Unknown settings page: ${href}`);
  return page;
};

export interface WalletSettings {
  /** Keeps this wallet out of the leaderboard completely. */
  hideRanking: boolean;
  /** Emails a message for every security-relevant event. */
  emailSecurityAlerts: boolean;
  /** Adds a confirmation step to the transfer form. */
  confirmTransfers: boolean;
}

const state: WalletSettings = {
  hideRanking: false,
  emailSecurityAlerts: true,
  confirmTransfers: true,
};

export const readSettings = (): WalletSettings => ({ ...state });

export const updateSettings = (changes: Partial<WalletSettings>): void => {
  Object.assign(state, changes);
};
