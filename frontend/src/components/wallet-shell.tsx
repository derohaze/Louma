import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Wallet01Icon,
  DashboardSquare01Icon,
  ArrowDown01Icon,
  ArrowRight01Icon,
  Home01Icon,
  TransactionHistoryIcon,
  Settings01Icon,
  SparklesIcon,
  Search01Icon,
  UserCircleIcon,
  Menu01Icon,
  LanguageCircleIcon,
  TrophyIcon,
  QrCodeIcon,
  SecurityCheckIcon,
  ArrowUpRight01Icon,
  ArrowDownLeft01Icon,
  Copy01Icon,
  Notification01Icon,
} from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
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
import { DEMO_USER_EMAIL, DEMO_USER_ID, readTransactions, readWallet } from "@/lib/demo-wallet";
import { currency } from "@/lib/wallet-format";
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

const navItems: {
  title: string;
  href:
    "/" | "/transfer" | "/wallet" | "/history" | "/custom-address" | "/leaderboard" | "/settings";
  icon: IconData;
}[] = [
  { title: "Overview", href: "/", icon: DashboardSquare01Icon },
  { title: "Transfer", href: "/transfer", icon: ArrowUpRight01Icon },
  { title: "Wallet", href: "/wallet", icon: Wallet01Icon },
  { title: "History", href: "/history", icon: TransactionHistoryIcon },
  { title: "Custom Address", href: "/custom-address", icon: QrCodeIcon },
  { title: "Leaderboard", href: "/leaderboard", icon: TrophyIcon },
  { title: "Settings", href: "/settings", icon: Settings01Icon },
];

