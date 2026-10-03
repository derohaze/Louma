import { useEffect, useMemo, useState } from "react";
import { useInfiniteQuery, type InfiniteData } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
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
  ArrowDownLeft01Icon,
  ArrowUpRight01Icon,
  BitcoinCpuIcon,
} from "@hugeicons/core-free-icons";
import { useWallet, useHistoryWalk, type Transaction } from "@/shared/hooks";
import { currentLocale, useT } from "@/shared/i18n";
import { moneyChartValue, shortAddress, sumMoney } from "@/shared/lib/wallet";
import {
  accountFetchers,
  cn,
  hasBrowserSession,
  serverStateFreshness,
  serverStateKeys,
  type MiningHistoryPage,
} from "@/shared/lib/platform";
import { Icon } from "@/shared/ui/page";

/**
 * Analytics: the second page of the Home section, next to Overview.
 *
 * One interactive chart (money in vs money out, stacked exactly like the
 * overview bars: expenses at the bottom in `chart-2`, income on top in
 * `primary`) plus the totals behind it: wallet flow, transfers, and mining.
 * Everything reads the same shared queries the overview reads, so the two
 * pages can never disagree — only the cut is different.
 */
const RANGES: readonly {
  id: string;
  labelKey: "range.last7" | "range.last30" | "range.last90";
  days: number;
  buckets: number;
}[] = [
  { id: "7", labelKey: "range.last7", days: 7, buckets: 7 },
  { id: "30", labelKey: "range.last30", days: 30, buckets: 15 },
  { id: "90", labelKey: "range.last90", days: 90, buckets: 30 },
];

const DAY_MS = 24 * 60 * 60 * 1000;

const CARD = "card-enter card-enter-hover rounded-[22px] border bg-card shadow-sm";

type Bucket = { start: number; income: number; expense: number; mined: number };

function amount(value: string | number): string {
  const [whole = "0", fraction = ""] = String(value).split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const trimmed = fraction.replace(/0+$/, "");
  return trimmed ? `${grouped}.${trimmed}` : grouped;
}

function dayLabel(at: number): string {
  return new Intl.DateTimeFormat(currentLocale(), { day: "numeric", month: "short" }).format(
    new Date(at),
  );
}

/**
 * Segmented range control: one control for every viewport (no separate
 * desktop/mobile variants), so the chart and the totals always describe the
 * same window.
 */
