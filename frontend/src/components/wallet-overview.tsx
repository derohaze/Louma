import { Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  ArrowUpRight01Icon,
  ArrowDownLeft01Icon,
  TransactionHistoryIcon,
  ArrowRight01Icon,
  ViewIcon,
  ViewOffIcon,
} from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import { useWallet } from "@/hooks/wallet-context";
import { currency, dateText, moneyChartValue, sumMoney } from "@/lib/wallet-format";
import { CopyButton, EmptyState, Icon, PageHeader } from "./wallet-shell";

/**
 * Local-only preference: whether the balance amounts are masked on this device.
 * Never leaves the browser (no API call, no account field) — each device keeps its own choice.
 */
const BALANCE_HIDDEN_KEY = "louma-balance-hidden";

function readBalanceHidden(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(BALANCE_HIDDEN_KEY) === "1";
  } catch {
    return false;
  }
}

function Count({ value, suffix = "" }: { value: number; suffix?: string }) {
  const formatted = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: suffix ? 2 : 0,
    maximumFractionDigits: suffix ? 2 : 0,
  }).format(value);
  const chars = formatted.split("");
  return (
    <>
      {/*
       * Number pop-in transition (transitions.dev "Number pop-in"):
       * every character rises with blur and the last two ride in with
       * stagger. `key` remounts the group whenever the value changes, which
       * replays the enter animation — the declarative equivalent of the
       * snippet's remove-class → swap digits → reflow → re-add-class replay.
       * The suffix (" LMA") stays static outside the digit group.
       */}
      <span key={formatted} className="t-digit-group is-animating">
        {chars.map((ch, i) => (
          <span
            key={i}
            className="t-digit"
            data-stagger={i === chars.length - 2 ? "1" : i === chars.length - 1 ? "2" : undefined}
          >
            {ch}
          </span>
        ))}
      </span>
      {suffix}
    </>
  );
}

type OverviewMetric = {
  icon: Parameters<typeof Icon>[0]["icon"];
  label: string;
  /** Money is already a formatted decimal string; counts stay numbers for the digit animation. */
  money?: string;
  count?: number;
  hint: string;
  href: "/wallet" | "/history";
};

