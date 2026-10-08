import { useEffect, useMemo, useState } from "react";
import { useInfiniteQuery, type InfiniteData } from "@tanstack/react-query";
import NumberFlow from "@number-flow/react";
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
import { ArrowDownLeft01Icon, ArrowUpRight01Icon, PickaxeIcon } from "@hugeicons/core-free-icons";
import {
  useProAccess,
  useWallet,
  useHistoryWalk,
  useSlidingIndicator,
  type Transaction,
} from "@/shared/hooks";
import { currentLocale, languageLocale, useI18n, useT } from "@/shared/i18n";
import {
  miningPayoutsInWindow,
  moneyChartValue,
  shortAddress,
  sumMoney,
} from "@/shared/lib/wallet";
import {
  accountFetchers,
  availableHistoryDays,
  hasBrowserSession,
  maximumHistoryDays,
  serverStateFreshness,
  serverStateKeys,
  type MiningHistoryPage,
  type TransactionPage,
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
type Range = {
  id: string;
  labelKey: "range.last1" | "range.last7" | "range.last30" | "range.last90" | "range.last120";
  days: number;
  buckets: number;
};

const RANGES: readonly Range[] = [
  { id: "1", labelKey: "range.last1", days: 1, buckets: 24 },
  { id: "7", labelKey: "range.last7", days: 7, buckets: 7 },
  { id: "30", labelKey: "range.last30", days: 30, buckets: 15 },
  { id: "90", labelKey: "range.last90", days: 90, buckets: 30 },
  { id: "120", labelKey: "range.last120", days: 120, buckets: 40 },
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

function AnimatedAmount({ value }: { value: number }) {
  return <NumberFlow value={value} format={{ maximumFractionDigits: 4 }} />;
}

function dayLabel(at: number, hourly: boolean): string {
  return new Intl.DateTimeFormat(
    currentLocale(),
    hourly ? { hour: "numeric" } : { day: "numeric", month: "short" },
  ).format(new Date(at));
}

/**
 * Segmented range control: one control for every viewport (no separate
 * desktop/mobile variants), so the chart and the totals always describe the
 * same window.
 */
function RangePills({
  value,
  ranges,
  onChange,
}: {
  value: string;
  ranges: readonly Range[];
  onChange: (next: string) => void;
}) {
  const t = useT("analytics");
  const { containerRef, activeRef, position } = useSlidingIndicator<
    HTMLDivElement,
    HTMLButtonElement
  >(value);
  return (
    <div
      ref={containerRef}
      role="group"
      aria-label={t("range.label")}
      className="relative isolate flex flex-wrap gap-1.5 rounded-full bg-secondary p-1"
    >
      {position && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute left-0 top-0 z-0 rounded-full bg-primary shadow-sm transition-transform duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] will-change-transform motion-reduce:transition-none"
          style={{
            width: position.width,
            height: position.height,
            transform: `translate3d(${position.x}px, ${position.y}px, 0) scale(${position.scaleX}, ${position.scaleY})`,
            transformOrigin: "top left",
          }}
        />
      )}
      {ranges.map((range) => {
        const active = range.id === value;
        return (
          <button
            key={range.id}
            type="button"
            onClick={() => onChange(range.id)}
            ref={active ? activeRef : undefined}
            aria-pressed={active}
            className={`relative z-10 rounded-full px-4 py-1.5 text-[12px] font-bold transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 ${
              active
                ? position
                  ? "text-primary-foreground"
                  : "bg-primary text-primary-foreground shadow-sm"
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

function FlowChart({ buckets, hourly }: { buckets: readonly Bucket[]; hourly: boolean }) {
  const t = useT("analytics");
  // Read through the hook (not just the module mirror): the axis and tooltip labels are formatted
  // inside this memo, so the language must be a dependency or they freeze in the previous language.
  const { language } = useI18n();
  const data = useMemo<ChartPoint[]>(
    () =>
      buckets.map((b) => ({
        label: dayLabel(b.start, hourly),
        full: new Intl.DateTimeFormat(
          languageLocale(language),
          hourly
            ? { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }
            : { day: "numeric", month: "short" },
        ).format(new Date(b.start)),
        income: Math.round(b.income * 10_000) / 10_000,
        expense: Math.round(b.expense * 10_000) / 10_000,
        mined: b.mined,
      })),
    [buckets, hourly, language],
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
  const { wallet } = useWallet();
  const pro = useProAccess();
  const allowedDays = availableHistoryDays(pro);
  const historyDays = maximumHistoryDays(pro);
  const ranges = RANGES.filter((item) => allowedDays.includes(item.days));
  const [rangeId, setRangeId] = useState("30");
  const range = ranges.find((item) => item.id === rangeId) ?? RANGES[2]!;
  useEffect(() => {
    if (!ranges.some((item) => item.id === rangeId)) setRangeId("30");
  }, [rangeId, ranges]);

  const transactionKey = useMemo(
    () => serverStateKeys.transactionsForDays(historyDays),
    [historyDays],
  );
  const transactionHistory = useInfiniteQuery<
    TransactionPage,
    Error,
    InfiniteData<TransactionPage, string | null>,
    typeof transactionKey,
    string | null
  >({
    queryKey: transactionKey,
    queryFn: ({ pageParam }) => accountFetchers.transactions(pageParam, historyDays),
    initialPageParam: null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    staleTime: serverStateFreshness.dashboardHistoryMs,
    enabled: hasBrowserSession && wallet !== null,
  });
  const miningKey = useMemo(() => serverStateKeys.miningHistory(historyDays), [historyDays]);
  const history = useInfiniteQuery<
    MiningHistoryPage,
    Error,
    InfiniteData<MiningHistoryPage, string | null>,
    typeof miningKey,
    string | null
  >({
    queryKey: miningKey,
    queryFn: ({ pageParam }) => accountFetchers.miningHistory(pageParam, historyDays),
    initialPageParam: null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    staleTime: serverStateFreshness.dashboardHistoryMs,
    enabled: hasBrowserSession,
  });
  const transactions = useMemo(
    () => (transactionHistory.data?.pages ?? []).flatMap((page) => page.transactions),
    [transactionHistory.data],
  );

  const window = useMemo(() => {
    const to = Date.now();
    return { from: to - range.days * DAY_MS, to };
  }, [range]);

  // One plan-bounded snapshot serves every selected window; changing ranges is client-side only.
  useHistoryWalk({
    queryKey: transactionKey,
    fetchPage: (cursor) => accountFetchers.transactions(cursor, historyDays),
    nextCursor: (page) => page.nextCursor,
    cap: 200,
    enabled: wallet !== null,
  });
  useHistoryWalk<MiningHistoryPage>({
    queryKey: miningKey,
    fetchPage: (cursor) => accountFetchers.miningHistory(cursor, historyDays),
    nextCursor: (page) => page.nextCursor,
    cap: 20,
    enabled: wallet !== null,
  });
  const sessions = useMemo(
    () => (history.data?.pages ?? []).flatMap((page) => page.sessions),
    [history.data],
  );
  const miningPayouts = useMemo(
    () => miningPayoutsInWindow(sessions, window.from, window.to),
    [sessions, window],
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
    for (const payout of miningPayouts) {
      const time = new Date(payout.at).getTime();
      const i = Math.min(
        range.buckets - 1,
        Math.floor(((time - window.from) / span) * range.buckets),
      );
      list[i]!.mined += moneyChartValue(payout.amount);
    }
    return list;
  }, [transactions, miningPayouts, window, range]);

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

  const settledSessionIds = new Set(miningPayouts.map((payout) => payout.sessionId));
  const minedTotal = sumMoney(miningPayouts.map((payout) => payout.amount));

  const show = (v: number) => amount(v.toFixed(4));

  return (
    <div className="grid gap-4">
      {/* The chart card: range pills on top, the interactive flow below. */}
      <section style={{ animationDelay: "0ms" }} className={`${CARD} p-6`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-[22px] font-semibold">{t("flow.title")}</h2>
            <p className="mt-1 text-[12px] font-semibold text-muted-foreground">
              {t("flow.subtitle", { range: t(range.labelKey).toLowerCase() })}
            </p>
          </div>
          <RangePills value={range.id} ranges={ranges} onChange={setRangeId} />
        </div>
        <div key={rangeId} className="card-enter mt-6">
          <FlowChart buckets={buckets} hourly={range.days === 1} />
        </div>
      </section>

      {/* The totals behind the chart: income, expenses, transfers, mined. */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <section className="rounded-[22px] border bg-card p-5 shadow-sm transition-shadow duration-200 hover:shadow-md motion-reduce:transition-none">
          <p className="flex items-center gap-2 text-[12px] font-semibold text-muted-foreground">
            <span aria-hidden className="size-2 rounded-full bg-primary" />
            {t("totals.income")}
          </p>
          <p className="mt-2 font-display text-[26px] leading-none font-bold tabular-nums">
            <AnimatedAmount value={totals.income} />
          </p>
          <p className="mt-2 text-[11px] text-muted-foreground">
            {t("totals.incomeDetail", { range: t(range.labelKey).toLowerCase() })}
          </p>
        </section>
        <section className="rounded-[22px] border bg-card p-5 shadow-sm transition-shadow duration-200 hover:shadow-md motion-reduce:transition-none">
          <p className="flex items-center gap-2 text-[12px] font-semibold text-muted-foreground">
            <span aria-hidden className="size-2 rounded-full bg-chart-2" />
            {t("totals.expenses")}
          </p>
          <p className="mt-2 font-display text-[26px] leading-none font-bold tabular-nums">
            <AnimatedAmount value={totals.expense} />
          </p>
          <p className="mt-2 text-[11px] text-muted-foreground">
            {t("totals.expensesDetail", { range: t(range.labelKey).toLowerCase() })}
          </p>
        </section>
        <section className="rounded-[22px] bg-foreground p-5 text-background shadow-sm transition-shadow duration-200 hover:shadow-md motion-reduce:transition-none">
          <p className="text-[12px] font-semibold tracking-wide opacity-70">
            {t("totals.transfers")}
          </p>
          <p className="mt-2 font-display text-[26px] leading-none font-bold tabular-nums">
            <NumberFlow value={totals.count} />
          </p>
          <p className="mt-2 text-[11px] opacity-70">
            {t("totals.net", {
              amount: `${totals.net >= 0 ? "+" : "−"}${show(Math.abs(totals.net))}`,
            })}
          </p>
        </section>
        <Link
          to="/mining/history"
          className="rounded-[22px] bg-primary p-5 text-primary-foreground shadow-sm transition-shadow duration-200 hover:shadow-md motion-reduce:transition-none"
        >
          <p className="flex items-center gap-2 text-[12px] font-semibold opacity-80">
            <Icon icon={PickaxeIcon} size={15} />
            {t("totals.mined")}
          </p>
          <p className="mt-2 font-display text-[26px] leading-none font-bold tabular-nums">
            <AnimatedAmount value={moneyChartValue(minedTotal)} />
          </p>
          <p className="mt-2 text-[11px] opacity-70">
            {settledSessionIds.size === 1
              ? t("totals.cycleOne", { count: settledSessionIds.size })
              : t("totals.cycles", { count: settledSessionIds.size })}
          </p>
        </Link>
      </div>

      {/* Who moves the money, and where mining lands inside the same window. */}
      <div className="grid gap-4 lg:grid-cols-2">
        <section style={{ animationDelay: "300ms" }} className={`${CARD} overflow-hidden`}>
          <div className="p-5 pb-2">
            <h2 className="font-display text-[18px] font-semibold">{t("counterparties.title")}</h2>
            <p className="mt-1 text-[12px] font-semibold text-muted-foreground">
              {t("counterparties.subtitle", { range: t(range.labelKey).toLowerCase() })}
            </p>
          </div>
          <ul>
            {topCounterparties.map(([address, entry], row) => {
              const received = entry.last.direction === "received";
              return (
                <li
                  key={address}
                  style={{ animationDelay: `${Math.min(row * 60, 240)}ms` }}
                  className="list-enter border-b last:border-b-0"
                >
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
                        {shortAddress(address)}
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
        <section style={{ animationDelay: "375ms" }} className={`${CARD} flex flex-col p-5`}>
          <h2 className="font-display text-[18px] font-semibold">{t("mining.title")}</h2>
          <p className="mt-1 text-[12px] font-semibold text-muted-foreground">
            {t("mining.subtitle", { range: t(range.labelKey).toLowerCase() })}
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