function RangePills({ value, onChange }: { value: string; onChange: (next: string) => void }) {
  const t = useT("analytics");
  return (
    <div
      role="group"
      aria-label={t("range.label")}
      className="flex flex-wrap gap-1.5 rounded-full bg-secondary p-1"
    >
      {RANGES.map((range) => {
        const active = range.id === value;
        return (
          <button
            key={range.id}
            type="button"
            onClick={() => onChange(range.id)}
            aria-pressed={active}
            className={`rounded-full px-4 py-1.5 text-[12px] font-bold transition-all duration-300 ${
              active
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t("range.days", { days: range.days })}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Stacked area chart (recharts): expenses along the bottom, income stacked on
 * top — the same stacking the overview bars use, so the two read as one
 * language. Curves are `natural` with mount + range-change animation, the
 * fills are the theme tokens (`--primary`, `--chart-2`).
 */
function FlowTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: ReadonlyArray<{ dataKey?: string | number; value?: number | string }>;
}) {
  const t = useT("analytics");
  if (!active || !payload || payload.length === 0) return null;
  const point =
    payload[0]?.dataKey !== undefined
      ? (payload[0] as { payload?: ChartPoint }).payload
      : undefined;
  const income = Number(payload.find((p) => p.dataKey === "income")?.value ?? 0);
  const expense = Number(payload.find((p) => p.dataKey === "expense")?.value ?? 0);
  return (
    <div className="pointer-events-none max-w-[240px] rounded-xl border bg-card px-3 py-2 text-[12px] shadow-lg">
      <p className="font-bold">{point?.full ?? ""}</p>
      <p className="mt-1 flex items-center gap-1.5 tabular-nums">
        <span aria-hidden className="size-2 rounded-full bg-primary" />
        {t("tooltip.in")} {amount(income.toFixed(4))}
      </p>
      <p className="mt-0.5 flex items-center gap-1.5 tabular-nums">
        <span aria-hidden className="size-2 rounded-full bg-chart-2" />
        {t("tooltip.out")} {amount(expense.toFixed(4))}
      </p>
      {(point?.mined ?? 0) > 0 && (
        <p className="mt-0.5 tabular-nums text-muted-foreground">
          {t("tooltip.mined")} {amount((point?.mined ?? 0).toFixed(4))}
        </p>
      )}
    </div>
  );
}

type ChartPoint = { label: string; full: string; income: number; expense: number; mined: number };

function FlowChart({ buckets }: { buckets: readonly Bucket[] }) {
  const t = useT("analytics");
  const data = useMemo<ChartPoint[]>(
    () =>
      buckets.map((b) => ({
        label: dayLabel(b.start),
        full: new Intl.DateTimeFormat(currentLocale(), {
          day: "numeric",
          month: "short",
        }).format(new Date(b.start)),
        income: Math.round(b.income * 10_000) / 10_000,
        expense: Math.round(b.expense * 10_000) / 10_000,
        mined: b.mined,
      })),
    [buckets],
  );
  const peak = useMemo(() => Math.max(...buckets.map((b) => b.income + b.expense), 1), [buckets]);

  return (
    <div className="min-w-0 overflow-hidden">
      <div
        className="h-[250px] w-full min-w-0 overflow-hidden [&_.recharts-wrapper:focus]:outline-none"
        role="img"
        aria-label={t("flow.chartAria")}
      >
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 12, right: 12, bottom: 0, left: 12 }}>
            <defs>
              <linearGradient id="analyticsFillIncome" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="var(--primary)" stopOpacity={1} />
                <stop offset="95%" stopColor="var(--primary)" stopOpacity={0.1} />
              </linearGradient>
              <linearGradient id="analyticsFillExpense" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="var(--chart-2)" stopOpacity={0.8} />
                <stop offset="95%" stopColor="var(--chart-2)" stopOpacity={0.1} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke="var(--border)" />
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              minTickGap={32}
              interval="preserveStartEnd"
              tick={{ fill: "var(--muted-foreground)", fontSize: 11, fontWeight: 600 }}
            />
            <YAxis hide domain={[0, (dataMax: number) => Math.max(1, dataMax * 1.15)]} />
            <Tooltip cursor={false} content={<FlowTooltip />} />
            <Area
              dataKey="expense"
              type="monotone"
              fill="url(#analyticsFillExpense)"
              stroke="var(--chart-2)"
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
              stackId="a"
              dot={false}
              activeDot={{ r: 4, strokeWidth: 2 }}
              animationDuration={700}
              animationEasing="ease-out"
            />
            <Area
              dataKey="income"
              type="monotone"
              fill="url(#analyticsFillIncome)"
              stroke="var(--primary)"
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
              stackId="a"
              dot={false}
              activeDot={{ r: 4, strokeWidth: 2 }}
              animationDuration={700}
              animationEasing="ease-out"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-3 flex min-w-0 flex-wrap items-center gap-x-5 gap-y-1 text-[12px] font-semibold text-muted-foreground">
        <span className="flex shrink-0 items-center gap-2">
          <span aria-hidden className="size-2 rounded-full bg-primary" />
          {t("flow.income")}
        </span>
        <span className="flex shrink-0 items-center gap-2">
          <span aria-hidden className="size-2 rounded-full bg-chart-2" />
          {t("flow.expenses")}
        </span>
        <span className="ml-auto min-w-0 truncate text-right tabular-nums">
          {t("flow.peak", { amount: amount(peak.toFixed(4)) })}
        </span>
      </div>
    </div>
  );
}

export function AnalyticsContent() {
  const t = useT("analytics");
  const { transactions, wallet } = useWallet();
  const history = useInfiniteQuery<
    MiningHistoryPage,
    Error,
    InfiniteData<MiningHistoryPage, string | null>,
    typeof serverStateKeys.miningHistory,
    string | null
  >({
    queryKey: serverStateKeys.miningHistory,
    queryFn: ({ pageParam }) => accountFetchers.miningHistory(pageParam),
    initialPageParam: null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    staleTime: serverStateFreshness.miningHistoryMs,
    enabled: hasBrowserSession,
  });
  const [rangeId, setRangeId] = useState(RANGES[2]!.id);
  const range = RANGES.find((r) => r.id === rangeId) ?? RANGES[2]!;
  const [cardsIn, setCardsIn] = useState(false);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setCardsIn(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  const window = useMemo(() => {
    const to = Date.now();
    return { from: to - range.days * DAY_MS, to };
  }, [range]);

  // The totals below read the shared lists, so the walks feed every dashboard at once: totals
  // computed from only the loaded pages would understate income, expenses, counts, and mining
  // for any wallet whose window reaches past the first page. The transaction walk keeps going until
  // it reaches a page older than the selected window, so a busy wallet's totals cover the whole
  // range rather than the first 500 rows; `cap` only bounds a pathological cursor.
  useHistoryWalk({
    queryKey: serverStateKeys.transactions,
    fetchPage: accountFetchers.transactions,
    nextCursor: (page) => page.nextCursor,
    cap: 200,
    enabled: wallet !== null,
    shouldContinue: (page) => {
      const oldest = page.transactions.at(-1);
      return !oldest || new Date(oldest.createdAt).getTime() >= window.from;
    },
  });
  useHistoryWalk<MiningHistoryPage>({
    queryKey: serverStateKeys.miningHistory,
    fetchPage: accountFetchers.miningHistory,
    nextCursor: (page) => page.nextCursor,
    cap: 10,
    enabled: wallet !== null,
  });
  const sessions = useMemo(
    () => (history.data?.pages ?? []).flatMap((page) => page.sessions),
    [history.data],
  );

  /** One pass over transfers + paid-out mining cycles, bucketed by day slice. */
  const buckets = useMemo<Bucket[]>(() => {
    const span = window.to - window.from;
    const list: Bucket[] = Array.from({ length: range.buckets }, (_, i) => ({
      start: window.from + (i / range.buckets) * span,
      income: 0,
      expense: 0,
      mined: 0,
    }));
    const at = (t: Transaction) => new Date(t.createdAt).getTime();
    for (const t of transactions) {
      const time = at(t);
      if (time < window.from || time >= window.to) continue;
      const i = Math.min(
        range.buckets - 1,
        Math.floor(((time - window.from) / span) * range.buckets),
      );
      const bucket = list[i]!;
      if (t.direction === "received") bucket.income += moneyChartValue(t.netAmount);
      else bucket.expense += moneyChartValue(t.amount);
    }
    // A cycle can carry wallet-credited payouts while still `active` (collecting mid-cycle never
    // closes it) and can pay out more than once, so each posted settlement is placed on the day it
    // landed — booking the cumulative `settled` total at `lastSettledAt` would move a payout earned
    // before the window into it. An older payload without the per-settlement list falls back to the
    // cumulative amount at its settle time.
    for (const s of sessions) {
      if (s.settledMinor <= 0) continue;
      const payouts = s.settlements?.length
        ? s.settlements
        : s.lastSettledAt
          ? [{ amount: s.settled, at: s.lastSettledAt }]
          : [];
      for (const payout of payouts) {
        const time = new Date(payout.at).getTime();
        if (time < window.from || time >= window.to) continue;
        const i = Math.min(
          range.buckets - 1,
          Math.floor(((time - window.from) / span) * range.buckets),
        );
        list[i]!.mined += moneyChartValue(payout.amount);
      }
    }
    return list;
  }, [transactions, sessions, window, range]);

  const totals = useMemo(() => {
    const income = buckets.reduce((s, b) => s + b.income, 0);
    const expense = buckets.reduce((s, b) => s + b.expense, 0);
    const mined = buckets.reduce((s, b) => s + b.mined, 0);
    const count = transactions.filter((t) => {
      const at = new Date(t.createdAt).getTime();
      return at >= window.from && at < window.to;
    }).length;
    return { income, expense, mined, count, net: income - expense };
  }, [buckets, transactions, window]);

  /** Who the wallet moves money with most, by volume in this window. */
  const topCounterparties = useMemo(() => {
    const byAddress = new Map<string, { volume: number; last: Transaction }>();
    for (const t of transactions) {
      const at = new Date(t.createdAt).getTime();
      if (at < window.from || at >= window.to) continue;
      const volume = moneyChartValue(t.direction === "received" ? t.netAmount : t.amount);
      const seen = byAddress.get(t.counterpartyAddress);
      if (seen) {
        seen.volume += volume;
        if (t.createdAt > seen.last.createdAt) seen.last = t;
      } else {
        byAddress.set(t.counterpartyAddress, { volume, last: t });
      }
    }
    return [...byAddress.entries()].sort((a, b) => b[1].volume - a[1].volume).slice(0, 4);
  }, [transactions, window]);

  const settledSessions = sessions.filter(
    (s) =>
      s.settledMinor > 0 && s.lastSettledAt && new Date(s.lastSettledAt).getTime() >= window.from,
  );
  const minedTotal = sumMoney(settledSessions.map((s) => s.settled));

  const show = (v: number) => amount(v.toFixed(4));

  return (
    <div className="grid gap-4">
      {/* The chart card: range pills on top, the interactive flow below. */}
      <section className={`${CARD} p-6`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-[22px] font-semibold">{t("flow.title")}</h2>
            <p className="mt-1 text-[12px] font-semibold text-muted-foreground">
              {t("flow.subtitle", { range: t(range.labelKey).toLowerCase() })}
            </p>
          </div>
          <RangePills value={rangeId} onChange={setRangeId} />
        </div>
        <div key={rangeId} className="card-enter mt-6">
          <FlowChart buckets={buckets} />
        </div>
      </section>

      {/* The totals behind the chart: income, expenses, transfers, mined. */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <section
          style={{ transitionDelay: cardsIn ? `${0 * 75}ms` : "0ms" }}
          className={cn(
            "rounded-[22px] border bg-card p-5 shadow-sm transition-all duration-500 ease-[cubic-bezier(0.4,0,0.2,1)] hover:-translate-y-0.5 hover:shadow-md motion-reduce:translate-y-0 motion-reduce:opacity-100 motion-reduce:transition-none",
            cardsIn ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0",
          )}
        >
          <p className="flex items-center gap-2 text-[12px] font-semibold text-muted-foreground">
            <span aria-hidden className="size-2 rounded-full bg-primary" />
            {t("totals.income")}
          </p>
          <p className="mt-2 font-display text-[26px] leading-none font-bold tabular-nums">
            {show(totals.income)}
          </p>
          <p className="mt-2 text-[11px] text-muted-foreground">
            {t("totals.incomeDetail", { range: t(range.labelKey).toLowerCase() })}
          </p>
        </section>
        <section
          style={{ transitionDelay: cardsIn ? `${1 * 75}ms` : "0ms" }}
          className={cn(
            "rounded-[22px] border bg-card p-5 shadow-sm transition-all duration-500 ease-[cubic-bezier(0.4,0,0.2,1)] hover:-translate-y-0.5 hover:shadow-md motion-reduce:translate-y-0 motion-reduce:opacity-100 motion-reduce:transition-none",
            cardsIn ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0",
          )}
        >
          <p className="flex items-center gap-2 text-[12px] font-semibold text-muted-foreground">
            <span aria-hidden className="size-2 rounded-full bg-chart-2" />
            {t("totals.expenses")}
          </p>
          <p className="mt-2 font-display text-[26px] leading-none font-bold tabular-nums">
            {show(totals.expense)}
          </p>
          <p className="mt-2 text-[11px] text-muted-foreground">
            {t("totals.expensesDetail", { range: t(range.labelKey).toLowerCase() })}
          </p>
        </section>
        <section
          style={{ transitionDelay: cardsIn ? `${2 * 75}ms` : "0ms" }}
          className={cn(
            "rounded-[22px] bg-foreground p-5 text-background shadow-sm transition-all duration-500 ease-[cubic-bezier(0.4,0,0.2,1)] hover:-translate-y-0.5 hover:shadow-md motion-reduce:translate-y-0 motion-reduce:opacity-100 motion-reduce:transition-none",
            cardsIn ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0",
          )}
        >
          <p className="text-[12px] font-semibold tracking-wide opacity-70">
            {t("totals.transfers")}
          </p>
          <p className="mt-2 font-display text-[26px] leading-none font-bold tabular-nums">
            {totals.count}
          </p>
          <p className="mt-2 text-[11px] opacity-70">
            {t("totals.net", {
              amount: `${totals.net >= 0 ? "+" : "−"}${show(Math.abs(totals.net))}`,
            })}
          </p>
        </section>
        <Link
          to="/mining/history"
          style={{ transitionDelay: cardsIn ? `${3 * 75}ms` : "0ms" }}
          className={cn(
            "rounded-[22px] bg-primary p-5 text-primary-foreground shadow-sm transition-all duration-500 ease-[cubic-bezier(0.4,0,0.2,1)] hover:-translate-y-0.5 hover:shadow-md motion-reduce:translate-y-0 motion-reduce:opacity-100 motion-reduce:transition-none",
            cardsIn ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0",
          )}
        >
          <p className="flex items-center gap-2 text-[12px] font-semibold opacity-80">
            <Icon icon={BitcoinCpuIcon} size={15} />
            {t("totals.mined")}
          </p>
          <p className="mt-2 font-display text-[26px] leading-none font-bold tabular-nums">
            {amount(minedTotal)}
          </p>
          <p className="mt-2 text-[11px] opacity-70">
            {settledSessions.length === 1
              ? t("totals.cycleOne", { count: settledSessions.length })
              : t("totals.cycles", { count: settledSessions.length })}
          </p>
        </Link>
      </div>

      {/* Who moves the money, and where mining lands inside the same window. */}
      <div className="grid gap-4 lg:grid-cols-2">
        <section className={`${CARD} overflow-hidden`}>
          <div className="p-5 pb-2">
            <h2 className="font-display text-[18px] font-semibold">{t("counterparties.title")}</h2>
            <p className="mt-1 text-[12px] font-semibold text-muted-foreground">
              {t("counterparties.subtitle", { range: t(range.labelKey).toLowerCase() })}
            </p>
          </div>
          <ul>
            {topCounterparties.map(([address, entry]) => {
              const received = entry.last.direction === "received";
              return (
                <li key={address} className="border-b last:border-b-0">
                  <div className="flex items-center gap-3 px-5 py-3.5">
                    <span
                      className={`grid size-9 shrink-0 place-items-center rounded-[12px] ${
                        received ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
                      }`}
                    >
                      <Icon icon={received ? ArrowDownLeft01Icon : ArrowUpRight01Icon} size={16} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-bold">
                        {entry.last.note || shortAddress(address)}
                      </span>
                      <span className="block truncate text-[11px] text-muted-foreground">
                        {received ? t("counterparties.received") : t("counterparties.sent")} ·{" "}
                        {shortAddress(address)}
                      </span>
                    </span>
                    <span className="shrink-0 text-[13px] font-bold tabular-nums">
                      {show(entry.volume)}
                    </span>
                  </div>
                </li>
              );
            })}
            {topCounterparties.length === 0 && (
              <li className="px-5 py-8 text-center text-[13px] text-muted-foreground">
                {t("counterparties.empty")}
              </li>
            )}
          </ul>
        </section>
        <section className={`${CARD} flex flex-col p-5`}>
          <h2 className="font-display text-[18px] font-semibold">{t("mining.title")}</h2>
          <p className="mt-1 text-[12px] font-semibold text-muted-foreground">
            {t("mining.subtitle", { days: range.days })}
          </p>
          <div className="mt-5 space-y-4">
            <div>
              <div className="flex items-baseline justify-between gap-2 text-[12px] font-semibold">
                <span className="text-muted-foreground">{t("mining.moved")}</span>
                <span className="tabular-nums">{show(totals.income + totals.expense)} LMA</span>
              </div>
              <div className="mt-2 h-2.5 w-full overflow-hidden rounded-full bg-secondary">
                <div
                  className="h-full rounded-full bg-chart-2 transition-[width] duration-700 ease-out"
                  style={{
                    width: `${Math.min(100, ((totals.income + totals.expense) / Math.max(totals.income + totals.expense + totals.mined, 1)) * 100)}%`,
                  }}
                />
              </div>
            </div>
            <div>
              <div className="flex items-baseline justify-between gap-2 text-[12px] font-semibold">
                <span className="text-muted-foreground">{t("mining.collected")}</span>
                <span className="tabular-nums">{show(totals.mined)} LMA</span>
              </div>
              <div className="mt-2 h-2.5 w-full overflow-hidden rounded-full bg-secondary">
                <div
                  className="h-full rounded-full bg-primary transition-[width] duration-700 ease-out"
                  style={{
                    width: `${Math.min(100, (totals.mined / Math.max(totals.income + totals.expense + totals.mined, 1)) * 100)}%`,
                  }}
                />
              </div>
            </div>
          </div>
          <Link
            to="/mining"
            className="mt-auto inline-flex items-center gap-1.5 pt-5 text-[13px] font-semibold text-primary-soft"
          >
            {t("mining.open")}
            <Icon icon={ArrowUpRight01Icon} size={14} />
          </Link>
        </section>
      </div>
    </div>
  );
}
