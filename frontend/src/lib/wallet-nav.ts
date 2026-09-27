import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowUpRight01Icon,
  CpuIcon,
  DashboardSquare01Icon,
  QrCodeIcon,
  TransactionHistoryIcon,
  TrophyIcon,
  Wallet01Icon,
} from "@hugeicons/core-free-icons";

type IconData = Parameters<typeof HugeiconsIcon>[0]["icon"];

export type NavHref =
  | "/"
  | "/mining"
  | "/transfer"
  | "/wallet"
  | "/history"
  | "/custom-address"
  | "/leaderboard"
  | "/settings";

export type NavItem = { title: string; href: NavHref; icon: IconData };
/** A section always owns at least one page, so the rail can link to its landing page. */
export type NavSection = { title: string; icon: IconData; items: [NavItem, ...NavItem[]] };

/**
 * Every page belongs to exactly one section. The rail lists the sections themselves and the
 * sidebar panel renders only the pages of the section the current route belongs to, so one
 * section can never show another section's pages.
 *
 * Settings and Security are deliberately absent: they are reached from the account menu.
 */
export const navSections: readonly [NavSection, ...NavSection[]] = [
  {
    title: "Overview",
    icon: DashboardSquare01Icon,
    items: [{ title: "Overview", href: "/", icon: DashboardSquare01Icon }],
  },
  {
    title: "Mining",
    icon: CpuIcon,
    items: [{ title: "Mining", href: "/mining", icon: CpuIcon }],
  },
  {
    title: "Wallet",
    icon: Wallet01Icon,
    items: [
      { title: "Wallet", href: "/wallet", icon: Wallet01Icon },
      { title: "Custom Address", href: "/custom-address", icon: QrCodeIcon },
    ],
  },
  {
    title: "Transfers",
    icon: ArrowUpRight01Icon,
    items: [
      { title: "Transfer", href: "/transfer", icon: ArrowUpRight01Icon },
      { title: "History", href: "/history", icon: TransactionHistoryIcon },
    ],
  },
  {
    title: "Account",
    icon: TrophyIcon,
    items: [{ title: "Leaderboard", href: "/leaderboard", icon: TrophyIcon }],
  },
];

export const navItems: NavItem[] = navSections.flatMap((section) => section.items);

/**
 * The section that owns `pathname`, or undefined for pages outside the navigation (Settings and
 * Security are only reachable from the account menu, so no section may claim them).
 */
export const findActiveSection = (pathname: string): NavSection | undefined =>
  navSections.find((section) => section.items.some((item) => item.href === pathname));
