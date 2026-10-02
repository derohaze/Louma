import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowRight01Icon,
  ArrowDownLeft01Icon,
  ArrowUpRight01Icon,
  Home04Icon,
  Settings01Icon,
  Moon02Icon,
  SnowIcon,
  Search01Icon,
  UserCircleIcon,
  Menu01Icon,
  SecurityCheckIcon,
  Logout01Icon,
} from "@hugeicons/core-free-icons";
import { toast } from "sonner";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import { useWallet } from "@/shared/hooks";
import { useTheme } from "@/shared/hooks";
import { messageForError } from "@/shared/api";
import { WalletProvider } from "@/app/session";
import { WalletNotifications } from "@/features/notifications";
import { skeletonForPath } from "@/shared/skeletons";
import { Switch } from "@/shared/ui/switch";
import { cn } from "@/shared/lib/platform";
import { findActiveSection, navSections, type NavHref } from "@/shared/lib/wallet";
import { LIMITS } from "@/shared/lib/platform";
import { currency, dateText } from "@/shared/lib/wallet";
import { EmptyState, Icon } from "@/shared/ui/page";
import { RailLink, SidebarNav } from "@/app/shell/shell-nav";
import {
  searchPageLimit,
  searchPages,
  searchRank,
  searchTransactionLimit,
  type SearchEntry,
} from "@/app/shell/shell-search";

/**
 * Every wallet page renders inside this shell. The provider loads the account, the wallet, the
 * first page of transactions, and the security overview from the API; the shell then gates the
 * content on that state, so no page ever renders a number the server has not confirmed. A page the
 * tab has already visited reopens from its cached snapshot, so the skeleton below is what a first
 * visit (or a hard reload) shows, not what every click does.
 */
export function WalletPage({ children, title }: { children: ReactNode; title: string }) {
  return (
    <WalletProvider>
      <WalletShell title={title}>{children}</WalletShell>
    </WalletProvider>
  );
}

/**
 * The shell gates every page on the shared account load, and the loading state mirrors the page
 * behind it: `skeletonForPath()` resolves by the current route path (exact → section prefix →
 * title → generic), so renames can't break it, sub-pages inherit their section's shape
 * automatically, and unknown paths fall back loudly (dev warn + `check:skeletons` failure).
 * A new page only has to register its path in shared/skeletons — the shell needs no change.
 */
