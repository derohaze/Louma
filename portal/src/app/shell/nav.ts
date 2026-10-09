import {
  ArrowLeftRight,
  ArrowUpFromLine,
  KeyRound,
  LayoutGrid,
  LifeBuoy,
  Pickaxe,
  ScrollText,
  Settings2,
  Timer,
  UserCog,
  Users,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
}

export interface NavGroup {
  group: string;
  items: NavItem[];
}

/** Sidebar navigation, grouped exactly as the console presents it. */
export const NAV: NavGroup[] = [
  { group: "Overview", items: [{ to: "/", label: "Dashboard", icon: LayoutGrid }] },
  {
    group: "People",
    items: [
      { to: "/users", label: "Users", icon: Users },
      { to: "/tickets", label: "Support Tickets", icon: LifeBuoy },
    ],
  },
  {
    group: "Finance",
    items: [
      { to: "/withdrawals", label: "Withdrawals", icon: ArrowUpFromLine },
      { to: "/transactions", label: "Transactions", icon: ArrowLeftRight },
    ],
  },
  {
    group: "Mining",
    items: [
      { to: "/mining-rooms", label: "Mining Rooms", icon: Pickaxe },
      { to: "/mining-rounds", label: "Mining Rounds", icon: Timer },
    ],
  },
  {
    group: "Administration",
    items: [
      { to: "/staff", label: "Staff", icon: UserCog },
      { to: "/roles", label: "Roles & Permissions", icon: KeyRound },
      { to: "/audit-logs", label: "Audit Logs", icon: ScrollText },
      { to: "/settings", label: "System Settings", icon: Settings2 },
    ],
  },
];

export const ALL_NAV_ITEMS: NavItem[] = NAV.flatMap((group) => group.items);
