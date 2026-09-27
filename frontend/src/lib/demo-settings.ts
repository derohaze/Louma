import type { HugeiconsIcon } from "@hugeicons/react";
import { UserSettings01Icon } from "@hugeicons/core-free-icons";

type IconData = Parameters<typeof HugeiconsIcon>[0]["icon"];

/** Wallet preferences pages that own a settings route. */
export type SettingsHref = "/settings";

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
];

export const settingsPage = (href: SettingsHref): SettingsPage => {
  const page = settingsPages.find((item) => item.href === href);
  if (!page) throw new Error(`Unknown settings page: ${href}`);
  return page;
};
