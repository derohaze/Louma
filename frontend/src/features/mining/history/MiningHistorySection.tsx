import { useEffect, useMemo, useState } from "react";
import { useInfiniteQuery, type InfiniteData } from "@tanstack/react-query";
import { useProAccess, useHistoryWalk, useWallet } from "@/shared/hooks";
import { Button } from "@/shared/ui/button";
import { EmptyState } from "@/shared/ui/page";
import { useT } from "@/shared/i18n";
import { messageForError } from "@/shared/api";
import { availableHistoryDays, maximumHistoryDays } from "@/shared/lib/platform";
import {
  accountFetchers,
  hasBrowserSession,
  serverStateFreshness,
  serverStateKeys,
  type MiningHistoryPage,
} from "@/shared/lib/platform";
import { currency, dateText, moneyFromMinorUnits } from "@/shared/lib/wallet";
import { cn } from "@/shared/lib/platform";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui/select";

const HISTORY_RANGES = [
  { id: "1", days: 1, labelKey: "range.last1" },
  { id: "7", days: 7, labelKey: "range.last7" },
  { id: "30", days: 30, labelKey: "range.last30" },
  { id: "90", days: 90, labelKey: "range.last90" },
  { id: "120", days: 120, labelKey: "range.last120" },
] as const;

/**
 * Past cycles plus the totals that make mining feel worth it: what was
 * collected, how many cycles ran, and the average rate. Reads the existing
 * cursor-paged history endpoint from the shared account cache, so the page shell
 * can wait for the same request before showing any of its content.
 */
export function MiningHistorySection() {
  const t = useT("mining.history");
  const common = useT("common");
  const { wallet } = useWallet();
  const isPro = useProAccess();
  const allowedDays = availableHistoryDays(isPro);
  const historyDays = maximumHistoryDays(isPro);
  const ranges = HISTORY_RANGES.filter((range) => allowedDays.includes(range.days));
  const [rangeId, setRangeId] = useState("30");
  const range = ranges.find((item) => item.id === rangeId) ?? HISTORY_RANGES[2]!;
  useEffect(() => {
    if (!ranges.some((item) => item.id === rangeId)) setRangeId("30");
  }, [rangeId, ranges]);
  const queryKey = useMemo(() => serverStateKeys.miningHistory(historyDays), [historyDays]);
  const history = useInfiniteQuery<
    MiningHistoryPage,
    Error,
    InfiniteData<MiningHistoryPage, string | null>,
    typeof queryKey,
    string | null
  >({
    queryKey,
    queryFn: ({ pageParam }) => accountFetchers.miningHistory(pageParam, historyDays),
    initialPageParam: null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    staleTime: serverStateFreshness.dashboardHistoryMs,
    enabled: hasBrowserSession && wallet !== null,
  });
  useHistoryWalk<MiningHistoryPage>({
    queryKey,
    fetchPage: (cursor) => accountFetchers.miningHistory(cursor, historyDays),
    nextCursor: (page) => page.nextCursor,
    cap: 20,
    enabled: wallet !== null,
  });
  const window = useMemo(() => {
    const to = Date.now();
    return { from: to - range.days * 24 * 60 * 60 * 1000, to };
  }, [range.days]);
  const sessions = useMemo(
    () =>
      (history.data?.pages ?? [])
        .flatMap((page) => page.sessions)
        .filter((session) => {
          const startedAt = new Date(session.startedAt).getTime();
          return startedAt >= window.from && startedAt < window.to;
        }),
    [history.data, window],
  );
  const cursor = history.data?.pages.at(-1)?.nextCursor ?? null;
  const loading = history.isPending && !history.data;
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const loadOlder = async () => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    setError("");
    try {
      await history.fetchNextPage({ throwOnError: true });
    } catch (cause) {
      setError(messageForError(cause));
    } finally {
      setLoadingMore(false);
    }
  };

  const collectedMinor = sessions.reduce((sum, item) => sum + item.settledMinor, 0);
  let collected = "0.0000 LMA";
  try {
    collected = currency(moneyFromMinorUnits(collectedMinor));
  } catch {
    // A total past the safe-integer range still renders as zero rather than blanking the section.
  }
  const avgRate = sessions.length
    ? sessions.reduce((sum, item) => sum + (Number(item.rate) || 0), 0) / sessions.length
    : 0;

  return (
    <section className="card-enter mt-4 overflow-hidden rounded-[22px] border bg-card shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b px-5 py-4">
        <div>
          <h2 className="font-display text-base font-semibold">{t("heading")}</h2>
          <p className="mt-1 text-xs text-muted-foreground">{t("headingNote")}</p>
        </div>
        <Select value={rangeId} onValueChange={setRangeId}>
          <SelectTrigger
            aria-label={t("range.label")}
            className="h-8 w-auto gap-1 rounded-full px-3 text-xs font-semibold"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ranges.map((option) => (
              <SelectItem key={option.id} value={option.id}>
                {t(option.labelKey)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {loading ? (
        <p className="px-5 py-8 text-center text-sm text-muted-foreground">{t("loading")}</p>
      ) : sessions.length === 0 ? (
        <EmptyState title={t("empty.title")} detail={t("empty.detail")} />
      ) : (
        <>
          <div className="grid gap-px border-b bg-border sm:grid-cols-3">
            {[
              [t("stats.collected"), collected],
              [t("stats.cycles"), cursor ? `${sessions.length}+` : String(sessions.length)],
              [t("stats.averageRate"), `${avgRate.toFixed(4)} LMA / hour`],
            ].map(([label, value]) => (
              <div key={label} className="bg-card px-5 py-4">
                <p className="text-xs text-muted-foreground">{label}</p>
                <strong className="mt-1 block font-display text-lg tabular-nums">{value}</strong>
              </div>
            ))}
          </div>
          {sessions.map((item, row) => (
            <div
              key={item.id}
              style={{ animationDelay: `${Math.min(row * 45, 360)}ms` }}
              className="list-enter flex flex-wrap items-center gap-3 border-b px-5 py-4 last:border-0"
            >
              <span
                className={cn(
                  "rounded-full px-2.5 py-0.5 text-[11px] font-semibold",
                  item.status === "settled" && "bg-success/10 text-success",
                  item.status === "completed" && "bg-warning/15 text-amber-600 dark:text-amber-400",
                  item.status === "active" && "bg-primary/10 text-primary-soft",
                )}
              >
                {item.status === "active"
                  ? t("status.active")
                  : item.status === "completed"
                    ? t("status.completed")
                    : t("status.settled")}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">{t("cycle", { number: item.cycleNumber })}</p>
                <p className="text-xs text-muted-foreground">
                  {t("cycleMeta", { rate: item.rate, date: dateText(item.endsAt) })}
                </p>
              </div>
              <div className="text-end">
                <strong className="block text-sm tabular-nums">+{currency(item.settled)}</strong>
                <span className="text-xs text-muted-foreground">
                  {t("earned", { amount: currency(item.accrued) })}
                </span>
              </div>
            </div>
          ))}
        </>
      )}
      {(error || history.error) && (
        <p className="px-5 py-3 text-xs text-destructive">
          {error || messageForError(history.error)}
        </p>
      )}
      {cursor && (
        <div className="px-5 py-4">
          <Button variant="outline" disabled={loadingMore} onClick={loadOlder}>
            {loadingMore ? common("actions.loading") : t("loadOlder")}
          </Button>
        </div>
      )}
    </section>
  );
}
