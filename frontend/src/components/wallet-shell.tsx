import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowRight01Icon,
  ArrowDownLeft01Icon,
  ArrowUpRight01Icon,
  Home04Icon,
  Settings01Icon,
  SnowIcon,
  Search01Icon,
  UserCircleIcon,
  Menu01Icon,
  SecurityCheckIcon,
  Copy01Icon,
  Logout01Icon,
} from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { WalletContext } from "@/hooks/use-wallet";
import { WalletNotifications } from "@/components/wallet-notifications";
import { cn } from "@/lib/utils";
import {
  findActiveSection,
  navItems,
  navSections,
  type NavHref,
  type NavItem,
  type NavSection,
} from "@/lib/wallet-nav";
import { readSecurity, subscribeSecurity } from "@/lib/demo-security";
import { demoLogout, isAuthed } from "@/lib/demo-auth";
import { LIMITS } from "@/lib/validation";
import { DEMO_USER_EMAIL, DEMO_USER_ID, readTransactions, readWallet } from "@/lib/demo-wallet";
import { readProfile } from "@/lib/demo-profile";
import { currency, dateText } from "@/lib/wallet-format";
import type { Transaction, Wallet } from "@/lib/demo-wallet";

export type { Transaction, Wallet };
type IconData = Parameters<typeof HugeiconsIcon>[0]["icon"];
export function Icon({
  icon,
  size = 20,
  className,
}: {
  icon: IconData;
  size?: number;
  className?: string;
}) {
  return <HugeiconsIcon icon={icon} size={size} strokeWidth={1.7} className={className} />;
}
export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="font-display text-2xl font-semibold">{title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{subtitle}</p>
      </div>
      {action}
    </div>
  );
}
export function EmptyState({
  title,
  detail,
  action,
}: {
  title: string;
  detail: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex min-h-40 flex-col items-center justify-center gap-3 px-5 py-8 text-center">
      <p className="font-semibold">{title}</p>
      <p className="max-w-sm text-sm text-muted-foreground">{detail}</p>
      {action}
    </div>
  );
}
export function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="ghost"
      size="icon"
      title="Copy address"
      aria-label="Copy address"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1800);
      }}
    >
      <Icon icon={Copy01Icon} size={18} />
      <span className="sr-only">{copied ? "Copied" : "Copy"}</span>
    </Button>
  );
}

/** Flat position of every page, so the staggered entrance follows the visible order. */
const navOrder = new Map<NavHref, number>(navItems.map((item, index) => [item.href, index]));

/** One row of the search dialog: a page, a security control, a setting, or a transaction. */
type SearchEntry = { id: string; title: string; subtitle: string; icon: IconData; href: NavHref };

/**
 * Search covers the whole wallet: every navigation section, every page inside it (security
 * controls and settings included, because they are pages too), and the transactions themselves.
 * The catalog is derived from the navigation so a new page can never be unreachable by search.
 */
type SearchPage = SearchEntry & { category: string; terms: string };
const searchPages: SearchPage[] = navSections.flatMap((section) =>
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
  "/wallet",
  "/history",
  "/mining",
  "/security",
  "/custom-address",
  "/leaderboard",
  "/profile",
  "/settings",
];
const searchRank = (href: NavHref) => {
  const index = searchPageRank.indexOf(href);
  return index === -1 ? searchPageRank.length : index;
};
const searchPageLimit = 6;
const searchTransactionLimit = 3;

/**
 * Compact rail item: the rail lists sections, and the panel below shows the pages of the one
 * the route belongs to. Clicking a section opens its landing page.
 */
function RailLink({ section, current }: { section: NavSection; current: boolean }) {
  return (
    <Link
      to={section.items[0].href}
      aria-current={current ? "page" : undefined}
      className={cn(
        "group flex min-h-[68px] flex-col items-center justify-center gap-1.5 text-[11px] font-semibold",
        current ? "text-[#323234]" : "text-[#58585E] hover:text-[#323234]",
      )}
    >
      <span
        className={cn(
          "grid size-10 place-items-center rounded-xl transition-colors",
          current ? "bg-card text-[#323234] shadow-sm" : "text-[#58585E] group-hover:bg-card/70",
        )}
      >
        <Icon icon={section.icon} size={21} />
      </span>
      <span className="max-w-[64px] text-center leading-4">{section.title}</span>
    </Link>
  );
}