function WalletShell({ children, title }: { children: ReactNode; title: string }) {
  const { user, wallet, transactions, security, loading, error, refresh, signOut } = useWallet();
  const { isDark, toggle } = useTheme();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState("");
  const navigate = useNavigate();
  const location = useLocation();
  const mainRef = useRef<HTMLElement | null>(null);
  // <main> is the app shell's scroll container, so the router's window-based scroll
  // restoration cannot reset it: do it here whenever the route changes.
  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0 });
  }, [location.pathname]);
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
  const activeSection = findActiveSection(location.pathname);
  /**
   * Read from the security overview rather than kept in the frontend: the backend refuses transfers
   * on a frozen wallet, and the UI follows the same flag so the two can never disagree.
   */
  const walletFrozen = security?.wallet.status === "frozen";
  /**
   * Security pages stay reachable while the wallet is frozen: whoever froze it has to be able to
   * unfreeze it from the same device. Everything else waits.
   */
  const securitySectionOpen = location.pathname.startsWith("/security");
  const accessClosed = walletFrozen && !securitySectionOpen;
  /**
   * The fail-closed gate: the account object only ever comes from an API answer, so a non-null user
   * means this load has positively confirmed a session. Until then — a fresh visit, or the backend
   * being unreachable — no page content is rendered, whatever a previous tab left in the cache. The
   * wallet snapshot deliberately does not seed the profile (see server-state), so an unauthenticated
   * visitor can never open a dashboard on the strength of old data.
   */
  const sessionConfirmed = user !== null;
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
          `${tx.counterpartyAddress} ${tx.note} ${tx.transferId}`.toLowerCase().includes(query),
        )
        .slice(0, searchTransactionLimit)
        .map((tx) => ({
          id: `tx:${tx.id}`,
          title: tx.counterpartyAddress,
          subtitle: `${tx.direction === "sent" ? "Sent" : "Received"} · ${currency(tx.amount)} · ${dateText(tx.createdAt)}`,
          icon: tx.direction === "sent" ? ArrowUpRight01Icon : ArrowDownLeft01Icon,
          href: "/transactions" as const,
        }));
  const results: SearchEntry[] = [...pageResults, ...transactionResults];
  const resultsHeading = browsing ? "Most used" : "Results";
  /** Every row leaves the dialog in the same state, so the next opening starts clean. */
  const openResult = (href: NavHref) => {
    setSearchOpen(false);
    setSearch("");
    void navigate({ to: href });
  };
  const closeMobileNav = () => setMobileNavOpen(false);
  // The chrome — header, rail, navigation — renders from data the app already has, so it is painted
  // at once and only the page body waits (see PageSkeleton).
  return (
    <div suppressHydrationWarning className="min-h-dvh bg-shell text-foreground">
      <header className="sticky top-0 z-50 flex h-[68px] items-center gap-4 bg-shell px-5 text-primary-foreground dark:text-white">
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
                className="rounded-full border border-primary-foreground/10 text-primary-foreground hover:bg-primary/20 hover:text-primary-foreground dark:border-white/10 dark:text-white dark:hover:bg-white/10 dark:hover:text-white"
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
                  <Icon icon={Search01Icon} size={20} className="shrink-0 text-muted-foreground" />
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
                <Button className="h-10 rounded-full px-5" onClick={() => openResult("/transfer")}>
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
                className="rounded-full border border-primary-foreground/10 text-primary-foreground hover:bg-primary/20 hover:text-primary-foreground dark:border-white/10 dark:text-white dark:hover:bg-white/10 dark:hover:text-white"
              >
                <Icon icon={UserCircleIcon} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-72 rounded-[20px] p-3">
              <DropdownMenuLabel>
                <strong className="block font-display">
                  {user?.displayName ?? "Louma wallet"}
                </strong>
                <span className="text-xs font-normal text-muted-foreground">
                  {user?.email ?? "Not signed in"}
                </span>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => void navigate({ to: "/profile" })}>
                <Icon icon={UserCircleIcon} />
                Profile
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void navigate({ to: "/security" })}>
                <Icon icon={SecurityCheckIcon} />
                Security
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void navigate({ to: "/settings" })}>
                <Icon icon={Settings01Icon} />
                Settings
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={(event) => {
                  event.preventDefault();
                  toggle();
                }}
                className="justify-between"
              >
                <span className="flex items-center gap-2">
                  <Icon icon={Moon02Icon} />
                  Dark mode
                </span>
                <Switch
                  checked={isDark}
                  onCheckedChange={toggle}
                  aria-label="Dark mode"
                  onClick={(event) => event.stopPropagation()}
                />
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {/* A logout the API did not confirm leaves this tab signed in, because the refresh
                  cookie that keeps the session alive is the server's to clear: saying otherwise
                  would only send the sign-in page, which redirects a signed-in visitor, straight
                  back into the wallet. The failure is reported and the session is left usable. */}
              <DropdownMenuItem
                onSelect={() =>
                  void signOut().catch((cause: unknown) =>
                    toast.error("Sign-out was not confirmed", {
                      description: `${messageForError(cause)} The session on this device may still be active. Try again.`,
                    }),
                  )
                }
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
            className="rounded-full border border-primary-foreground/10 text-primary-foreground hover:bg-primary/20 hover:text-primary-foreground lg:hidden dark:border-white/10 dark:text-white dark:hover:bg-white/10 dark:hover:text-white"
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
        <aside className="hidden h-full w-[72px] shrink-0 overflow-x-hidden overflow-y-auto border-e border-border bg-[#E9E9EC] md:flex md:flex-col dark:bg-card">
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
        <div className="hidden h-full shrink-0 bg-[#E9E9EC] lg:flex dark:bg-card">
          <SidebarNav pathname={location.pathname} scope="section" onNavigate={closeMobileNav} />
        </div>
        <div
          className={cn(
            "fixed inset-x-0 top-[68px] z-40 grid bg-shell/30 transition-all duration-500 ease-[cubic-bezier(0.4,0,0.2,1)] lg:hidden",
            mobileNavOpen
              ? "grid-rows-[1fr] opacity-100"
              : "pointer-events-none grid-rows-[0fr] opacity-0",
          )}
        >
          <div className="overflow-hidden">
            <div className="ms-auto max-h-[calc(100dvh-68px)] min-h-[calc(100dvh-68px)] w-[228px] overflow-x-hidden overflow-y-auto bg-[#E9E9EC] shadow-xl dark:bg-card">
              <SidebarNav pathname={location.pathname} scope="all" onNavigate={closeMobileNav} />
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
          className="relative min-w-0 flex-1 overflow-x-hidden overflow-y-auto bg-[#F5F5F6] [scrollbar-width:none] rounded-se-(--app-corner-size) max-md:rounded-ss-(--app-corner-size) dark:bg-background [&::-webkit-scrollbar]:hidden"
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
            {error && !sessionConfirmed ? (
              <EmptyState
                title="Wallet unavailable"
                detail={error}
                action={<Button onClick={() => void refresh().catch(() => undefined)}>Try again</Button>}
              />
            ) : loading || !sessionConfirmed ? (
              (() => {
                const PageSkeleton = skeletonForPath(location.pathname, title);
                return <PageSkeleton title={title} />;
              })()
            ) : error ? (
              <EmptyState
                title="Wallet unavailable"
                detail={error}
                action={
                  // This screen is the error report: a retry that fails again updates the query's own
                  // error, which is what re-renders this state.
                  <Button onClick={() => void refresh().catch(() => undefined)}>Try again</Button>
                }
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
  );
}
