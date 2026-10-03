import { useEffect, useState } from "react";
import { Button } from "@/shared/ui/button";
import { EmptyState } from "@/shared/ui/page";
import { useT } from "@/shared/i18n";
import { messageForError, type ApiMiningSession } from "@/shared/api";
import { accountFetchers } from "@/shared/lib/platform";
import { currency, dateText, moneyFromMinorUnits } from "@/shared/lib/wallet";
import { cn } from "@/shared/lib/platform";

/**
 * Past cycles plus the totals that make mining feel worth it: what was
 * collected, how many cycles ran, and the average rate. Reads the existing
 * cursor-paged history endpoint directly — the wallet cache has no reason to
 * hold a list only this section renders.
 */
export function MiningHistorySection() {
  const t = useT("mining.history");
  const common = useT("common");
  const [sessions, setSessions] = useState<ApiMiningSession[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    accountFetchers
      .miningHistory(null)
      .then((page) => {
        if (!active) return;
        setSessions(page.sessions);
        setCursor(page.nextCursor);
      })
      .catch((cause: unknown) => {
        if (active) setError(messageForError(cause));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const loadOlder = () => {
    if (!cursor) return;
    setLoadingMore(true);
    setError("");
    accountFetchers
      .miningHistory(cursor)
      .then((page) => {
        setSessions((current) => [...current, ...page.sessions]);
        setCursor(page.nextCursor);
      })
      .catch((cause: unknown) => setError(messageForError(cause)))
      .finally(() => setLoadingMore(false));
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
      <div className="border-b px-5 py-4">
        <h2 className="font-display text-base font-semibold">{t("heading")}</h2>
        <p className="mt-1 text-xs text-muted-foreground">{t("headingNote")}</p>
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
                <p className="text-sm font-semibold">
                  {t("cycle", { number: item.cycleNumber })}
                </p>
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
      {error && <p className="px-5 py-3 text-xs text-destructive">{error}</p>}
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
