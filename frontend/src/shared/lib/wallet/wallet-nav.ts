import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowUpRight01Icon,
  Award01Icon,
  ChartIncreaseIcon,
  CreditCardIcon,
  FavouriteIcon,
  Home04Icon,
  Notification01Icon,
  PickaxeIcon,
  QrCodeIcon,
  Settings01Icon,
  TransactionHistoryIcon,
  UserCircleIcon,
  UserGroupIcon,
  Wallet01Icon,
} from "@hugeicons/core-free-icons";
import type { TranslationPath } from "@/shared/i18n";
import { settingsPages, type SettingsHref } from "@/shared/lib/account";
import { securityCenter, securityPages, type SecurityHref } from "@/shared/lib/security";

type IconData = Parameters<typeof HugeiconsIcon>[0]["icon"];

export type NavHref =
  | "/"
  | "/analytics"
  | "/notifications"
  | "/transfer"
  | "/transfer/recipients"
  | "/mining"
  | "/mining/pools"
  | "/mining/history"
  | "/wallet"
  | "/transactions"
  | "/billing"
  | "/billing/benefits"
  | "/custom-address"
  | "/profile"
  | SecurityHref
  | SettingsHref;

/**
 * `titleKey` and `searchKey` are translation keys rather than text: this catalog is read at module
 * load, before a language is known, so the label is resolved by whoever renders it — the rail, the
 * panel, the search dialog — with the language current at that moment. `searchKey` is what the
 * search dialog matches on top of the visible label: the page's full title plus the words an owner
 * would type to find it, in their own language. The panel keeps showing the short label.
 */
type NavItem = {
  titleKey: TranslationPath;
  href: NavHref;
  icon: IconData;
  searchKey: TranslationPath;
};
/** A section always owns at least one page, so the rail can link to its landing page. */
export type NavSection = {
  titleKey: TranslationPath;
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

/** The words the search dialog matches for each security page, in the order the catalog lists them. */
const securitySearchKeys: Record<SecurityHref, TranslationPath> = {
  "/security": "nav.pages.securityCenter.search",
  "/security/two-factor": "nav.pages.twoFactor.search",
  "/security/transfer-password": "nav.pages.transferPassword.search",
  "/security/freeze": "nav.pages.freeze.search",
  "/security/devices": "nav.pages.devices.search",
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
    titleKey: "nav.sections.home",
    icon: Home04Icon,
    items: [
      {
        titleKey: "nav.pages.overview.label",
        href: "/",
        icon: Home04Icon,
        searchKey: "nav.pages.overview.search",
      },
      {
        titleKey: "nav.pages.analytics.label",
        href: "/analytics",
        icon: ChartIncreaseIcon,
        searchKey: "nav.pages.analytics.search",
      },
      {
        titleKey: "nav.pages.notifications.label",
        href: "/notifications",
        icon: Notification01Icon,
        searchKey: "nav.pages.notifications.search",
      },
    ],
  },
  {
    titleKey: "nav.sections.wallet",
    icon: Wallet01Icon,
    items: [
      {
        titleKey: "nav.pages.wallet.label",
        href: "/wallet",
        icon: Wallet01Icon,
        searchKey: "nav.pages.wallet.search",
      },
      {
        titleKey: "nav.pages.customAddress.label",
        href: "/custom-address",
        icon: QrCodeIcon,
        searchKey: "nav.pages.customAddress.search",
      },
    ],
  },
  {
    titleKey: "nav.sections.transfer",
    icon: ArrowUpRight01Icon,
    items: [
      {
        titleKey: "nav.pages.transfer.label",
        href: "/transfer",
        icon: ArrowUpRight01Icon,
        searchKey: "nav.pages.transfer.search",
      },
      {
        titleKey: "nav.pages.recipients.label",
        href: "/transfer/recipients",
        icon: FavouriteIcon,
        searchKey: "nav.pages.recipients.search",
      },
    ],
  },
  {
    titleKey: "nav.sections.mining",
    icon: PickaxeIcon,
    items: [
      {
        titleKey: "nav.pages.mining.label",
        href: "/mining",
        icon: PickaxeIcon,
        searchKey: "nav.pages.mining.search",
      },
      {
        titleKey: "nav.pages.miningPools.label",
        href: "/mining/pools",
        icon: UserGroupIcon,
        searchKey: "nav.pages.miningPools.search",
      },
      {
        titleKey: "nav.pages.miningHistory.label",
        href: "/mining/history",
        icon: ChartIncreaseIcon,
        searchKey: "nav.pages.miningHistory.search",
      },
    ],
  },
  {
    titleKey: "nav.sections.transactions",
    icon: TransactionHistoryIcon,
    items: [
      {
        titleKey: "nav.pages.transactions.label",
        href: "/transactions",
        icon: TransactionHistoryIcon,
        searchKey: "nav.pages.transactions.search",
      },
    ],
  },
  {
    titleKey: "nav.sections.billing",
    icon: CreditCardIcon,
    items: [
      {
        titleKey: "nav.pages.billing.label",
        href: "/billing",
        icon: CreditCardIcon,
        searchKey: "nav.pages.billing.search",
      },
      {
        titleKey: "nav.pages.billingBenefits.label",
        href: "/billing/benefits",
        icon: Award01Icon,
        searchKey: "nav.pages.billingBenefits.search",
      },
    ],
  },
  {
    titleKey: "nav.sections.profile",
    icon: UserCircleIcon,
    accountLevel: true,
    items: [
      {
        titleKey: "nav.pages.profile.label",
        href: "/profile",
        icon: UserCircleIcon,
        searchKey: "nav.pages.profile.search",
      },
    ],
  },
  {
    titleKey: "nav.sections.security",
    icon: securityCenter.icon,
    accountLevel: true,
    items: sectionItems(
      securityPages.map((page) => ({
        titleKey: page.labelKey,
        href: page.href,
        icon: page.icon,
        searchKey: securitySearchKeys[page.href],
      })),
    ),
  },
  {
    titleKey: "nav.sections.settings",
    icon: Settings01Icon,
    accountLevel: true,
    items: sectionItems(
      settingsPages.map((page) => ({
        titleKey: page.labelKey,
        href: page.href,
        icon: page.icon,
        searchKey: "nav.pages.account.search",
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
