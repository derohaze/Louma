import { Link } from "@tanstack/react-router";
import { useInfiniteQuery, useQuery, type InfiniteData } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import NumberFlow from "@number-flow/react";
import {
  Add01Icon,
  ArrowDownLeft01Icon,
  ArrowRight01Icon,
  ArrowUpRight01Icon,
} from "@hugeicons/core-free-icons";
import { useWallet, useHistoryWalk, type Transaction } from "@/shared/hooks";
import type { ApiMiningState } from "@/shared/api";
import {
  moneyChartValue,
  moneyFromMinorUnits,
  prefillTransfer,
  shortAddress,
  sumMoney,
} from "@/shared/lib/wallet";
import {
  accountFetchers,
  hasBrowserSession,
  serverStateFreshness,
  serverStateKeys,
  type TransactionPage,
  type MiningHistoryPage,
} from "@/shared/lib/platform";
import { currentLocale, translate, useT } from "@/shared/i18n";
import { Icon, CopyButton } from "@/shared/ui/page";
import { Switch } from "@/shared/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui/select";
import { countdown, liveSnapshot } from "@/features/mining/cycle/mining-format";

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

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The hard bound on transaction pages the overview may pull in on top of the first one the provider
 * loads. Every card here describes a window of days and a wallet with a long history keeps its
 * earlier transfers on later pages, so the walk pages back until it passes the window start; this
 * cap only stops a cursor that never ends. It is deliberately far above a real window's page count.
 */
const HISTORY_PAGE_CAP = 200;

/** Cycles settle about once a day, so ten pages cover a 90-day window with room to spare. */
const MINING_HISTORY_PAGE_CAP = 10;

/** How many bars the statistics card draws across the window. */
const BAR_COUNT = 10;

/** How many rows the activity feed shows, and how many counterparties the quick-send card offers. */
const FEED_ROWS = 4;
const COUNTERPARTY_LIMIT = 5;

/**
 * The windows the board can describe, chosen once from the statistics card. The label is a key,
 * resolved where the card renders, so the same period reads in whichever language is current.
 */
const PERIODS: readonly { id: string; labelKey: "periods.last7" | "periods.last30" | "periods.last90"; days: number }[] = [
  { id: "7", labelKey: "periods.last7", days: 7 },
  { id: "30", labelKey: "periods.last30", days: 30 },
  { id: "90", labelKey: "periods.last90", days: 90 },
];

/** One slice of the window: what came in and what went out inside it. */
type Slice = { income: number; expense: number };

/**
 * The board's three card surfaces, in the same shapes the mining screens use: a bordered white card,
 * the filled brand surface behind the live figure, and the inverted one the board closes on.
 */
const CARD = "card-enter card-enter-hover rounded-[22px] border bg-card shadow-sm";
const FILLED =
  "card-enter card-enter-hover rounded-[22px] bg-primary text-primary-foreground shadow-sm";
const INK = "card-enter card-enter-hover rounded-[22px] bg-foreground text-background shadow-sm";

/**
 * The figure inside a card, grouped the way the board prints one: `currency` is the right formatter
 * everywhere an amount stands alone, but a card has neither the room for four decimals nor the need
 * for the ticker — the label above it already says what is being measured. Trailing zeros go and the
 * rest stays, so the figure is short without ever rounding money away.
 */
function amount(value: string | number): string {
  const [whole = "0", fraction = ""] = String(value).split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const trimmed = fraction.replace(/0+$/, "");
  return trimmed ? `${grouped}.${trimmed}` : grouped;
}

/** Two letters to put on a counterparty's avatar, from whichever spelling of the address there is. */
function initials(address: string): string {
  return address.replace(/^LMA-/i, "").slice(0, 2).toUpperCase() || "?";
}

/** How long ago a transfer happened, in the words the board prints under its title. */
function relativeTime(iso: string): string {
  const at = new Date(iso).getTime();
  const days = Math.floor((Date.now() - at) / DAY_MS);
  if (days <= 0) return translate("overview.relative.today");
  if (days === 1) return translate("overview.relative.yesterday");
  if (days < 7) return translate("overview.relative.daysAgo", { days });
  return new Intl.DateTimeFormat(currentLocale(), { day: "2-digit", month: "short" }).format(
    new Date(at),
  );
}

