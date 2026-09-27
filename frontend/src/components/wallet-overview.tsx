import { Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
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
  Wallet01Icon,
  ArrowUpRight01Icon,
  ArrowDownLeft01Icon,
  TransactionHistoryIcon,
  SecurityCheckIcon,
  QrCodeIcon,
  ArrowRight01Icon,
} from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import { useWallet } from "@/hooks/use-wallet";
import { currency, dateText } from "@/lib/wallet-format";
import { navSections } from "@/lib/wallet-nav";
import { EmptyState, Icon, PageHeader } from "./wallet-shell";
type OverviewMetric = {
  icon: Parameters<typeof Icon>[0]["icon"];
  label: string;
  value: number;
  suffix: string;
  hint: string;
  href: "/wallet" | "/history" | "/custom-address" | "/security";
};

function Count({ value, suffix = "" }: { value: number; suffix?: string }) {
  const [display, setDisplay] = useState(0);
  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      setDisplay(value);
      return;
    }
    const start = performance.now();
    let frame = 0;
    const tick = (time: number) => {
      const progress = Math.min((time - start) / 1100, 1);
      setDisplay(value * (1 - Math.pow(1 - progress, 3)));
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value]);
  return (
    <>
      {new Intl.NumberFormat("en-US", {
        minimumFractionDigits: suffix ? 2 : 0,
        maximumFractionDigits: suffix ? 2 : 0,
      }).format(display)}
      {suffix}
    </>
  );
}
export function OverviewContent() {
  const { wallet, transactions } = useWallet();
  const received = transactions.filter((t) => t.direction === "received");
  const sent = transactions.filter((t) => t.direction === "sent");
  const totalIn = received.reduce((sum, t) => sum + t.amount, 0);
  const totalOut = sent.reduce((sum, t) => sum + t.amount, 0);
  const chart = useMemo(() => {
    const days = Array.from({ length: 7 }, (_, i) => {
      const date = new Date();
      date.setHours(0, 0, 0, 0);
      date.setDate(date.getDate() - (6 - i));
      return date;
    });
    return days.map((date) => {
      const daily = transactions.filter(
        (t) => new Date(t.created_at).toDateString() === date.toDateString(),
      );
      return {
        day: date.toLocaleDateString("en-US", { weekday: "short" }),
        received: daily.filter((t) => t.direction === "received").reduce((n, t) => n + t.amount, 0),
        sent: daily.filter((t) => t.direction === "sent").reduce((n, t) => n + t.amount, 0),
      };
    });
  }, [transactions]);
  const metrics: OverviewMetric[] = [
    {
      icon: Wallet01Icon,
      label: "Available Balance",
      value: wallet?.balance ?? 0,
      suffix: " WLT",
      hint: "Current wallet",
      href: "/wallet",
    },
    {
      icon: ArrowDownLeft01Icon,
      label: "Total Received",
      value: totalIn,
      suffix: " WLT",
      hint: "All incoming transfers",
      href: "/history",
    },
    {
      icon: ArrowUpRight01Icon,
      label: "Total Sent",
      value: totalOut,
      suffix: " WLT",
      hint: "All outgoing transfers",
      href: "/history",
    },
    {
      icon: TransactionHistoryIcon,
      label: "Transactions",
      value: transactions.length,
      suffix: "",
      hint: "Search and export history",
      href: "/history",
    },
    {
      icon: QrCodeIcon,
      label: "Custom Address",
      value: wallet ? 1 : 0,
      suffix: "",
      hint: "Receiving address",
      href: "/custom-address",
    },
    {
      icon: SecurityCheckIcon,
      label: "Security Status",
      value: wallet?.backup_confirmed ? 1 : 0,
      suffix: " / 1",
      hint: wallet?.backup_confirmed ? "Backup confirmed" : "Backup not confirmed",
      href: "/security",
    },
  ];
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
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {/*
         * Summary only: each card links to the page that owns the detail, so these figures
         * never drift from the wallet, history, or settings screens.
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
              <Count value={metric.value} suffix={metric.suffix} />
            </strong>
            <p className="mt-1 text-xs text-muted-foreground">{metric.hint}</p>
          </Link>
        ))}
      </div>
      <div className="mt-4 grid gap-4 xl:grid-cols-[1.6fr_1fr]">
        <section className="rounded-[22px] border bg-card shadow-sm">
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
                  <Tooltip formatter={(value) => currency(Number(value))} />
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
        <section className="rounded-[22px] border bg-card shadow-sm">
          <div className="border-b px-5 py-4">
            <h2 className="font-display text-base font-semibold">Sections</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Every page lives in the section that owns it.
            </p>
          </div>
          <div className="space-y-5 p-5">
            {navSections.map((section) => (
              <div key={section.title}>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {section.title}
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {section.items.map((item) => (
                    <Link
                      key={item.href}
                      to={item.href}
                      className="inline-flex items-center gap-2 rounded-full border bg-secondary/60 px-3 py-1.5 text-xs font-semibold transition-colors hover:bg-card"
                    >
                      <Icon icon={item.icon} size={15} />
                      {item.title}
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
      <section className="mt-4 overflow-hidden rounded-[22px] border bg-card shadow-sm">
        <div className="flex items-center justify-between border-b px-5 py-4">
          <h2 className="font-display text-base font-semibold">Recent transactions</h2>
          <Link to="/history" className="text-sm font-semibold text-primary">
            View all
          </Link>
        </div>
        {transactions.length ? (
          transactions.slice(0, 4).map((t) => (
            <div key={t.id} className="flex items-center gap-3 border-b px-5 py-4 last:border-0">
              <Icon
                icon={t.direction === "sent" ? ArrowUpRight01Icon : ArrowDownLeft01Icon}
                className={t.direction === "sent" ? "text-primary" : "text-success"}
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{t.counterparty_address}</p>
                <p className="text-xs text-muted-foreground">{dateText(t.created_at)}</p>
              </div>
              <strong className="text-sm">
                {t.direction === "sent" ? "-" : "+"}
                {currency(t.amount)}
              </strong>
            </div>
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