export function WalletPage({ children, title }: { children: ReactNode; title: string }) {
  const [userId, setUserId] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState("");
  /**
   * Demo auth gate: every wallet page waits for this check, so an unauthenticated visitor
   * never sees dashboard content. The check runs in an effect (never during render) to keep
   * server and client rendering identical, since the session lives in localStorage.
   */
  const [authChecked, setAuthChecked] = useState(false);
  /** The account menu shows the profile name, so it reads the store on every render. */
  const profile = readProfile();
  const navigate = useNavigate();
  const location = useLocation();
  const mainRef = useRef<HTMLElement | null>(null);
  // <main> is the app shell's scroll container, so the router's window-based scroll
  // restoration cannot reset it: do it here whenever the route changes.
  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0 });
  }, [location.pathname]);
  const refresh = async () => {
    setUserId(DEMO_USER_ID);
    setEmail(DEMO_USER_EMAIL);
    setWallet(readWallet());
    setTransactions(readTransactions());
    setError("");
    setLoading(false);
  };
  useEffect(() => {
    void refresh();
  }, []);
  useEffect(() => {
    if (isAuthed()) {
      setAuthChecked(true);
    } else {
      void navigate({ to: "/login" });
    }
  }, [navigate]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  const value = useMemo(
    () => ({ userId, email, wallet, transactions, loading, error, refresh }),
    [userId, email, wallet, transactions, loading, error],
  );
  const activeSection = findActiveSection(location.pathname);
  /**
   * Subscribed rather than read on render: a freeze switched on from a Security page has to lock
   * the pages around it right away, not on the next route change. The security pages themselves
   * stay reachable, so the owner can always undo the lock.
   */
  const security = useSyncExternalStore(subscribeSecurity, readSecurity, readSecurity);
  const walletFrozen = security.frozen;
  /**
   * Security pages stay reachable while the wallet is frozen: whoever froze it has to be able to
   * unfreeze it from the same device. Everything else waits.
   */
  const securitySectionOpen = location.pathname.startsWith("/security");
  const accessClosed = walletFrozen && !securitySectionOpen;
  /**
   * With no query the panel is a quick launcher, so it lists the most used pages instead of all of
   * them. Transactions join the list as soon as the owner types.
   */
  const query = search.trim().toLowerCase();
  const browsing = query.length === 0;
  const matchedPages = searchPages.filter(
    (page) =>
      !query || `${page.title} ${page.subtitle} ${page.terms}`.toLowerCase().includes(query),
  );
  const pageResults = (
    browsing
      ? [...matchedPages].sort((a, b) => searchRank(a.href) - searchRank(b.href))
      : matchedPages
  ).slice(0, searchPageLimit);
  const transactionResults: SearchEntry[] = browsing
    ? []
    : transactions
        .filter((tx) =>
          `${tx.counterparty_address} ${tx.note} ${tx.transfer_id}`.toLowerCase().includes(query),
        )
        .slice(0, searchTransactionLimit)
        .map((tx) => ({
          id: `tx:${tx.id}`,
          title: tx.counterparty_address,
          subtitle: `${tx.direction === "sent" ? "Sent" : "Received"} · ${currency(tx.amount)} · ${dateText(tx.created_at)}`,
          icon: tx.direction === "sent" ? ArrowUpRight01Icon : ArrowDownLeft01Icon,
          href: "/history" as const,
        }));
  const results: SearchEntry[] = [...pageResults, ...transactionResults];
  const resultsHeading = browsing ? "Most used" : "Results";
  /** Every row leaves the dialog in the same state, so the next opening starts clean. */
  const openResult = (href: NavHref) => {
    setSearchOpen(false);
    setSearch("");
    navigate({ to: href });
  };
  const panelLink = ({ title: label, href, icon }: NavItem) => {
    const current = location.pathname === href;
    return (
      <Link
        key={href}
        to={href}
        onClick={() => setMobileNavOpen(false)}
        aria-current={current ? "page" : undefined}
        style={{ transitionDelay: `${(navOrder.get(href) ?? 0) * 60}ms` }}
        className={cn(
          "mb-1 flex h-10 w-full items-center gap-2.5 rounded-xl px-3 text-sm font-semibold transition-all duration-500 ease-[cubic-bezier(0.4,0,0.2,1)]",
          "translate-y-0 opacity-100",
          current
            ? "bg-card text-[#323234] shadow-sm"
            : "text-[#58585E] hover:bg-card/70 hover:text-[#323234]",
        )}
      >
        <Icon icon={icon} size={21} />
        <span>{label}</span>
      </Link>
    );
  };
  const sectionNav = (section: NavSection) => (
    <div key={section.title} className="mb-1">
      {section.items.map((item) => panelLink(item))}
    </div>
  );
  /**
   * `allSections` is used by the mobile drawer, where the rail that switches sections is not
   * rendered; the desktop panel stays scoped to the section of the current page.
   */
  const sidebar = (allSections: boolean) => (
    <aside className="h-full w-[228px] shrink-0 overflow-x-hidden overflow-y-auto bg-[#E9E9EC] px-3 py-4">
      <nav>
        {(allSections || !activeSection ? navSections : [activeSection]).map((section) =>
          sectionNav(section),
        )}
      </nav>
    </aside>
  );
  /**
   * While the gate redirects, show only the brand mark on the shell background —
   * dashboard content must never flash for an unauthenticated visitor.
   */
  if (!authChecked) {
    return (
      <div className="grid min-h-dvh place-items-center bg-shell">
        <img
          src="/Louma_Brand_logos/png/louma-logo-128x128.png"
          alt="Louma logo"
          width={64}
          height={64}
          draggable={false}
          className="size-16 shrink-0 border-0 bg-transparent object-contain shadow-none"
        />
      </div>
    );
  }
  return (
    <WalletContext.Provider value={value}>
      <div className="min-h-dvh bg-shell text-foreground">
        <header className="sticky top-0 z-50 flex h-[68px] items-center gap-4 bg-shell px-5 text-primary-foreground">
          <div className="flex w-[330px] items-center gap-3">
            <img
              src="/Louma_Brand_logos/png/louma-logo-256x256.png"
              alt="Louma logo"
              width={64}
              height={64}
              draggable={false}
              className="size-16 shrink-0 border-0 bg-transparent object-contain shadow-none outline-none"
            />
            <span className="font-display text-xl font-semibold tracking-tight">Louma</span>
          </div>
          <div className="ms-auto flex items-center gap-3">
            <Button
              variant="ghost"
              className="h-9 rounded-full border border-magenta px-4 text-primary-foreground hover:bg-primary/20 hover:text-primary-foreground"
              onClick={() => navigate({ to: "/transfer" })}
            >
              <Icon icon={ArrowUpRight01Icon} size={18} />
              Transfer
            </Button>
            <Popover
              open={searchOpen}
              onOpenChange={(open) => {
                setSearchOpen(open);
                if (!open) {
                  setSearch("");
                }
              }}
            >
              <PopoverTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Search"
                  aria-expanded={searchOpen}
                  className="rounded-full border border-primary-foreground/15 text-primary-foreground hover:bg-primary/20 hover:text-primary-foreground"
                >
                  <Icon icon={Search01Icon} />
                </Button>
              </PopoverTrigger>
              {/*
               * Anchored dropdown under the search button (align="end"):
               * non-modal, so there is no dimmed overlay behind it.
               */}
              <PopoverContent
                align="end"
                sideOffset={12}
                aria-label="Search Louma"
                className="w-[min(880px,calc(100vw-2rem))] gap-0 overflow-hidden rounded-[26px] border-0 bg-card p-0 shadow-2xl"
              >
                <div className="p-3">
                  <div className="flex h-14 items-center gap-3 rounded-2xl border bg-card px-4 shadow-sm">
                    <Icon
                      icon={Search01Icon}
                      size={20}
                      className="shrink-0 text-muted-foreground"
                    />
                    <Input
                      autoFocus
                      aria-label="Search"
                      maxLength={LIMITS.maxSearchLength}
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Search pages, transfers, and settings"
                      className="h-auto flex-1 border-0 bg-transparent p-0 ps-2 text-[15px] shadow-none focus-visible:ring-0"
                    />
                    <span className="hidden shrink-0 items-center gap-1.5 sm:flex">
                      <kbd className="rounded-md border bg-secondary px-2 py-1 text-[11px] font-semibold text-muted-foreground">
                        Ctrl
                      </kbd>
                      <kbd className="rounded-md border bg-secondary px-2 py-1 text-[11px] font-semibold text-muted-foreground">
                        K
                      </kbd>
                    </span>
                  </div>
                </div>
                <div className="max-h-[48vh] min-h-[286px] overflow-y-auto px-3 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  <p className="px-2 py-3 text-[13px] font-semibold">{resultsHeading}</p>
                  {results.length ? (
                    results.map((entry) => (
                      <button
                        key={entry.id}
                        type="button"
                        onClick={() => openResult(entry.href)}
                        className="flex w-full cursor-pointer items-center gap-3.5 rounded-2xl px-3 py-2.5 text-start transition-colors hover:bg-secondary"
                      >
                        <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-secondary">
                          <Icon icon={entry.icon} size={20} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[15px] font-semibold">
                            {entry.title}
                          </span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {entry.subtitle}
                          </span>
                        </span>
                        <Icon
                          icon={ArrowRight01Icon}
                          size={16}
                          className="shrink-0 text-muted-foreground"
                        />
                      </button>
                    ))
                  ) : (
                    <p className="px-3 py-10 text-center text-sm text-muted-foreground">
                      No matches for “{search.trim()}”.
                    </p>
                  )}
                </div>
                <div className="flex items-center justify-between gap-3 border-t bg-secondary/40 px-4 py-3">
                  <p className="text-sm text-muted-foreground">Can't find what you need?</p>
                  <Button
                    className="h-10 rounded-full px-5"
                    onClick={() => openResult("/transfer")}
                  >
                    <Icon icon={ArrowUpRight01Icon} size={18} />
                    New transfer
                  </Button>
                </div>
              </PopoverContent>
            </Popover>
            <WalletNotifications />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Account menu"
                  className="rounded-full border border-primary-foreground/15 text-primary-foreground hover:bg-primary/20 hover:text-primary-foreground"
                >
                  <Icon icon={UserCircleIcon} />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-72 rounded-[20px] p-3">
                <DropdownMenuLabel>
                  <strong className="block font-display">{profile.displayName}</strong>
                  <span className="text-xs font-normal text-muted-foreground">
                    {email ?? "Not signed in"}
                  </span>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => navigate({ to: "/profile" })}>
                  <Icon icon={UserCircleIcon} />
                  Profile
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => navigate({ to: "/security" })}>
                  <Icon icon={SecurityCheckIcon} />
                  Security
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => navigate({ to: "/settings" })}>
                  <Icon icon={Settings01Icon} />
                  Settings
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={() => {
                    demoLogout();
                    navigate({ to: "/login" });
                  }}
                >
                  <Icon icon={Logout01Icon} />
                  Log out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Open navigation"
              onClick={() => setMobileNavOpen((v) => !v)}
              className="rounded-full border border-primary-foreground/15 text-primary-foreground hover:bg-primary/20 hover:text-primary-foreground lg:hidden"
            >
              <Icon icon={Menu01Icon} />
            </Button>
          </div>
        </header>
        {/*
         * The shell is exactly one viewport tall, so the page itself never scrolls and the
         * rounded top corners of the surface stay put. Only <main> scrolls (see below).
         * `bg-shell` (not `bg-panel`): the surface background is only visible through those
         * corners, and it must match the dark shell for the arcs to read as curves.
         */}
        <div className="app-surface flex h-[calc(100dvh-68px)] bg-shell">
          <aside className="hidden h-full w-[72px] shrink-0 overflow-x-hidden overflow-y-auto border-e border-border bg-[#E9E9EC] md:flex md:flex-col">
            {/* Account-level sections stay out of the rail: the account menu owns them. */}
            {navSections
              .filter((section) => !section.accountLevel)
              .map((section) => (
                <RailLink
                  key={section.title}
                  section={section}
                  current={section.title === activeSection?.title}
                />
              ))}
          </aside>
          <div className="hidden h-full shrink-0 bg-[#E9E9EC] lg:flex">{sidebar(false)}</div>
          <div
            className={cn(
              "fixed inset-x-0 top-[68px] z-40 grid bg-shell/30 transition-all duration-500 ease-[cubic-bezier(0.4,0,0.2,1)] lg:hidden",
              mobileNavOpen
                ? "grid-rows-[1fr] opacity-100"
                : "pointer-events-none grid-rows-[0fr] opacity-0",
            )}
          >
            <div className="overflow-hidden">
              <div className="ms-auto max-h-[calc(100dvh-68px)] min-h-[calc(100dvh-68px)] w-[228px] overflow-x-hidden overflow-y-auto bg-[#E9E9EC] shadow-xl">
                {sidebar(true)}
              </div>
            </div>
          </div>
          {/*
           * The only scroll container in the app shell: its rounded top corner is fixed, so the
           * shell keeps its curve while the content scrolls under it. `tabIndex={0}` keeps the
           * region keyboard-scrollable (wheel, PageDown, arrows) even when focus is on the page.
           */}
          <main
            ref={mainRef}
            tabIndex={0}
            className="relative min-w-0 flex-1 overflow-x-hidden overflow-y-auto bg-[#F5F5F6] [scrollbar-width:none] rounded-se-(--app-corner-size) max-md:rounded-ss-(--app-corner-size) [&::-webkit-scrollbar]:hidden"
          >
            <div className="dotted-canvas pointer-events-none absolute end-0 top-0 h-48 w-[38%] [mask-image:linear-gradient(to_bottom_left,black,transparent)]" />
            <div className="dotted-canvas pointer-events-none absolute bottom-0 start-0 h-32 w-[28%] [mask-image:linear-gradient(to_top_right,black,transparent)]" />
            <div className="relative mx-auto max-w-[1380px] p-5 lg:p-8">
              <div className="mb-5 flex items-center gap-2 text-sm text-muted-foreground">
                <Icon icon={Home04Icon} size={17} />
                {activeSection && activeSection.title !== title && (
                  <>
                    <Icon icon={ArrowRight01Icon} size={15} />
                    <span>{activeSection.title}</span>
                  </>
                )}
                <Icon icon={ArrowRight01Icon} size={15} />
                <strong className="text-foreground">{title}</strong>
              </div>
              {walletFrozen && securitySectionOpen && (
                <p
                  role="status"
                  className="mb-5 flex flex-wrap items-center gap-2 rounded-xl border border-warning bg-warning/10 px-4 py-3 text-sm"
                >
                  <Icon icon={SnowIcon} size={18} />
                  The wallet is frozen, so every transfer is refused until you unfreeze it.
                </p>
              )}
              {loading ? (
                <p className="py-20 text-center text-muted-foreground">Loading wallet…</p>
              ) : error ? (
                <EmptyState
                  title="Wallet unavailable"
                  detail={error}
                  action={<Button onClick={() => void refresh()}>Try again</Button>}
                />
              ) : accessClosed ? (
                <EmptyState
                  title="Wallet frozen"
                  detail="Every transfer is refused while the wallet is frozen. Nothing was taken: unfreeze it and the wallet works as before."
                  action={
                    <Link to="/security/freeze">
                      <Button variant="outline">
                        <Icon icon={SnowIcon} size={17} />
                        Open Freeze Wallet
                      </Button>
                    </Link>
                  }
                />
              ) : (
                children
              )}
            </div>
          </main>
        </div>
      </div>
    </WalletContext.Provider>
  );
}
