import { useProAccess } from "@/shared/hooks";
import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useIsFetching } from "@tanstack/react-query";
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
  SecurityCheckIcon,
  Logout01Icon,
  CreditCardIcon,
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
import {
  RouteLoadingContext,
  useIsomorphicLayoutEffect,
  useTheme,
  useWallet,
} from "@/shared/hooks";
import { messageForError } from "@/shared/api";
import { translate, useI18n, useT, type TranslationPath } from "@/shared/i18n";
import { LanguageMenu } from "@/app/shell/language-menu";
import { WalletProvider } from "@/app/session";
import { WalletNotifications } from "@/features/notifications";
import { Switch } from "@/shared/ui/switch";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/shared/ui/tooltip";
import { cn } from "@/shared/lib/platform";
import { findActiveSection, type NavHref } from "@/shared/lib/wallet";
import { LIMITS, serverStateKeys } from "@/shared/lib/platform";
import { currency, loadLocalNote, transactionDateText } from "@/shared/lib/wallet";
import { EmptyState, Icon } from "@/shared/ui/page";
import { PageDataLoader } from "@/shared/ui/page-data-loader";
import { MobileMoreSheet, MobileTabBar, PrimaryRail, SidebarNav } from "@/app/shell/shell-nav";
import { useDeveloperAccess } from "@/shared/hooks/use-developer-access";
import {
  buildSearchPages,
  searchPageLimit,
  searchRank,
  searchTransactionLimit,
  type SearchEntry,
} from "@/app/shell/shell-search";

/** Every authenticated wallet page shares this data gate, loader, and application chrome. */
export function WalletPage({
  children,
  titleKey,
}: {
  children: ReactNode;
  /**
   * The page's name, as a translation key rather than as text: the shell is rendered before a route
   * can know the language, and the breadcrumb, browser tab, and loader label all use the language
   * current at paint time.
   */
  titleKey: TranslationPath;
}) {
  return (
    <WalletProvider>
      <WalletShell titleKey={titleKey}>{children}</WalletShell>
    </WalletProvider>
  );
}

/**
 * The shell keeps route content hidden until every active account read and page-specific request
 * completes. The child route still mounts behind the loader, so its queries start together and the
 * page never appears in pieces as individual requests finish.
 */
