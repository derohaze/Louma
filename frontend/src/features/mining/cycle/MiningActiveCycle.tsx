import NumberFlow from "@number-flow/react";
import { BitcoinCpuIcon, Coins01Icon } from "@hugeicons/core-free-icons";
import { Button } from "@/shared/ui/button";
import { Icon } from "@/shared/ui/page";
import { useT } from "@/shared/i18n";
import { FactList } from "@/shared/ui/panels";
import { MONEY_SCALE, currency, dateText } from "@/shared/lib/wallet";
import { MiningOrb } from "@/features/mining/live/MiningOrb";
import { MiningLiveLog } from "@/features/mining/live/MiningLiveLog";
import { MiningBusyButton } from "@/features/mining/cycle/MiningBusyButton";
import { MiningInfoCard } from "@/features/mining/cycle/MiningReadyPanel";
import { countdown } from "@/features/mining/cycle/mining-format";
import type { MiningCycle } from "@/features/mining/cycle/useMiningCycle";

/** The running (or collectable) cycle: countdown, earnings, progress, and collect actions. */
export function MiningActiveCycle({ cycle }: { cycle: MiningCycle }) {
  const t = useT("mining.cycle");
  /** The action labels live with the page, because the header renders the same buttons. */
  const page = useT("mining.page");
  const {
    session,
    mining,
    live,
    feed,
    busy,
    needsCollection,
    actionsEnabled,
    rateText,
    remaining,
    accruedMinor,
    progressPercent,
    poolName,
    start,
    collect,
  } = cycle;
  if (!session) return null;
  return (
    <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
      <section className="rounded-[22px] border bg-card p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {session.status === "active"
                ? t("active.statusActive")
                : session.status === "completed"
                  ? t("active.statusCompleted")
                  : t("active.statusSettled")}
            </p>
            <p className="mt-1 font-display text-4xl font-bold tabular-nums">
              {countdown(remaining)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {session.status === "active" ? t("active.remaining") : t("active.windowClosed")}
            </p>
          </div>
          <MiningOrb
            state={session.status === "active" || needsCollection ? "composing" : "shaping"}
            size={120}
            label={
              needsCollection
                ? t("active.orb.ready")
                : session.status === "active"
                  ? t("active.orb.hashing")
                  : t("active.orb.settled")
            }
            caption={
              needsCollection
                ? t("active.captions.ready")
                : session.status === "active"
                  ? t("active.captions.hashing")
                  : t("active.captions.settled")
            }
          />
          <div className="text-end">
            <p className="text-xs text-muted-foreground">{t("active.earned")}</p>
            <p className="mt-1 font-display text-2xl font-bold tabular-nums">
              <NumberFlow
                className="earned-number"
                value={accruedMinor / MONEY_SCALE}
                format={{ minimumFractionDigits: 4, maximumFractionDigits: 4 }}
                suffix=" LMA"
                trend={1}
              />
            </p>
            {session.settledMinor > 0 && (
              <p className="mt-1 text-xs text-muted-foreground">
                {t("active.alreadyCollected", { amount: currency(session.settled) })}
              </p>
            )}
          </div>
        </div>

        <div className="mt-6">
          <div
            role="progressbar"
            aria-label={t("active.progressAria")}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(progressPercent)}
            className="h-2.5 w-full overflow-hidden rounded-full bg-secondary"
          >
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-1000 ease-linear"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
          <div className="mt-2 flex justify-between text-xs text-muted-foreground">
            <span>
              {t("active.elapsed", {
                time: countdown(live?.elapsedSeconds ?? session.elapsedSeconds),
              })}
            </span>
            <span>{t("active.window")}</span>
          </div>
        </div>

        <div className="mt-6 border-t pt-5">
          <FactList
            items={[
              [t("active.facts.rate"), rateText],
              ...((poolName
                ? [[t("active.facts.pool"), poolName]]
                : []) as [string, string][]),
              [
                t("active.facts.cycle"),
                t("active.facts.cycleValue", {
                  number: session.cycleNumber,
                  date: dateText(session.startedAt),
                }),
              ],
              [t("active.facts.windowEnds"), dateText(session.endsAt)],
              [t("active.facts.maximum"), currency(session.totalAccrued)],
            ]}
          />
        </div>

        {needsCollection && session.canSettle && (
          <div className="mt-5">
            <MiningBusyButton
              label={page("actions.collect")}
              icon={Coins01Icon}
              busy={busy === "settle"}
              onAction={collect}
              disabled={busy !== null}
              busyLabel={page("actions.collectBusy")}
            />
          </div>
        )}
        {needsCollection && !session.canSettle && (
          <p className="mt-5 text-sm text-muted-foreground">{t("active.settlementPaused")}</p>
        )}
        {!needsCollection && session.status !== "active" && (
          <p className="mt-5 text-sm text-muted-foreground">{t("active.fullyCollected")}</p>
        )}
        {!actionsEnabled && (
          <p className="mt-5 text-sm text-muted-foreground">{t("active.miningPaused")}</p>
        )}
        {actionsEnabled && mining.data?.canStart && session.status !== "active" && (
          <div className="mt-5">
            <Button onClick={() => void start()} disabled={busy !== null}>
              <Icon icon={BitcoinCpuIcon} size={17} />
              {busy === "start" ? t("active.starting") : page("actions.startNext")}
            </Button>
          </div>
        )}
        {!needsCollection && session.status === "active" && (
          <div className="mt-5">
            <MiningBusyButton
              label={page("actions.collect")}
              icon={Coins01Icon}
              busy={busy === "settle"}
              onAction={collect}
              disabled={busy !== null || !needsCollection}
              busyLabel={page("actions.collectBusy")}
            />
          </div>
        )}
      </section>

      <div className="grid gap-4">
        <section className="rounded-[22px] border bg-card p-5 shadow-sm">
          <p className="text-sm text-muted-foreground">{t("active.rateCard")}</p>
          <p className="mt-3 font-display text-xl font-bold tabular-nums">{rateText}</p>
          <p className="mt-3 text-xs text-muted-foreground">{t("active.rateNote")}</p>
        </section>
        {session.status === "active" ? <MiningLiveLog events={feed} /> : <MiningInfoCard />}
      </div>
    </div>
  );
}