export function WalletPage({ children, title }: { children: ReactNode; title: string }) {
  const [userId, setUserId] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [rtl, setRtl] = useState(false);
  const [workspaceOpen, setWorkspaceOpen] = useState(true);
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
    document.documentElement.dir = rtl ? "rtl" : "ltr";
    return () => {
      document.documentElement.dir = "ltr";
    };
  }, [rtl]);
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
  const sidebar = (
    <aside className="h-full w-[286px] shrink-0 overflow-y-auto bg-[#E9E9EC] px-3 py-4">
      <Button
        variant="ghost"
        onClick={() => setWorkspaceOpen((v) => !v)}
        aria-expanded={workspaceOpen}
        className="mb-1 h-11 w-full justify-start gap-3 rounded-xl px-4 text-sm font-semibold text-[#58585E] hover:bg-card/70"
      >
        <span>WALLET WORKSPACE</span>
        <Icon
          icon={ArrowDown01Icon}
          size={17}
          className={cn(
            "ms-auto transition-transform duration-500 ease-[cubic-bezier(0.4,0,0.2,1)]",
            !workspaceOpen && "-rotate-90",
          )}
        />
      </Button>
      <div
        className={cn(
          "grid transition-all duration-500 ease-[cubic-bezier(0.4,0,0.2,1)]",
          workspaceOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
        )}
      >
        <nav className="overflow-hidden">
          {navItems.map(({ title: label, href, icon }, index) => (
            <Link
              key={href}
              to={href}
              onClick={() => setMobileNavOpen(false)}
              tabIndex={workspaceOpen ? 0 : -1}
              style={{ transitionDelay: workspaceOpen ? `${index * 75}ms` : "0ms" }}
              className={cn(
                "mb-1 flex h-11 w-full items-center gap-3 rounded-xl px-4 text-sm font-semibold transition-all duration-500 ease-[cubic-bezier(0.4,0,0.2,1)]",
                workspaceOpen ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0",
                title === label
                  ? "bg-card text-[#323234] shadow-sm"
                  : "text-[#58585E] hover:bg-card/70 hover:text-[#323234]",
              )}
            >
              <Icon icon={icon} size={21} />
              <span>{label}</span>
              {title !== label && <Icon icon={ArrowRight01Icon} size={15} className="ms-auto" />}
            </Link>
          ))}
        </nav>
      </div>
    </aside>
  );
  return (
    <WalletContext.Provider value={value}>
      <div className="min-h-dvh bg-shell text-foreground">
        <header className="sticky top-0 z-50 flex h-[68px] items-center gap-4 bg-shell px-5 text-primary-foreground">
          <div className="flex w-[330px] items-center gap-5">
            <div className="grid size-10 place-items-center font-display text-xl font-bold">WL</div>
            <div className="hidden rounded-full border border-primary/70 bg-primary/35 px-4 py-2 text-xs font-semibold lg:block">
              Wallet workspace
            </div>
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
            <div
              aria-label="Agent"
              className="flex h-9 items-center gap-2 rounded-full border border-violet-400/60 bg-white/5 px-4 text-sm font-semibold text-primary-foreground"
            >
              <Icon icon={SparklesIcon} size={18} />
              Agent
            </div>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Search"
              onClick={() => setSearchOpen(true)}
              className="rounded-full border border-primary-foreground/15 text-primary-foreground hover:bg-primary/20 hover:text-primary-foreground"
            >
              <Icon icon={Search01Icon} />
            </Button>
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
                  <strong className="block font-display">Wallet account</strong>
                  <span className="text-xs font-normal text-muted-foreground">
                    {email ?? "Not signed in"}
                  </span>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => navigate({ to: "/wallet" })}>
                  <Icon icon={Wallet01Icon} />
                  Wallet
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => navigate({ to: "/settings" })}>
                  <Icon icon={SecurityCheckIcon} />
                  Security & settings
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={(e) => {
                    e.preventDefault();
                    setRtl(!rtl);
                  }}
                >
                  <Icon icon={LanguageCircleIcon} />
                  Direction<span className="ms-auto">{rtl ? "RTL" : "LTR"}</span>
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
          <aside className="hidden h-full w-[86px] shrink-0 overflow-y-auto border-e border-border bg-[#E9E9EC] md:flex md:flex-col">
            {[
              [Home01Icon, "Workspace", "/"],
              [Wallet01Icon, "Wallet", "/wallet"],
              [TransactionHistoryIcon, "History", "/history"],
              [ArrowDownLeft01Icon, "Transfers", "/transfer"],
              [Notification01Icon, "Activity", "/leaderboard"],
              [Settings01Icon, "Settings", "/settings"],
            ].map(([icon, label, href], index) => (
              <Link
                key={label as string}
                to={href as "/"}
                className={cn(
                  "flex min-h-[76px] flex-col items-center justify-center gap-1 text-[11px] font-semibold",
                  index === 0
                    ? "bg-background text-[#323234]"
                    : "text-[#58585E] hover:bg-background/70 hover:text-[#323234]",
                )}
              >
                <Icon icon={icon as IconData} size={21} />
                <span className="max-w-[74px] text-center leading-4">{label as string}</span>
              </Link>
            ))}
          </aside>
          <div className="hidden h-full shrink-0 bg-[#E9E9EC] lg:flex">{sidebar}</div>
          <div
            className={cn(
              "fixed inset-x-0 top-[68px] z-40 grid bg-shell/30 transition-all duration-500 ease-[cubic-bezier(0.4,0,0.2,1)] lg:hidden",
              mobileNavOpen
                ? "grid-rows-[1fr] opacity-100"
                : "pointer-events-none grid-rows-[0fr] opacity-0",
            )}
          >
            <div className="overflow-hidden">
              <div className="ms-auto max-h-[calc(100dvh-68px)] min-h-[calc(100dvh-68px)] w-[286px] overflow-y-auto bg-[#E9E9EC] shadow-xl">
                {sidebar}
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
                <Icon icon={Home01Icon} size={17} />
                <Icon icon={ArrowRight01Icon} size={15} />
                <span>Wallet Workspace</span>
                <Icon icon={ArrowRight01Icon} size={15} />
                <strong className="text-foreground">{title}</strong>
              </div>
              {loading ? (
                <p className="py-20 text-center text-muted-foreground">Loading wallet…</p>
              ) : error ? (
                <EmptyState
                  title="Wallet unavailable"
                  detail={error}
                  action={<Button onClick={() => void refresh()}>Try again</Button>}
                />
              ) : (
                children
              )}
            </div>
          </main>
        </div>
      </div>
      <Dialog open={searchOpen} onOpenChange={setSearchOpen}>
        <DialogContent className="top-[10%] max-w-3xl translate-y-0 rounded-[22px] p-5">
          <DialogTitle className="sr-only">Search wallet</DialogTitle>
          <DialogDescription className="sr-only">
            Find wallet pages and transactions
          </DialogDescription>
          <div className="flex h-14 items-center gap-3 rounded-xl border-2 border-primary px-4">
            <Icon icon={Search01Icon} />
            <Input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="flex-1 border-0 shadow-none"
              placeholder="Search pages and transactions"
            />
            <kbd className="rounded-md bg-secondary px-2 py-1 text-xs">Ctrl K</kbd>
          </div>
          <div className="py-4">
            <p className="mb-2 text-sm font-semibold">Pages</p>
            {navItems
              .filter((item) => item.title.toLowerCase().includes(search.toLowerCase()))
              .map((item) => (
                <Button
                  key={item.href}
                  variant="ghost"
                  className="h-12 w-full justify-start gap-4 rounded-xl"
                  onClick={() => {
                    setSearchOpen(false);
                    navigate({ to: item.href });
                  }}
                >
                  <Icon icon={item.icon} />
                  {item.title}
                  <Icon icon={ArrowRight01Icon} size={16} className="ms-auto" />
                </Button>
              ))}
            {search &&
              transactions
                .filter((tx) =>
                  `${tx.counterparty_address} ${tx.note}`
                    .toLowerCase()
                    .includes(search.toLowerCase()),
                )
                .slice(0, 4)
                .map((tx) => (
                  <Button
                    key={tx.id}
                    variant="ghost"
                    className="w-full justify-start"
                    onClick={() => {
                      setSearchOpen(false);
                      navigate({ to: "/history" });
                    }}
                  >
                    {tx.counterparty_address} · {currency(tx.amount)}
                  </Button>
                ))}
          </div>
        </DialogContent>
      </Dialog>
    </WalletContext.Provider>
  );
}