function WalletShell({ children, titleKey }: { children: ReactNode; titleKey: TranslationPath }) {
  const { user, userId, wallet, transactions, security, loading, error, refresh, signOut } =
    useWallet();
  const { isDark, toggle } = useTheme();
  /** Both hooks subscribe to the language, so a switch re-renders the whole chrome at once. */
  const t = useT("shell");
  const common = useT("common");
  const { language } = useI18n();
  const title = translate(titleKey);
  const activeSectionTitle = (section: { titleKey: TranslationPath } | undefined) =>
    section ? translate(section.titleKey) : "";
  const [moreOpen, setMoreOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState("");
  const navigate = useNavigate();
  const location = useLocation();
  const mainRef = useRef<HTMLElement | null>(null);
  const currentPathRef = useRef(location.pathname);
  currentPathRef.current = location.pathname;
  const [readyPath, setReadyPath] = useState<string | null>(null);
  const [reportedLoads, setReportedLoads] = useState<{ pathname: string; ids: Set<string> }>({
    pathname: location.pathname,
    ids: new Set(),
  });
  const reportRouteLoad = useMemo(
    () => (pathname: string, id: string, pending: boolean) => {
      if (currentPathRef.current !== pathname) return;
      setReportedLoads((current) => {
        const ids = new Set(current.pathname === pathname ? current.ids : []);
        const wasPending = ids.has(id);
        if (pending) ids.add(id);
        else ids.delete(id);
        if (current.pathname === pathname && wasPending === pending) return current;
        return { pathname, ids };
      });
    },
    [],
  );
  const routeLoadingContext = useMemo(
    () => ({ pathname: location.pathname, report: reportRouteLoad }),
    [location.pathname, reportRouteLoad],
  );
  const routeQueryCount = useIsFetching({
    type: "active",
    predicate: (query) =>
      query.state.data === undefined &&
      (query.queryKey[0] === serverStateKeys.account[0] ||
        (location.pathname.startsWith("/notifications") &&
          query.queryKey[0] === serverStateKeys.notifications[0])),
  });
  const routeLoadsPending =
    reportedLoads.pathname === location.pathname && reportedLoads.ids.size > 0;
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
  const routeDataPending = routeQueryCount > 0 || routeLoadsPending;
  const pageLoading = readyPath !== location.pathname || routeDataPending;

  useIsomorphicLayoutEffect(() => {
    if (
      loading ||
      !sessionConfirmed ||
      error ||
      accessClosed ||
      routeQueryCount > 0 ||
      routeLoadsPending
    )
      return;
    setReadyPath(location.pathname);
  }, [
    accessClosed,
    error,
    loading,
    location.pathname,
    routeLoadsPending,
    routeQueryCount,
    sessionConfirmed,
  ]);
  /**
   * With no query the panel is a quick launcher, so it lists the most used pages instead of all of
   * them. Transactions join the list as soon as the owner types.
   */
  const query = search.trim().toLowerCase();
  const browsing = query.length === 0;
  const pro = useProAccess();
  const developer = useDeveloperAccess().data?.eligible === true;
  const searchPages = useMemo(
    () => buildSearchPages(language, pro, developer),
    [language, pro, developer],
  );
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
          // Both notes are searched, the same way the transactions page searches them: the one on
          // record and the personal one this device holds.
          `${tx.counterpartyAddress} ${tx.note} ${loadLocalNote(userId, tx.transferId)} ${tx.transferId}`
            .toLowerCase()
            .includes(query),
        )
        .slice(0, searchTransactionLimit)
        .map((tx) => ({
          id: `tx:${tx.id}`,
          title: tx.counterpartyAddress,
          subtitle: `${tx.direction === "sent" ? common("direction.sent") : common("direction.received")} · ${currency(tx.amount)} · ${transactionDateText(tx.createdAt)}`,
          icon: tx.direction === "sent" ? ArrowUpRight01Icon : ArrowDownLeft01Icon,
          href: "/transactions" as const,
        }));
  const results: SearchEntry[] = [...pageResults, ...transactionResults];
  const resultsHeading = browsing ? t("search.mostUsed") : t("search.results");
  /** Every row leaves the dialog in the same state, so the next opening starts clean. */
  const openResult = (href: NavHref) => {
    setSearchOpen(false);
    setSearch("");
    void navigate({ to: href });
  };
  const closeMore = () => setMoreOpen(false);
  // The chrome stays in place while the page body waits for its complete data set.
  return (
    <div suppressHydrationWarning className="min-h-dvh bg-shell text-foreground">
      <header className="sticky top-0 z-50 flex h-[68px] items-center gap-2 bg-shell px-3 text-primary-foreground sm:gap-4 sm:px-5 dark:text-white">
        {/*
         * Sized for the phone first: a 64px mark and a 330px column only fit a desktop bar, so on a
         * narrow screen the mark shrinks and the name is allowed to truncate instead of pushing the
         * header's actions off the edge.
         */}
        <div className="flex min-w-0 items-center gap-2.5 md:w-[330px] md:gap-3">
          <img
            src="/Louma_Brand_logos/png/louma-logo-256x256.png"
            alt={t("header.logoAlt")}
            width={64}
            height={64}
            draggable={false}
            className="size-11 shrink-0 border-0 bg-transparent object-contain shadow-none outline-none md:size-16"
          />
          <span className="truncate font-display text-lg font-semibold tracking-tight md:text-xl">
            {t("header.brand")}
          </span>
        </div>
        <div className="ms-auto flex shrink-0 items-center gap-2 sm:gap-3">
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
                aria-label={t("header.searchAria")}
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
              collisionPadding={12}
              avoidCollisions
              aria-label={t("search.dialogAria")}
              className="w-[min(800px,calc(100vw-1.5rem))] gap-0 overflow-hidden rounded-[30px] border border-border/80 bg-card p-0 shadow-xl shadow-primary/10"
            >
              <div className="p-2.5 sm:p-3">
                <div className="flex h-[52px] items-center gap-2.5 rounded-[18px] border bg-card px-3.5 shadow-sm sm:px-4">
                  <Icon icon={Search01Icon} size={19} className="shrink-0 text-muted-foreground" />
                  <Input
                    autoFocus
                    aria-label={t("header.searchAria")}
                    maxLength={LIMITS.maxSearchLength}
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder={t("search.placeholder")}
                    className="h-auto flex-1 border-0 bg-transparent p-0 ps-2 text-sm shadow-none focus-visible:ring-0"
                  />
                  <span className="hidden shrink-0 items-center gap-1.5 sm:flex">
                    <kbd className="rounded-lg border bg-secondary px-2 py-1 text-[11px] font-semibold text-muted-foreground">
                      Ctrl
                    </kbd>
                    <kbd className="rounded-lg border bg-secondary px-2 py-1 text-[11px] font-semibold text-muted-foreground">
                      K
                    </kbd>
                  </span>
                </div>
              </div>
              <div className="max-h-[42vh] min-h-[230px] overflow-y-auto px-2.5 pb-2.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:px-3">
                <p className="px-2 py-2.5 text-xs font-semibold tracking-wide text-muted-foreground">
                  {resultsHeading}
                </p>
                {results.length ? (
                  results.map((entry) => (
                    <button
                      key={entry.id}
                      type="button"
                      onClick={() => openResult(entry.href)}
                      className="flex w-full cursor-pointer items-center gap-3 rounded-[18px] px-2.5 py-2 text-start transition-colors hover:bg-secondary/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-inset"
                    >
                      <span className="grid size-10 shrink-0 place-items-center rounded-[13px] bg-secondary/80">
                        <Icon icon={entry.icon} size={19} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold">{entry.title}</span>
                        <span className="block truncate text-[11px] text-muted-foreground">
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
                    {t("search.noMatches", { query: search.trim() })}
                  </p>
                )}
              </div>
              <div className="flex items-center justify-between gap-3 border-t bg-secondary/30 px-3.5 py-2.5 sm:px-4">
                <p className="text-xs text-muted-foreground sm:text-sm">{t("search.cantFind")}</p>
                <Button
                  className="h-9 shrink-0 rounded-xl px-4 text-sm"
                  onClick={() => openResult("/transfer")}
                >
                  <Icon icon={ArrowUpRight01Icon} size={18} />
                  {t("search.newTransfer")}
                </Button>
              </div>
            </PopoverContent>
          </Popover>
          <TooltipProvider delayDuration={300}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  asChild
                  variant="ghost"
                  size="icon"
                  aria-label={t("header.billingAria")}
                  className="rounded-full border border-primary-foreground/10 text-primary-foreground hover:bg-primary/20 hover:text-primary-foreground dark:border-white/10 dark:text-white dark:hover:bg-white/10 dark:hover:text-white"
                >
                  <Link to="/billing">
                    <Icon icon={CreditCardIcon} />
                  </Link>
                </Button>
              </TooltipTrigger>
              <TooltipContent
                side="bottom"
                sideOffset={10}
                className="rounded-xl border border-primary/10 bg-card px-3.5 py-2 text-xs font-semibold text-foreground shadow-lg"
              >
                {t("header.billingAria")}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <WalletNotifications />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label={t("header.accountMenuAria")}
                className="rounded-full border border-primary-foreground/10 text-primary-foreground hover:bg-primary/20 hover:text-primary-foreground dark:border-white/10 dark:text-white dark:hover:bg-white/10 dark:hover:text-white"
              >
                <Icon icon={UserCircleIcon} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              sideOffset={8}
              collisionPadding={12}
              avoidCollisions
              className="w-[min(18rem,calc(100vw-2rem))] rounded-[20px] p-3"
            >
              <DropdownMenuLabel className="min-w-0 max-w-full overflow-hidden">
                <strong className="block truncate font-display">
                  {user?.displayName ?? t("menu.fallbackName")}
                </strong>
                <span className="block truncate text-xs font-normal text-muted-foreground">
                  {user?.email ?? t("menu.notSignedIn")}
                </span>
                <span className="mt-2 inline-flex rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
                  {translate(pro ? "common.state.pro" : "common.state.free")}
                </span>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => void navigate({ to: "/profile" })}>
                <Icon icon={UserCircleIcon} />
                {t("menu.profile")}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void navigate({ to: "/security" })}>
                <Icon icon={SecurityCheckIcon} />
                {t("menu.security")}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void navigate({ to: "/settings" })}>
                <Icon icon={Settings01Icon} />
                {t("menu.settings")}
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
                  {t("menu.darkMode")}
                </span>
                <Switch
                  checked={isDark}
                  onCheckedChange={toggle}
                  aria-label={t("menu.darkMode")}
                  onClick={(event) => event.stopPropagation()}
                />
              </DropdownMenuItem>
              {/* The language switch sits with the theme switch: both are choices about this
                  device, and both are made from the account menu. */}
              <LanguageMenu />
              <DropdownMenuSeparator />
              {/* A logout the API did not confirm leaves this tab signed in, because the refresh
                  cookie that keeps the session alive is the server's to clear: saying otherwise
                  would only send the sign-in page, which redirects a signed-in visitor, straight
                  back into the wallet. The failure is reported and the session is left usable. */}
              <DropdownMenuItem
                onSelect={() =>
                  void signOut().catch((cause: unknown) =>
                    toast.error(t("menu.signOutFailedTitle"), {
                      description: t("menu.signOutFailedDetail", {
                        reason: messageForError(cause),
                      }),
                    }),
                  )
                }
              >
                <Icon icon={Logout01Icon} />
                {t("menu.logOut")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>
      {/*
       * The shell is exactly one viewport tall, so the page itself never scrolls and the
       * rounded top corners of the surface stay put. Only <main> scrolls (see below).
       * `bg-shell` (not `bg-panel`): the surface background is only visible through those
       * corners, and it must match the dark shell for the arcs to read as curves.
       */}
      <div className="app-surface flex h-[calc(100dvh-68px-65px-env(safe-area-inset-bottom))] bg-shell lg:h-[calc(100dvh-68px)]">
        {/*
         * The rail and the panel are the desktop navigation. Both start at `lg`: below it the
         * phone's tab bar is the only navigation, so a tablet is not asked to use a 72px icon
         * column next to a bar that already covers the same sections.
         */}
        <aside className="hidden h-full w-[72px] shrink-0 overflow-x-hidden overflow-y-auto border-e border-border bg-[#E9E9EC] lg:flex lg:flex-col dark:bg-card">
          <PrimaryRail activeSection={activeSection} />
        </aside>
        <div className="hidden h-full shrink-0 bg-[#E9E9EC] lg:flex dark:bg-card">
          <SidebarNav pathname={location.pathname} scope="section" onNavigate={closeMore} />
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
          {/*
           * The shell reserves the mobile tab bar below this scroll area, so the page's normal
           * padding stays visible above it; the desktop shell has no bar and uses wider padding.
           */}
          <div
            key={location.pathname}
            className="route-view-enter relative mx-auto max-w-[1380px] p-4 sm:p-5 lg:p-8"
          >
            <div className="mb-5 flex min-w-0 flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <Icon icon={Home04Icon} size={17} />
              {activeSection && activeSectionTitle(activeSection) !== title && (
                <>
                  <Icon icon={ArrowRight01Icon} size={15} />
                  <span>{activeSectionTitle(activeSection)}</span>
                </>
              )}
              <Icon icon={ArrowRight01Icon} size={15} />
              <strong className="min-w-0 flex-1 truncate text-foreground">{title}</strong>
            </div>
            {walletFrozen && securitySectionOpen && (
              <p
                role="status"
                className="mb-5 flex flex-wrap items-center gap-2 rounded-xl border border-warning bg-warning/10 px-4 py-3 text-sm"
              >
                <Icon icon={SnowIcon} size={18} />
                {t("notice.frozen")}
              </p>
            )}
            {error && !sessionConfirmed ? (
              <EmptyState
                title={t("error.unavailable")}
                detail={error}
                action={
                  <Button onClick={() => void refresh().catch(() => undefined)}>
                    {t("error.tryAgain")}
                  </Button>
                }
              />
            ) : loading || !sessionConfirmed ? (
              <PageDataLoader title={title} />
            ) : error ? (
              <EmptyState
                title={t("error.unavailable")}
                detail={error}
                action={
                  // This screen is the error report: a retry that fails again updates the query's own
                  // error, which is what re-renders this state.
                  <Button onClick={() => void refresh().catch(() => undefined)}>
                    {t("error.tryAgain")}
                  </Button>
                }
              />
            ) : accessClosed ? (
              <EmptyState
                title={t("error.frozenTitle")}
                detail={t("error.frozenDetail")}
                action={
                  <Link to="/security/freeze">
                    <Button variant="outline">
                      <Icon icon={SnowIcon} size={17} />
                      {t("error.openFreeze")}
                    </Button>
                  </Link>
                }
              />
            ) : (
              <div className="relative">
                <RouteLoadingContext.Provider value={routeLoadingContext}>
                  <div
                    aria-hidden={pageLoading}
                    className={cn(pageLoading && "invisible pointer-events-none select-none")}
                  >
                    {children}
                  </div>
                </RouteLoadingContext.Provider>
                {pageLoading && (
                  <PageDataLoader title={title} className="page-data-loader-overlay" />
                )}
              </div>
            )}
          </div>
        </main>
      </div>
      {/*
       * The phone's navigation lives outside the shell's viewport-height box: it is fixed to the
       * bottom of the screen, so it stays put while <main> scrolls, exactly as the desktop rail
       * stays put beside it.
       */}
      <MobileTabBar
        pathname={location.pathname}
        moreOpen={moreOpen}
        onOpenMore={() => setMoreOpen(true)}
      />
      <MobileMoreSheet open={moreOpen} onOpenChange={setMoreOpen} pathname={location.pathname} />
    </div>
  );
}