/** A period dropdown, kept as the pill the header uses. */
function PillSelect({
  value,
  label,
  options,
  onChange,
}: {
  value: string;
  label: string;
  options: readonly { id: string; label: string }[];
  onChange: (next: string) => void;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger
        aria-label={label}
        className="h-8 w-auto gap-1 rounded-full px-3 text-[12px] font-semibold"
      >
        <SelectValue placeholder={label} />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.id} value={option.id}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * The statistics bars: one column per slice of the window, income stacked over expense.
 *
 * The parent already clips to its own rounded box, so the fills need no rounding of their own and
 * the empty track above each bar reads as the scale the tallest bar sets.
 */
function BarChart({ slices }: { slices: readonly Slice[] }) {
  const peak = Math.max(...slices.map((slice) => slice.income + slice.expense), 1);
  return (
    <div
      role="img"
      aria-label={translate("overview.chartAria")}
      className="flex h-[116px] items-end gap-[9px]"
    >
      {slices.map((slice, index) => (
        <div
          key={index}
          className="flex h-full flex-1 flex-col justify-end overflow-hidden rounded-[5px] bg-secondary"
        >
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
      ))}
    </div>
  );
}

/** The trend line: this window against the window of the same length immediately before it. */
function Change({ current, previous }: { current: number; previous: number }) {
  if (previous <= 0) return null;
  const percent = Math.round(((current - previous) / previous) * 100);
  const up = percent >= 0;
  return (
    <span
      className={`inline-flex items-center gap-1 text-[13px] font-bold tabular-nums ${
        up ? "text-success" : "text-destructive"
      }`}
    >
      {up ? "↗" : "↘"} {up ? "+" : ""}
      {percent}%
    </span>
  );
}

/**
 * The currency mark, printed bare: no disc and no frame around it.
 *
 * `-m-2` is what lets the mark print at 48px inside the 32px it used to occupy, so a bigger logo
 * never nudges the card it sits in: the negative margin hands back exactly the 16px the image
 * gained, and the layout box stays the size it was.
 */
function WalletLogo() {
  return (
    <img
      src="/Louma_Brand_logos/png/louma-logo-256x256.png"
      alt=""
      width={48}
      height={48}
      draggable={false}
      className="-m-2 size-12 shrink-0 border-0 bg-transparent object-contain shadow-none outline-none"
    />
  );
}

/** The balance mask. One switch on the board drives every figure it hides. */
function MaskSwitch({ hidden, onToggle }: { hidden: boolean; onToggle: () => void }) {
  return (
    <Switch
      checked={hidden}
      onCheckedChange={onToggle}
      aria-label={hidden ? translate("overview.balance.show") : translate("overview.balance.hide")}
      className="data-[state=checked]:bg-primary data-[state=unchecked]:bg-background/20"
    />
  );
}

/**
 * The live cycle card.
 *
 * It runs its own one-second tick instead of taking the whole cycle state machine from
 * `useMiningCycle`, because a tick owned by this component is what keeps the rest of the board from
 * re-rendering every second. The arithmetic is `liveSnapshot` — the same function the mining page
 * runs, so the two can never disagree — and it is a renderer, not a source of truth: the session
 * comes from the shared query, and only the server decides what is credited.
 *
 * Nothing here polls. The cycle advances locally between reads, so the one request this board makes
 * about mining is the re-read on the tab returning to the foreground, exactly as the mining page
 * triggers it.
 *
 * The earned figure rolls through NumberFlow — the same component the mining page counts with — so
 * the accrual is legible as it moves instead of a digit silently changing once a second.
 */
function MiningCycleCard({
  state,
  className,
}: {
  state: ApiMiningState | undefined;
  className?: string;
}) {
  const session = state?.session ?? null;
  const [tick, setTick] = useState(() => Date.now());
  // The server's clock is the reference: this tab's own clock may be wrong, and the offset is what
  // keeps the countdown in step with the accrual the server last reported.
  const offsetMs = state?.serverNow ? new Date(state.serverNow).getTime() - Date.now() : 0;
  useEffect(() => {
    if (!session) return;
    const id = window.setInterval(() => setTick(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [session]);
  const live = useMemo(
    () => (session ? liveSnapshot(session, tick + offsetMs) : null),
    [session, tick, offsetMs],
  );

  const earned = live ? moneyFromMinorUnits(live.accruedMinor) : "0";
  const maximum = session ? session.totalAccrued : "0";
  const percent = (() => {
    const max = moneyChartValue(maximum);
    if (max <= 0) return 0;
    return Math.min(100, Math.round((moneyChartValue(earned) / max) * 100));
  })();

  return (
    <Link
      to="/mining"
      className={className ? `${FILLED} ${className}` : FILLED}
      aria-label={translate("overview.mining.cardAria")}
    >
      <div className="flex h-full flex-col p-5">
        <p className="font-display text-[22px] leading-none font-bold">
          {session ? (
            <NumberFlow
              value={moneyChartValue(earned)}
              format={{ minimumFractionDigits: 4, maximumFractionDigits: 4 }}
              trend={1}
            />
          ) : (
            "—"
          )}
          <span className="text-[15px] opacity-70"> / {session ? amount(maximum) : "—"}</span>
        </p>
        <p className="mt-1.5 text-[12px] opacity-70">
          {session
            ? translate("overview.mining.progress", {
                number: session.cycleNumber,
                rate: session.rate,
              })
            : translate("overview.mining.none")}
        </p>
        <div className="mt-auto pt-6">
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-[12px] font-semibold opacity-70">
              {translate("overview.mining.completed", { percent })}
            </p>
            {live && (
              <p className="text-[12px] font-semibold tabular-nums opacity-70">
                {translate("overview.mining.remaining", {
                  time: countdown(live.remainingSeconds),
                })}
              </p>
            )}
          </div>
          <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-primary-foreground/25">
            <div
              className="h-full rounded-full bg-primary-foreground transition-[width] duration-1000 ease-linear"
              style={{ width: `${percent}%` }}
            />
          </div>
        </div>
      </div>
    </Link>
  );
}

export function OverviewContent() {
  const t = useT("overview");
  const common = useT("common");
  const { wallet, transactions, security } = useWallet();
  const mining = useQuery({
    queryKey: serverStateKeys.mining,
    queryFn: accountFetchers.mining,
    staleTime: serverStateFreshness.miningMs,
    enabled: hasBrowserSession,
  });
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
  const [balanceHidden, setBalanceHidden] = useState(readBalanceHidden);
  const periods = PERIODS.map((entry) => ({ id: entry.id, label: t(entry.labelKey), days: entry.days }));
  const [periodId, setPeriodId] = useState(PERIODS[1]!.id);
  const period = periods.find((entry) => entry.id === periodId) ?? periods[1]!;
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

  /**
   * The one request this board makes about mining: a re-read when the tab comes back to the
   * foreground, the same trigger the mining page uses. Between reads the cycle card advances on its
   * own clock, so there is nothing to poll and the database is never asked for a clock it has
   * already given us.
   */
  const refetchMining = mining.refetch;
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") void refetchMining();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [refetchMining]);

  /** The window the period-scoped cards describe. Rolling, not calendar months. */
  const range = useMemo(() => {
    const to = Date.now();
    return { from: to - period.days * DAY_MS, to, days: period.days };
  }, [period]);

  /**
   * Walks the shared transactions and mining-history lists, one page at a time, so every card's
   * period totals cover the whole window instead of only the pages already loaded. The pages are
   * appended to the cache every screen reads, so this is not a private copy. The transaction walk
   * stops once it reaches a page older than the window, so a busy wallet's totals are not truncated
   * at a fixed page count; `cap` only bounds a pathological cursor. Only starts once the session is
   * confirmed, and a failure leaves the pages already loaded on screen rather than blanking them.
   */
  useHistoryWalk<TransactionPage>({
    queryKey: serverStateKeys.transactions,
    fetchPage: accountFetchers.transactions,
    nextCursor: (page) => page.nextCursor,
    cap: HISTORY_PAGE_CAP,
    enabled: wallet !== null,
    shouldContinue: (page) => {
      const oldest = page.transactions.at(-1);
      return !oldest || new Date(oldest.createdAt).getTime() >= range.from;
    },
  });
  useHistoryWalk<MiningHistoryPage>({
    queryKey: serverStateKeys.miningHistory,
    fetchPage: accountFetchers.miningHistory,
    nextCursor: (page) => page.nextCursor,
    cap: MINING_HISTORY_PAGE_CAP,
    enabled: wallet !== null,
  });

  /**
   * Each side totals what actually moved: the sender is debited the full amount, while a received
   * transfer credits the net amount (the network tax comes out of it). Summing `amount` on both sides
   * would report a balance that never existed. The counts are here too, because the activity card
   * reports how much happened rather than a second time the same two totals.
   */
  const flow = useMemo(() => {
    const at = (t: Transaction) => new Date(t.createdAt).getTime();
    const side = (from: number, to: number) => {
      const income = transactions.filter(
        (t) => t.direction === "received" && at(t) >= from && at(t) < to,
      );
      const expense = transactions.filter(
        (t) => t.direction === "sent" && at(t) >= from && at(t) < to,
      );
      return {
        income: sumMoney(income.map((t) => t.netAmount)),
        expense: sumMoney(expense.map((t) => t.amount)),
        count: income.length + expense.length,
      };
    };
    const now = side(range.from, range.to);
    const before = side(range.from - range.days * DAY_MS, range.from);
    return { ...now, countBefore: before.count };
  }, [transactions, range]);

  /** The bars behind the statistics card: the window split into equal slices, newest at the right. */
  const slices = useMemo<Slice[]>(() => {
    const span = range.to - range.from;
    const buckets = Array.from({ length: BAR_COUNT }, (): Slice => ({ income: 0, expense: 0 }));
    for (const transaction of transactions) {
      const at = new Date(transaction.createdAt).getTime();
      if (at < range.from || at >= range.to) continue;
      const index = Math.min(BAR_COUNT - 1, Math.floor(((at - range.from) / span) * BAR_COUNT));
      const bucket = buckets[index];
      if (!bucket) continue;
      if (transaction.direction === "received")
        bucket.income += moneyChartValue(transaction.netAmount);
      else bucket.expense += moneyChartValue(transaction.amount);
    }
    return buckets;
  }, [transactions, range]);

  /** The activity feed: the newest transfers, which is a different cut than the period totals. */
  const recent = useMemo(
    () => [...transactions].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [transactions],
  );

  /** Who this wallet actually moves money with, newest contact first, for a one-tap resend. */
  const counterparties = useMemo(() => {
    const seen = new Map<string, Transaction>();
    for (const transaction of recent) {
      if (!seen.has(transaction.counterpartyAddress))
        seen.set(transaction.counterpartyAddress, transaction);
    }
    return [...seen.values()].slice(0, COUNTERPARTY_LIMIT);
  }, [recent]);

  /**
   * The balance is printed once on this board, and nowhere else: a figure repeated across cards
   * reads as three different accounts, and a stale copy is worse than no copy at all.
   */
  const balance = wallet?.balance ?? "0";
  const show = (value: string | number) => (balanceHidden ? "••••••" : amount(value));

  /**
   * Everything mining has already paid out, which is a total and not a live figure. A cycle can
   * carry wallet-credited payouts while still `active` (collecting mid-cycle never closes it),
   * so paid-out means a positive settled amount with a settlement time — not a terminal status.
   */
  const cycles = useMemo(
    () => (history.data?.pages ?? []).flatMap((page) => page.sessions),
    [history.data],
  );
  const settledCycles = cycles.filter((cycle) => cycle.settledMinor > 0 && cycle.lastSettledAt);
  const mined = sumMoney(settledCycles.map((cycle) => cycle.settled));
  const lastSettled = settledCycles[0]?.lastSettledAt ?? null;

  return (
    <div className="grid gap-4 lg:grid-cols-[1.04fr_1fr] lg:grid-rows-[auto_auto_auto]">
      {/* What moved in the period. The only card that reports the two totals themselves. */}
      <section
        className={`${CARD} order-2 flex flex-col gap-6 p-6 sm:flex-row sm:items-end lg:order-none`}
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-display text-[22px] font-semibold">{t("statistics")}</h2>
            <PillSelect
              value={period.id}
              label={t("periodLabel")}
              options={periods}
              onChange={setPeriodId}
            />
          </div>
          <div className="mt-7 flex flex-wrap gap-x-10 gap-y-4">
            <div>
              <p className="flex items-center gap-2 text-[12px] font-semibold text-muted-foreground">
                <span aria-hidden className="size-2 rounded-full bg-chart-2" />
                {t("expenses")}
              </p>
              <p className="mt-1.5 font-display text-[24px] leading-none font-bold tabular-nums">
                {show(flow.expense)}
              </p>
            </div>
            <div>
              <p className="flex items-center gap-2 text-[12px] font-semibold text-muted-foreground">
                <span aria-hidden className="size-2 rounded-full bg-primary" />
                {t("incomes")}
              </p>
              <p className="mt-1.5 font-display text-[24px] leading-none font-bold tabular-nums">
                {show(flow.income)}
              </p>
            </div>
          </div>
        </div>
        <div className="w-full shrink-0 sm:w-[46%]">
          <BarChart slices={slices} />
        </div>
      </section>

      {/* How much happened, and what happened: the count, then the transfers themselves. */}
      <section className={`${CARD} order-4 overflow-hidden lg:order-none lg:row-span-2`}>
        <div className="bg-secondary p-5">
          <div className="flex justify-end">
            <WalletLogo />
          </div>
          <div className="mt-6 flex items-end justify-between gap-3">
            <div>
              <p className="text-[13px] font-semibold text-muted-foreground">
                {t("transfers.label", { period: period.label })}
              </p>
              <p className="mt-1 font-display text-[30px] leading-none font-bold tabular-nums">
                {flow.count}
              </p>
            </div>
            <Change current={flow.count} previous={flow.countBefore} />
          </div>
        </div>
        <ul>
          {recent.slice(0, FEED_ROWS).map((transaction) => {
            const received = transaction.direction === "received";
            return (
              <li key={transaction.id} className="border-b last:border-b-0">
                <Link
                  to="/transactions/$transferId"
                  params={{ transferId: transaction.transferId }}
                  className="flex items-center gap-3 px-5 py-3.5 transition-colors hover:bg-secondary/60"
                >
                  <span
                    className={`grid size-9 shrink-0 place-items-center rounded-[12px] ${
                      received ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
                    }`}
                  >
                    <Icon icon={received ? ArrowDownLeft01Icon : ArrowUpRight01Icon} size={16} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-bold">
                      {transaction.note || shortAddress(transaction.counterpartyAddress)}
                    </span>
                    <span className="block truncate text-[11px] text-muted-foreground">
                      {received ? common("direction.received") : common("direction.sent")}
                      {" · "}
                      {relativeTime(transaction.createdAt)}
                    </span>
                  </span>
                  <span className="shrink-0 text-[13px] font-bold tabular-nums">
                    {show(received ? transaction.netAmount : transaction.amount)}
                  </span>
                </Link>
              </li>
            );
          })}
          {recent.length === 0 && (
            <li className="px-5 py-8 text-center text-[13px] text-muted-foreground">
              {t("transfers.empty")}
            </li>
          )}
        </ul>
      </section>

      {/* The balance — the board's one dark card, and the number the eye lands on first.
          On a phone it comes first (see the order utilities): the bento pairs only exist to arrange
          the desktop grid, and the mobile column should open on the money, not on the charts. */}
      <div className="contents gap-4 sm:grid sm:grid-cols-2">
        <section className={`${INK} order-1 sm:order-none`}>
          <div className="flex h-full flex-col justify-between p-5">
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-3">
                <WalletLogo />
                <span className="text-[12px] font-semibold tracking-wide opacity-70">
                  {t("balance.available")}
                </span>
              </span>
              <MaskSwitch hidden={balanceHidden} onToggle={toggleBalanceHidden} />
            </div>
            <div className="mt-6 sm:mt-8">
              <p className="font-display text-[26px] leading-none font-bold tabular-nums sm:text-[30px]">
                {show(balance)}
              </p>
              <p className="mt-2.5 text-[11px] tracking-wide opacity-70">
                LMA ·{" "}
                {security?.wallet.status === "frozen"
                  ? t("balance.frozen")
                  : t("balance.ready")}
              </p>
              {/* The address lives here and nowhere else: once, with the copy that makes it usable. */}
              <div className="mt-2 flex min-w-0 items-center gap-1">
                <code className="truncate text-[11px] opacity-70">
                  {wallet?.address ? shortAddress(wallet.address) : "—"}
                </code>
                {wallet?.address && (
                  <div className="[&>button]:size-6 [&>button]:shrink-0 [&>button]:text-background/70 [&>button:hover]:bg-background/10 [&>button:hover]:text-background">
                    <CopyButton text={wallet.address} />
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* The live cycle, and how much of its window is still left to earn. */}
        <MiningCycleCard state={mining.data} className="order-3 sm:order-none" />
      </div>

      {/* The people this wallet moves money with, and the two ways to move it. */}
      <section
        className={`${CARD} order-5 flex flex-wrap items-center justify-between gap-5 p-5 lg:order-none`}
      >
        <div className="min-w-0">
          <p className="text-[12px] font-semibold text-muted-foreground">{t("quickSend.label")}</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Link
              to="/transfer"
              aria-label={t("quickSend.newTransfer")}
              className="grid size-10 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground transition-transform hover:scale-105"
            >
              <Icon icon={Add01Icon} size={18} />
            </Link>
            {counterparties.length ? (
              counterparties.map((transaction) => (
                <Link
                  key={transaction.counterpartyAddress}
                  to="/transfer"
                  onClick={() => prefillTransfer(transaction.counterpartyAddress)}
                  title={transaction.counterpartyAddress}
                  className="grid size-10 shrink-0 place-items-center rounded-full bg-secondary text-[12px] font-bold transition-transform hover:scale-105"
                >
                  {initials(transaction.counterpartyAddress)}
                </Link>
              ))
            ) : (
              <p className="text-[13px] text-muted-foreground">{t("quickSend.none")}</p>
            )}
          </div>
        </div>
        <div className="flex shrink-0 flex-col gap-3">
          <Link
            to="/wallet"
            className="flex items-center gap-2 rounded-2xl bg-secondary px-5 py-3.5 text-[13px] font-bold tracking-wide text-secondary-foreground transition-colors hover:bg-secondary/80"
          >
            {t("quickSend.receive")}
            <Icon icon={ArrowDownLeft01Icon} size={16} />
          </Link>
          <Link
            to="/transfer"
            className="flex items-center gap-2 rounded-2xl bg-primary px-5 py-3.5 text-[13px] font-bold tracking-wide text-primary-foreground transition-transform hover:scale-[1.02]"
          >
            {t("quickSend.transfer")}
            <Icon icon={ArrowUpRight01Icon} size={16} />
          </Link>
        </div>
      </section>

      {/* What mining has already paid, and what protects the account holding it. */}
      <div className="contents gap-4 sm:grid sm:grid-cols-2">
        <section className={`${CARD} order-6 flex flex-col justify-between p-5 sm:order-none`}>
          <div className="flex justify-end">
            <WalletLogo />
          </div>
          <div className="mt-8">
            <p className="text-[12px] font-semibold text-muted-foreground">
              {t("mined.label", {
                count: settledCycles.length,
                unit:
                  settledCycles.length === 1
                    ? common("units.cycleOne")
                    : common("units.cycleOther"),
              })}
            </p>
            <p className="mt-1 font-display text-[26px] leading-none font-bold tabular-nums">
              {show(mined)}
            </p>
            <p className="mt-2 text-[11px] text-muted-foreground">
              {lastSettled
                ? t("mined.lastCollected", { time: relativeTime(lastSettled) })
                : t("mined.nothingCollected")}
            </p>
          </div>
        </section>

        {/* The account itself: what protects it and how many devices hold a session on it. */}
        <section className={`${CARD} order-7 flex flex-col p-5 sm:order-none`}>
          <p className="text-[12px] font-semibold text-muted-foreground">{t("account.label")}</p>
          <dl className="mt-3 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <dt className="text-[12px] text-muted-foreground">{t("account.twoFactor")}</dt>
              <dd
                className={`text-[13px] font-semibold ${
                  security?.twoFactor.enabled ? "text-success" : "text-destructive"
                }`}
              >
                {security?.twoFactor.enabled ? common("state.on") : common("state.off")}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-2">
              <dt className="text-[12px] text-muted-foreground">{t("account.sessions")}</dt>
              <dd className="text-[13px] font-semibold tabular-nums">
                {security?.activeSessions ?? "—"}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-2">
              <dt className="text-[12px] text-muted-foreground">{t("account.wallet")}</dt>
              <dd
                className={`text-[13px] font-semibold ${
                  security?.wallet.status === "frozen" ? "text-destructive" : "text-success"
                }`}
              >
                {security?.wallet.status === "frozen"
                  ? common("state.frozen")
                  : common("state.active")}
              </dd>
            </div>
          </dl>
          <Link
            to="/security"
            className="mt-auto inline-flex items-center gap-1.5 pt-4 text-[13px] font-semibold text-primary-soft"
          >
            {t("account.securityCenter")}
            <Icon icon={ArrowRight01Icon} size={14} />
          </Link>
        </section>
      </div>
    </div>
  );
}
