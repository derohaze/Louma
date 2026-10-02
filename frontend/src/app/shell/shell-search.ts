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
export const searchPages: SearchPage[] = navSections.flatMap((section) =>
  section.items.map((item) => ({
    id: `page:${item.href}`,
    title: item.title,
    subtitle: item.title === section.title ? `${section.title} section` : section.title,
    icon: item.icon,
    href: item.href,
    category: section.title,
    terms: item.searchTerms ?? "",
  })),
);

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
