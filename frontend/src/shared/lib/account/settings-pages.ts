import type { HugeiconsIcon } from "@hugeicons/react";
import { UserSettings01Icon } from "@hugeicons/core-free-icons";

type IconData = Parameters<typeof HugeiconsIcon>[0]["icon"];
export type SettingsHref = "/settings";

export interface SettingsPage {
  title: string;
  label: string;
  href: SettingsHref;
  icon: IconData;
  description: string;
}

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
