import type { HugeiconsIcon } from "@hugeicons/react";
import { UserSettings01Icon } from "@hugeicons/core-free-icons";
import type { TranslationPath } from "@/shared/i18n";

type IconData = Parameters<typeof HugeiconsIcon>[0]["icon"];
export type SettingsHref = "/settings";

/** Names are translation keys; the page translates them when it renders (see security-catalog). */
export interface SettingsPage {
  titleKey: TranslationPath;
  labelKey: TranslationPath;
  href: SettingsHref;
  icon: IconData;
  descriptionKey: TranslationPath;
}

export const settingsPages: readonly SettingsPage[] = [
  {
    titleKey: "settings.account.title",
    labelKey: "nav.pages.account.label",
    href: "/settings",
    icon: UserSettings01Icon,
    descriptionKey: "settings.account.description",
  },
];

export const settingsPage = (href: SettingsHref): SettingsPage => {
  const page = settingsPages.find((item) => item.href === href);
  if (!page) throw new Error(`Unknown settings page: ${href}`);
  return page;
};