export function OverviewContent() {
  const { wallet, transactions } = useWallet();
  const [balanceHidden, setBalanceHidden] = useState(readBalanceHidden);
  const toggleBalanceHidden = () => {
    setBalanceHidden((current) => {
      const next = !current;
      try {
        window.localStorage.setItem(BALANCE_HIDDEN_KEY, next ? "1" : "0");
      } catch {
        // Private mode: the toggle still works for this visit, it just won't persist.
      }
      return next;
    });
  };

  const received = transactions.filter((t) => t.direction === "received");
  const sent = transactions.filter((t) => t.direction === "sent");
  /**
   * Each side totals what actually moved for this wallet: the sender is debited the full amount,
   * while a received transfer credits the net amount (the network tax is taken out of it). Summing
   * `amount` on both sides would report a balance that never existed.
   */
  const totalIn = sumMoney(received.map((t) => t.netAmount));
  const totalOut = sumMoney(sent.map((t) => t.amount));
  const chart = useMemo(() => {
    const days = Array.from({ length: 7 }, (_, i) => {
      const date = new Date();
      date.setHours(0, 0, 0, 0);
      date.setDate(date.getDate() - (6 - i));
      return date;
    });
    return days.map((date) => {
      const daily = transactions.filter(
        (t) => new Date(t.createdAt).toDateString() === date.toDateString(),
      );
      return {
        day: date.toLocaleDateString("en-US", { weekday: "short" }),
        // Summed in integer minor units, then converted once for the chart coordinate.
        received: moneyChartValue(
          sumMoney(daily.filter((t) => t.direction === "received").map((t) => t.netAmount)),
        ),
        sent: moneyChartValue(
          sumMoney(daily.filter((t) => t.direction === "sent").map((t) => t.amount)),
        ),
      };
    });
  }, [transactions]);
  const mask = (value: string) => (balanceHidden ? "••••••" : value);
  const metrics: OverviewMetric[] = [
    {
      icon: ArrowDownLeft01Icon,
      label: "Total Received",
      money: mask(currency(totalIn)),
      hint: "Net of the network tax, in the loaded history",
      href: "/history",
    },
    {
      icon: ArrowUpRight01Icon,
      label: "Total Sent",
      money: mask(currency(totalOut)),
      hint: "Outgoing transfers in the loaded history",
      href: "/history",
    },
    {
      icon: TransactionHistoryIcon,
      label: "Transactions",
      count: transactions.length,
      hint: "Search and filter transactions",
      href: "/history",
    },
  ];
  const frozen = wallet?.status === "frozen";
  return (
    <>
      <PageHeader
        title="Overview"
        subtitle="Balance and activity at a glance, with a link into every section."
        action={
          <Link to="/transfer">
            <Button>
              <Icon icon={ArrowUpRight01Icon} size={17} />
              Transfer funds
            </Button>
          </Link>
        }
      />
      {/* Hero balance card: deep aurora surface in both themes, coin mark, quick actions. */}
      <section className="relative animate-fade-in overflow-hidden rounded-[28px] bg-[linear-gradient(135deg,#0B1526_0%,#1B2A52_55%,#120D22_100%)] p-6 shadow-lg sm:p-8 dark:bg-[linear-gradient(135deg,#000000_0%,#1A1033_60%,#0B1526_100%)]">
        <div
          aria-hidden
          className="absolute -top-24 end-[10%] size-[300px] rounded-full bg-[#7C5CFF]/30 blur-[100px]"
        />
        <div
          aria-hidden
          className="absolute bottom-[-40%] start-[30%] size-[280px] rounded-full bg-[#2DD4BF]/20 blur-[100px]"
        />
        <div
          aria-hidden
          className="absolute inset-0 opacity-50 [background-image:radial-gradient(rgba(255,255,255,0.12)_1px,transparent_1px)] [background-size:12px_12px] [mask-image:radial-gradient(ellipse_at_center,black,transparent_80%)]"
        />
        <div className="relative flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-[11px] font-semibold tracking-wide text-white/70 uppercase">
                Available Balance
              </span>
              <button
                type="button"
                onClick={toggleBalanceHidden}
                aria-pressed={balanceHidden}
                aria-label={balanceHidden ? "Show balance" : "Hide balance"}
                title={balanceHidden ? "Show balance" : "Hide balance"}
                className="grid size-8 cursor-pointer place-items-center rounded-full border border-white/15 bg-white/5 text-white/70 transition-colors hover:bg-white/10 hover:text-white"
              >
                <Icon icon={balanceHidden ? ViewOffIcon : ViewIcon} size={16} />
              </button>
            </div>
            <p className="mt-3 font-display text-4xl font-bold tabular-nums text-white sm:text-5xl">
              {mask(currency(wallet?.balance ?? "0"))}
            </p>
            <p className="mt-2 text-sm text-white/60">
              {transactions.length} recorded transactions
            </p>
            {wallet?.address && (
              <div className="mt-4 flex w-full max-w-[300px] items-center gap-2 rounded-xl border border-white/15 bg-black/25 px-3 py-2 text-white">
                <code className="min-w-0 flex-1 truncate text-xs text-white/80">
                  {wallet.address}
                </code>
                <CopyButton text={wallet.address} />
                {frozen && (
                  <span className="shrink-0 rounded-full bg-warning/20 px-2.5 py-0.5 text-[11px] font-semibold text-amber-300">
                    Frozen
                  </span>
                )}
              </div>
            )}
          </div>
          <div aria-hidden className="relative hidden shrink-0 sm:block">
            <div className="absolute inset-0 scale-125 rounded-full bg-[radial-gradient(circle,rgba(124,92,255,0.45)_0%,transparent_70%)] blur-2xl" />
            <img
              src="/Louma_Brand_logos/png/louma-logo-256x256.png"
              alt=""
              width={160}
              height={160}
              draggable={false}
              className="relative size-36 border-0 bg-transparent object-contain shadow-none drop-shadow-[0_18px_50px_rgba(0,0,0,0.55)] lg:size-40"
            />
          </div>
        </div>
        <div className="relative mt-6 flex flex-wrap gap-2 border-t border-white/10 pt-5">
          <Link to="/transfer">
            <Button className="rounded-full">
              <Icon icon={ArrowUpRight01Icon} size={17} />
              Send
            </Button>
          </Link>
          {/* `hash` selects the Receive tab on arrival: the transfer page opens on Send, so a link
              to its bare path would show the send form after the user asked for their address. */}
          <Link to="/transfer" hash="receive">
            <Button
              variant="outline"
              className="rounded-full border-white/15 bg-white/5 text-white hover:bg-white/10 hover:text-white"
            >
              <Icon icon={ArrowDownLeft01Icon} size={17} />
              Receive
            </Button>
          </Link>
          <Link to="/wallet">
            <Button
              variant="outline"
              className="rounded-full border-white/15 bg-white/5 text-white hover:bg-white/10 hover:text-white"
            >
              Wallet details
            </Button>
          </Link>
        </div>
      </section>
      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        {/*
         * Summary only: each card links to the page that owns the detail, so these figures
         * never drift from the wallet or history screens.
         */}
        {metrics.map((metric, index) => (
          <Link
            key={metric.label}
            to={metric.href}
            className="min-h-28 rounded-2xl border bg-card p-4 shadow-sm transition-colors animate-fade-in hover:bg-secondary/50"
            style={{ animationDelay: `${index * 75}ms`, animationFillMode: "both" }}
          >
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Icon icon={metric.icon} size={18} className="text-muted-foreground" />
              <span>{metric.label}</span>
              <Icon icon={ArrowRight01Icon} size={15} className="ms-auto text-muted-foreground" />
            </div>
            <strong className="mt-5 block font-display text-2xl">
              {metric.money ?? <Count value={metric.count ?? 0} />}
            </strong>
            <p className="mt-1 text-xs text-muted-foreground">{metric.hint}</p>
          </Link>
        ))}
      </div>
      <section className="mt-4 rounded-[22px] border bg-card shadow-sm">
        <div className="border-b px-5 py-4">
          <h2 className="font-display text-base font-semibold">Transaction activity</h2>
          <p className="mt-1 text-xs text-muted-foreground">Last 7 days</p>
        </div>
        {transactions.length ? (
          <div className="h-64 p-5">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chart}>
                <defs>
                  <linearGradient id="receivedFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--success)" stopOpacity={0.32} />
                    <stop offset="100%" stopColor="var(--success)" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="sentFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.25} />
                    <stop offset="100%" stopColor="var(--primary)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke="var(--border)" />
                <XAxis dataKey="day" tickLine={false} axisLine={false} fontSize={12} />
                <YAxis tickLine={false} axisLine={false} fontSize={12} width={38} />
                {/* The hidden-balance preference masks every amount on the overview, tooltips
                    included: hovering the chart must not reveal what the toggle hid. */}
                <Tooltip formatter={(value) => mask(currency(Number(value).toFixed(4)))} />
                <Area
                  type="monotone"
                  dataKey="received"
                  stroke="var(--success)"
                  fill="url(#receivedFill)"
                  strokeWidth={2}
                  isAnimationActive
                  animationDuration={1100}
                />
                <Area
                  type="monotone"
                  dataKey="sent"
                  stroke="var(--primary)"
                  fill="url(#sentFill)"
                  strokeWidth={2}
                  isAnimationActive
                  animationDuration={1100}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <EmptyState
            title="No activity yet"
            detail="Your transfers will appear here once you send or receive funds."
            action={
              <Link to="/transfer">
                <Button variant="outline">Go to transfer</Button>
              </Link>
            }
          />
        )}
      </section>
      <section className="mt-4 overflow-hidden rounded-[22px] border bg-card shadow-sm">
        <div className="flex items-center justify-between border-b px-5 py-4">
          <h2 className="font-display text-base font-semibold">Recent transactions</h2>
          <Link to="/history" className="text-sm font-semibold text-primary-soft">
            View all
          </Link>
        </div>
        {transactions.length ? (
          transactions.slice(0, 4).map((t) => (
            <Link
              key={t.id}
              to="/history/$transferId"
              params={{ transferId: t.transferId }}
              className="flex items-center gap-3 border-b px-5 py-4 transition-colors last:border-0 hover:bg-secondary/40"
            >
              <Icon
                icon={t.direction === "sent" ? ArrowUpRight01Icon : ArrowDownLeft01Icon}
                className={t.direction === "sent" ? "text-primary-soft" : "text-success"}
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{t.counterpartyAddress}</p>
                <p className="text-xs text-muted-foreground">{dateText(t.createdAt)}</p>
              </div>
              <strong className="text-sm">
                {t.direction === "sent" ? "-" : "+"}
                {mask(currency(t.direction === "sent" ? t.amount : t.netAmount))}
              </strong>
            </Link>
          ))
        ) : (
          <EmptyState
            title="No transactions"
            detail="Send funds to another wallet address to start a transaction history."
            action={
              <Link to="/transfer">
                <Button variant="outline">New transfer</Button>
              </Link>
            }
          />
        )}
      </section>
    </>
  );
}
