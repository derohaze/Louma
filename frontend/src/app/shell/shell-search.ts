import { translateIn, type LanguageCode } from "@/shared/i18n";
import type { IconData } from "@/shared/ui/page";
import { navSections, type NavHref } from "@/shared/lib/wallet";

/** One row of the search dialog: a page, a security control, a setting, or a transaction. */
export type SearchEntry = {
  id: string;
  title: string;
  subtitle: string;
  icon: IconData;
  href: NavHref;
};

/**
 * Search covers the whole wallet: every navigation section, every page inside it (security
 * controls and settings included, because they are pages too), and the transactions themselves.
 * The catalog is derived from the navigation so a new page can never be unreachable by search.
 */
export type SearchPage = SearchEntry & { category: string; terms: string };

/**
 * The catalog, in the language current when it is built: the label the reader sees and the words the
 * dialog matches on both come from the navigation's own translation keys, so someone typing Arabic
 * finds a page by its Arabic name.
 */
export function buildSearchPages(
  language: LanguageCode,
  isPro: boolean,
  developer = false,
): SearchPage[] {
  return navSections
    .filter((section) => !section.developerOnly || developer)
    .flatMap((section) => {
      const sectionTitle = translateIn(language, section.titleKey);
      return section.items
        .filter((item) => isPro || item.href !== "/custom-address")
        .map((item) => {
          const title = translateIn(language, item.titleKey);
          return {
            id: `page:${item.href}`,
            title,
            subtitle:
              title === sectionTitle
                ? translateIn(language, "nav.chrome.pageInSection", { section: sectionTitle })
                : sectionTitle,
            icon: item.icon,
            href: item.href,
            category: sectionTitle,
            terms: translateIn(language, item.searchKey),
          };
        });
    });
}

/** Order of the dialog's default list, so it opens on the pages an owner reaches for most. */
const searchPageRank: NavHref[] = [
  "/transfer",
  "/mining",
  "/wallet",
  "/transactions",
  "/security",
  "/custom-address",
  "/profile",
  "/settings",
];
export const searchRank = (href: NavHref) => {
  const index = searchPageRank.indexOf(href);
  return index === -1 ? searchPageRank.length : index;
};
export const searchPageLimit = 6;
export const searchTransactionLimit = 3;
