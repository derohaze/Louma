import { useProAccess } from "@/shared/hooks";
import { useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { useInfiniteQuery, type InfiniteData } from "@tanstack/react-query";
import { QRCodeSVG } from "qrcode.react";
import { ArrowUpRight01Icon } from "@hugeicons/core-free-icons";
import { translate, useT } from "@/shared/i18n";
import { Button } from "@/shared/ui/button";
import { CopyButton, Icon, PageHeader } from "@/shared/ui/page";
import { useWallet, useHistoryWalk, type Transaction } from "@/shared/hooks";
import { currency, dateText, moneyChartValue } from "@/shared/lib/wallet";
import {
  accountFetchers,
  hasBrowserSession,
  serverStateFreshness,
  serverStateKeys,
  type MiningHistoryPage,
} from "@/shared/lib/platform";

/** Rolling window every figure on this dashboard describes. */
const WINDOW_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
/** How many bars the flow card draws across the window. */
const BAR_COUNT = 10;
/** How many dots each breakdown row draws. */
const DOT_COUNT = 12;

/** Short grouped figure: thousands separators, no trailing zeros, no ticker. */
function amount(value: string | number): string {
  const [whole = "0", fraction = ""] = String(value).split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const trimmed = fraction.replace(/0+$/, "");
  return trimmed ? `${grouped}.${trimmed}` : grouped;
}

const show = (v: number) => amount(v.toFixed(4));

type Slice = { start: number; income: number; expense: number };

/** Stacked pill bars: income over expense, newest at the right. */
function FlowBars({ slices }: { slices: readonly Slice[] }) {
  const peak = Math.max(...slices.map((s) => s.income + s.expense), 1);
  return (
    <div role="img" aria-label={translate("wallet.page.flow.chartAria")}>
      <div className="flex h-[110px] items-end gap-2">
        {slices.map((slice, index) => (
          <div key={index} className="flex h-full min-w-0 flex-1 flex-col items-center gap-1.5">
            <div className="flex h-full w-full max-w-7 flex-1 flex-col justify-end overflow-hidden rounded-full bg-secondary">
              {slice.expense > 0 && (
                <div
                  className="w-full bg-chart-2"
                  style={{ height: `${(slice.expense / peak) * 100}%` }}
                />
              )}
              {slice.income > 0 && (
                <div
                  className="w-full bg-primary"
                  style={{ height: `${(slice.income / peak) * 100}%` }}
                />
              )}
            </div>
            <span className="text-[9px] font-semibold text-muted-foreground tabular-nums">
              {new Date(slice.start).getDate()}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Progress ring: share of the flow coming in. */
function IncomeRing({ share }: { share: number }) {
  const radius = 52;
  const full = 2 * Math.PI * radius;
  return (
    <div className="relative grid shrink-0 place-items-center">
      <svg viewBox="0 0 120 120" className="size-28" aria-hidden>
        <circle cx="60" cy="60" r={radius} fill="none" stroke="var(--secondary)" strokeWidth="12" />
        <circle
          cx="60"
          cy="60"
          r={radius}
          fill="none"
          stroke="var(--primary)"
          strokeWidth="12"
          strokeLinecap="round"
          strokeDasharray={full}
          strokeDashoffset={full * (1 - Math.min(1, Math.max(0, share)))}
          transform="rotate(-90 60 60)"
          className="transition-[stroke-dashoffset] duration-700 ease-out"
        />
      </svg>
      <p className="absolute font-display text-xl font-bold tabular-nums">
        {Math.round(share * 100)}%
      </p>
    </div>
  );
}

type Row = {
  label: string;
  share: number;
  pill: string;
  dot: string;
};

/** Dot-matrix breakdown: one row per flow side, 12 dots each. */
function BreakdownRows({ rows }: { rows: readonly Row[] }) {
  return (
    <div className="mt-5 space-y-4">
      {rows.map((row) => {
        const filled = Math.round(row.share * DOT_COUNT);
        return (
          <div key={row.label} className="flex items-center gap-2 sm:gap-3">
            <span
              className={`w-[74px] shrink-0 rounded-full px-2 py-1.5 text-center text-[11px] font-bold sm:w-24 sm:px-3 sm:text-[12px] ${row.pill}`}
            >
              {row.label}
            </span>
            <span className="flex min-w-0 flex-1 gap-1 sm:gap-1.5" aria-hidden>
              {Array.from({ length: DOT_COUNT }, (_, i) => (
                <span
                  key={i}
                  className={`size-2 shrink-0 rounded-full sm:size-2.5 ${i < filled ? row.dot : "bg-secondary"}`}
                />
              ))}
            </span>
            <span className="w-9 shrink-0 text-right text-[12px] font-bold tabular-nums sm:w-11 sm:text-[13px]">
              {Math.round(row.share * 100)}%
            </span>
          </div>
        );
      })}
    </div>
  );
}

/**
 * The Wallet page as a metrics dashboard: flow bars, growth, income share,
 * and a dot-matrix breakdown — all reading the same wallet cache as every
 * other page, with the primary address kept in one slim strip on top.
 */
export function WalletContent() {
  const t = useT("wallet.page");
  const common = useT("common");
  const { wallet, transactions } = useWallet();
  const pro = useProAccess();
  const receivingAddress = pro && wallet?.customAddress ? wallet.customAddress : wallet?.address;
  const miningKey = useMemo(() => serverStateKeys.miningHistory(WINDOW_DAYS), []);
  const history = useInfiniteQuery<
    MiningHistoryPage,
    Error,
    InfiniteData<MiningHistoryPage, string | null>,
    typeof miningKey,
    string | null
  >({
    queryKey: miningKey,
    queryFn: ({ pageParam }) => accountFetchers.miningHistory(pageParam, WINDOW_DAYS),
    initialPageParam: null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    staleTime: serverStateFreshness.miningHistoryMs,
    enabled: hasBrowserSession,
  });
  const to = useMemo(() => Date.now(), []);
  const from = to - WINDOW_DAYS * DAY_MS;

  // Same shared lists the other dashboards read: without the walks this board's window totals
  // would cover only the loaded pages. The transaction walk runs until it reaches a page older than
  // the window, so a busy wallet's totals reflect the whole window rather than its first 500 rows.
  useHistoryWalk({
    queryKey: serverStateKeys.transactions,
    fetchPage: accountFetchers.transactions,
    nextCursor: (page) => page.nextCursor,
    cap: 200,
    enabled: wallet !== null,
    shouldContinue: (page) => {
      const oldest = page.transactions.at(-1);
      return !oldest || new Date(oldest.createdAt).getTime() >= from;
    },
  });
  useHistoryWalk<MiningHistoryPage>({
    queryKey: miningKey,
    fetchPage: (cursor) => accountFetchers.miningHistory(cursor, WINDOW_DAYS),
    nextCursor: (page) => page.nextCursor,
    cap: 20,
    enabled: wallet !== null,
  });
  const sessions = useMemo(
    () => (history.data?.pages ?? []).flatMap((page) => page.sessions),
    [history.data],
  );

  const stats = useMemo(() => {
    const at = (t: Transaction) => new Date(t.createdAt).getTime();
    const inWindow = (time: number, start: number, end: number) => time >= start && time < end;
    let income = 0;
    let expense = 0;
    let count = 0;
    let prevVolume = 0;
    let prevCount = 0;
    const span = to - from;
    const slices: Slice[] = Array.from({ length: BAR_COUNT }, (_, i) => ({
      start: from + (i / BAR_COUNT) * span,
      income: 0,
      expense: 0,
    }));
    for (const t of transactions) {
      const time = at(t);
      if (inWindow(time, from, to)) {
        count += 1;
        const index = Math.min(BAR_COUNT - 1, Math.floor(((time - from) / span) * BAR_COUNT));
        const bucket = slices[index]!;
        if (t.direction === "received") {
          const v = moneyChartValue(t.netAmount);
          income += v;
          bucket.income += v;
        } else {
          const v = moneyChartValue(t.amount);
          expense += v;
          bucket.expense += v;
        }
      } else if (inWindow(time, from - WINDOW_DAYS * DAY_MS, from)) {
        prevCount += 1;
        prevVolume += moneyChartValue(t.direction === "received" ? t.netAmount : t.amount);
      }
    }
    let mined = 0;
    // Each posted payout is placed on its own day: a cycle can pay out more than once while still
    // `active`, so booking the cumulative `settled` total at `lastSettledAt` would move a payout
    // earned before this window into it. An older payload without the per-settlement list falls back
    // to that cumulative amount at its settle time.
    for (const s of sessions) {
      if (s.settledMinor <= 0) continue;
      const payouts = s.settlements?.length
        ? s.settlements
        : s.lastSettledAt
          ? [{ amount: s.settled, at: s.lastSettledAt }]
          : [];
      for (const payout of payouts) {
        if (inWindow(new Date(payout.at).getTime(), from, to))
          mined += moneyChartValue(payout.amount);
      }
    }
    const volume = income + expense;
    const total = volume + mined;
    return {
      income,
      expense,
      mined,
      count,
      volume,
      total,
      prevVolume,
      prevCount,
      slices,
      incomeShare: volume > 0 ? income / volume : 0,
      deltaPct: prevVolume > 0 ? Math.round(((volume - prevVolume) / prevVolume) * 100) : null,
    };
  }, [transactions, sessions, to, from]);

  const frozen = wallet?.status === "frozen";
  const deltaUp = (stats.deltaPct ?? 0) >= 0;
  const rows: Row[] = [
    {
      label: common("direction.received"),
      share: stats.total > 0 ? stats.income / stats.total : 0,
      pill: "bg-primary text-primary-foreground",
      dot: "bg-primary",
    },
    {
      label: common("direction.sent"),
      share: stats.total > 0 ? stats.expense / stats.total : 0,
      pill: "bg-chart-2 text-primary-foreground",
      dot: "bg-chart-2",
    },
    {
      label: t("breakdown.mined"),
      share: stats.total > 0 ? stats.mined / stats.total : 0,
      pill: "bg-primary/20 text-primary",
      dot: "bg-primary/40",
    },
  ];

  return (
    <>
      <PageHeader
        title={t("title")}
        subtitle={t("description")}
        action={
          <Link to="/transfer">
            <Button>
              <Icon icon={ArrowUpRight01Icon} size={17} />
              {t("transfer")}
            </Button>
          </Link>
        }
      />

      {/* Primary address strip: the one place the address lives, with status. */}
      <section
        style={{ animationDelay: "0ms" }}
        className="card-enter card-enter-hover mb-4 flex flex-wrap items-center gap-x-4 gap-y-3 rounded-[22px] border bg-card p-4 shadow-sm"
      >
        {receivingAddress && (
          /* The QR is generated in the browser, so the address never leaves the page. */
          <div className="rounded-2xl border bg-white p-2">
            <QRCodeSVG
              value={receivingAddress}
              size={88}
              level="M"
              marginSize={1}
              fgColor="#20123A"
              bgColor="#FFFFFF"
              aria-label={t("qrAria")}
            />
          </div>
        )}
        <span className="text-[12px] font-semibold text-muted-foreground">
          {t("primaryAddress")}
        </span>
        <code className="min-w-0 flex-1 break-all text-sm font-semibold tabular-nums">
          {receivingAddress ?? "—"}
        </code>
        {receivingAddress && <CopyButton text={receivingAddress} />}
        <span
          className={`flex items-center gap-2 text-[13px] font-bold ${frozen ? "text-destructive" : "text-success"}`}
        >
          <span
            aria-hidden
            className={`size-2 rounded-full ${frozen ? "bg-destructive" : "bg-success"}`}
          />
          {frozen ? common("state.frozen") : common("state.active")}
        </span>
        <span className="text-[12px] text-muted-foreground tabular-nums">
          {wallet?.createdAt ? dateText(wallet.createdAt) : ""}
        </span>
      </section>

      {/* Top metric cards: flow bars, growth, and income share. */}
      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-[1.35fr_1.1fr_1fr]">
        <section
          style={{ animationDelay: "75ms" }}
          className="card-enter card-enter-hover rounded-[22px] border bg-card p-5 shadow-sm lg:col-span-2 xl:col-span-1"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="font-display font-semibold">{t("flow.title")}</h2>
              <p className="mt-1 text-[12px] font-semibold text-muted-foreground">
                {t("flow.subtitle")}
              </p>
            </div>
            <p className="text-right font-display text-xl font-bold tabular-nums">
              {currency(wallet?.balance ?? "0")}
            </p>
          </div>
          <div className="mt-4 flex items-baseline gap-2 text-[13px] font-bold tabular-nums">
            <span className="flex items-center gap-1.5">
              <span aria-hidden className="size-2 rounded-full bg-primary" />
              {show(stats.income)}
            </span>
            <span aria-hidden className="text-muted-foreground">
              →
            </span>
            <span className="flex items-center gap-1.5">
              <span aria-hidden className="size-2 rounded-full bg-chart-2" />
              {show(stats.expense)}
            </span>
            <span className="ml-auto text-[11px] font-semibold text-muted-foreground">LMA</span>
          </div>
          <div className="mt-3">
            <FlowBars slices={stats.slices} />
          </div>
        </section>

        <section
          style={{ animationDelay: "150ms" }}
          className="card-enter card-enter-hover flex flex-col rounded-[22px] border bg-card p-5 shadow-sm"
        >
          <h2 className="font-display font-semibold">{t("growth.title")}</h2>
          <p className="mt-4 flex items-baseline gap-2">
            <span
              className={`font-display text-3xl font-bold tabular-nums ${stats.deltaPct === null ? "" : deltaUp ? "text-success" : "text-destructive"}`}
            >
              {stats.deltaPct === null ? "—" : `${deltaUp ? "+" : ""}${stats.deltaPct}%`}
            </span>
            <span className="text-[12px] font-semibold text-muted-foreground tabular-nums">
              {t("growth.prev", { amount: show(stats.prevVolume) })}
            </span>
          </p>
          <div className="mt-4 h-2.5 w-full overflow-hidden rounded-full bg-secondary">
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-700 ease-out"
              style={{ width: `${Math.round(stats.incomeShare * 100)}%` }}
            />
          </div>
          <p className="mt-auto pt-4 text-[12px] leading-relaxed text-muted-foreground">
            {t("growth.summary", {
              count: stats.count,
              unit: stats.count === 1 ? common("units.transferOne") : common("units.transferOther"),
              volume: show(stats.volume),
              days: WINDOW_DAYS,
            })}
          </p>
        </section>

        <section
          style={{ animationDelay: "225ms" }}
          className="card-enter card-enter-hover flex flex-col items-center rounded-[22px] border bg-card p-5 text-center shadow-sm"
        >
          <h2 className="font-display font-semibold">{t("income.title")}</h2>
          <div className="py-2">
            <IncomeRing share={stats.incomeShare} />
          </div>
          <p className="mt-auto text-[12px] text-muted-foreground">
            {t("income.note", { days: WINDOW_DAYS })}
          </p>
        </section>
      </div>

      {/* Breakdown + stacked totals. */}
      <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_300px]">
        <section
          style={{ animationDelay: "300ms" }}
          className="card-enter card-enter-hover rounded-[22px] border bg-card p-5 shadow-sm"
        >
          <h2 className="font-display font-semibold">{t("breakdown.title")}</h2>
          <p className="mt-1 text-[12px] font-semibold text-muted-foreground">
            {t("breakdown.subtitle", { days: WINDOW_DAYS })}
          </p>
          <BreakdownRows rows={rows} />
        </section>

        <div className="grid gap-4">
          <section
            style={{ animationDelay: "375ms" }}
            className="card-enter card-enter-hover rounded-[22px] bg-foreground p-5 text-background shadow-sm"
          >
            <p className="font-display text-3xl font-bold tabular-nums">+{stats.count}</p>
            <p className="mt-1 text-[12px] opacity-70">
              {t("totals.transfers", { days: WINDOW_DAYS })}
            </p>
          </section>
          <section
            style={{ animationDelay: "450ms" }}
            className="card-enter card-enter-hover rounded-[22px] border bg-card p-5 shadow-sm"
          >
            <p
              className={`text-[15px] font-bold tabular-nums ${stats.deltaPct === null ? "" : deltaUp ? "text-success" : "text-destructive"}`}
            >
              {stats.deltaPct === null
                ? common("state.none")
                : t("totals.vsPrev", {
                    arrow: deltaUp ? "↑" : "↓",
                    percent: Math.abs(stats.deltaPct),
                    count: stats.prevCount,
                  })}
            </p>
            <div className="mt-3 h-px w-full bg-border" />
          </section>
          <section
            style={{ animationDelay: "525ms" }}
            className="card-enter card-enter-hover rounded-[22px] bg-primary p-5 text-primary-foreground shadow-sm"
          >
            <p className="font-display text-xl font-bold tabular-nums">{show(stats.volume)} LMA</p>
            <p className="mt-1 text-[12px] opacity-70 tabular-nums">
              {t("totals.movedOut", { total: show(stats.total) })}
            </p>
          </section>
        </div>
      </div>
    </>
  );
}
