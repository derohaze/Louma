import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowUpRight01Icon,
  BitcoinCpuIcon,
  ChartIncreaseIcon,
  FavouriteIcon,
  Home04Icon,
  QrCodeIcon,
  Settings01Icon,
  TransactionHistoryIcon,
  UserCircleIcon,
  UserGroupIcon,
  Wallet01Icon,
} from "@hugeicons/core-free-icons";
import { settingsPages, type SettingsHref } from "@/shared/lib/account";
import { securityCenter, securityPages, type SecurityHref } from "@/shared/lib/security";

type IconData = Parameters<typeof HugeiconsIcon>[0]["icon"];

export type NavHref =
  | "/"
  | "/analytics"
  | "/transfer"
  | "/transfer/recipients"
  | "/mining"
  | "/mining/pools"
  | "/mining/history"
  | "/wallet"
  | "/transactions"
  | "/custom-address"
  | "/profile"
  | SecurityHref
  | SettingsHref;

/**
 * `searchTerms` is what the search dialog matches on top of the visible label: the page's full
 * title plus the words an owner would type to find it. The panel keeps showing the short label.
 */
type NavItem = { title: string; href: NavHref; icon: IconData; searchTerms?: string };
/** A section always owns at least one page, so the rail can link to its landing page. */
export type NavSection = {
  title: string;
  icon: IconData;
  items: [NavItem, ...NavItem[]];
  /**
   * Profile, Security, and Settings belong to the account rather than to the wallet's own pages.
   * They are reached from the account menu, so they get no rail entry and the overview leaves them
   * out of its section list; the sidebar panel still shows them while one of their pages is open.
   */
  accountLevel?: boolean;
};

/**
 * Catalogs are static, so a section built from one is never empty; the guard makes that assumption
 * fail loudly at module load instead of rendering a rail entry with nowhere to go.
 */
const sectionItems = (items: readonly NavItem[]): [NavItem, ...NavItem[]] => {
  if (items.length === 0) throw new Error("A navigation section needs at least one page");
  return items as [NavItem, ...NavItem[]];
};

/**
 * Every page belongs to exactly one section. The rail lists the wallet's own sections, and the
 * sidebar panel renders only the pages of the section the current route belongs to, so one section
 * can never show another section's pages.
 *
 * The account-level sections (Profile, Security, Settings) are sections too: opening one of their
 * pages replaces the panel with their pages instead of the wallet's.
 */
export const navSections: readonly [NavSection, ...NavSection[]] = [
  {
    title: "Home",
    icon: Home04Icon,
    items: [
      { title: "Overview", href: "/", icon: Home04Icon, searchTerms: "balance dashboard home overview" },
      {
        title: "Analytics",
        href: "/analytics",
        icon: ChartIncreaseIcon,
        searchTerms: "analytics charts insights income expenses mining transfers activity",
      },
    ],
  },
  {
    title: "Wallet",
    icon: Wallet01Icon,
    items: [
      {
        title: "Wallet",
        href: "/wallet",
        icon: Wallet01Icon,
        searchTerms: "balance receiving address",
      },
      {
        title: "Custom Address",
        href: "/custom-address",
        icon: QrCodeIcon,
        searchTerms: "receiving address qr code",
      },
    ],
  },
  {
    title: "Transfer",
    icon: ArrowUpRight01Icon,
    items: [
      {
        title: "Transfer",
        href: "/transfer",
        icon: ArrowUpRight01Icon,
        searchTerms: "send transfer receive funds",
      },
      {
        title: "Recipients",
        href: "/transfer/recipients",
        icon: FavouriteIcon,
        searchTerms: "saved recent recipients favorites addresses",
      },
    ],
  },
  {
    title: "Mining",
    icon: BitcoinCpuIcon,
    items: [
      {
        title: "Mining",
        href: "/mining",
        icon: BitcoinCpuIcon,
        searchTerms: "mining rewards rate cycle earn lma earn",
      },
      {
        title: "Mining Pools",
        href: "/mining/pools",
        icon: UserGroupIcon,
        searchTerms: "mining pools join room community low medium",
      },
      {
        title: "History",
        href: "/mining/history",
        icon: ChartIncreaseIcon,
        searchTerms: "mining cycles history earnings collected past",
      },
    ],
  },
  {
    title: "Transactions",
    icon: TransactionHistoryIcon,
    items: [
      {
        title: "Transactions",
        href: "/transactions",
        icon: TransactionHistoryIcon,
        searchTerms: "transactions history transfers search filter",
      },
    ],
  },
  {
    title: "Profile",
    icon: UserCircleIcon,
    accountLevel: true,
    items: [
      {
        title: "Profile",
        href: "/profile",
        icon: UserCircleIcon,
        searchTerms: "account details identity",
      },
    ],
  },
  {
    title: "Security",
    icon: securityCenter.icon,
    accountLevel: true,
    items: sectionItems(
      securityPages.map((page) => ({
        title: page.label,
        href: page.href,
        icon: page.icon,
        searchTerms: `${page.title} ${page.description}`,
      })),
    ),
  },
  {
    title: "Settings",
    icon: Settings01Icon,
    accountLevel: true,
    items: sectionItems(
      settingsPages.map((page) => ({
        title: page.label,
        href: page.href,
        icon: page.icon,
        searchTerms: `${page.title} ${page.description}`,
      })),
    ),
  },
];

export const navItems: NavItem[] = navSections.flatMap((section) => section.items);

/**
 * The section that owns `pathname`, or undefined for pages outside the navigation.
 *
 * Pages that live under a section without being nav entries — a single transaction — resolve
 * through the longest matching prefix, so the panel keeps showing the pages of the section the
 * reader came from.
 */
export const findActiveSection = (pathname: string): NavSection | undefined =>
  navSections
    .flatMap((section) => section.items.map((item) => ({ section, href: item.href })))
    .filter(({ href }) =>
      href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`),
    )
    .sort((first, second) => second.href.length - first.href.length)[0]?.section;
