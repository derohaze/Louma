import NumberFlow from "@number-flow/react";
import { Coins01Icon, StopCircleIcon } from "@hugeicons/core-free-icons";
import { useT } from "@/shared/i18n";
import { FactList } from "@/shared/ui/panels";
import { MONEY_SCALE, currency, dateText } from "@/shared/lib/wallet";
import { MiningOrb } from "@/features/mining/live/MiningOrb";
import { MiningLiveLog } from "@/features/mining/live/MiningLiveLog";
import { MiningBusyButton } from "@/features/mining/cycle/MiningBusyButton";
import { MiningInfoCard } from "@/features/mining/cycle/MiningReadyPanel";
import { countdown } from "@/features/mining/cycle/mining-format";
import { revealDelay } from "@/shared/ui/page";
import type { MiningCycle } from "@/features/mining/cycle/useMiningCycle";

/** The running (or collectable) cycle: countdown, earnings, progress, and collect actions. */
export function MiningActiveCycle({ cycle }: { cycle: MiningCycle }) {
  const t = useT("mining.cycle");
  /** The action labels live with the page, because the header renders the same buttons. */
  const page = useT("mining.page");
  const {
    session,
    live,
    feed,
    busy,
    needsCollection,
    actionsEnabled,
    rateText,
    remaining,
    accruedMinor,
    quotaWindow,
    poolName,
    collect,
    stop,
  } = cycle;
  if (!session) return null;
  /**
   * Ends the running segment before its window closes. Stopping is not a cancel: what accrued is
   * collected and the hours left in the window stay spendable on the next cycle, so the action is
   * offered whenever a cycle is still running and never while another request is in flight.
   */
  const stopButton = (
    <MiningBusyButton
      label={page("actions.stop")}
      icon={StopCircleIcon}
      busy={busy === "stop"}
      onAction={stop}
      disabled={busy !== null}
      busyLabel={page("actions.stopBusy")}
    />
  );
  return (
    <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
      <section
        style={revealDelay(0)}
        className="card-enter rounded-[22px] border bg-card p-5 shadow-sm"
      >
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
            state={session.status === "active" || needsCollection ? "composing" : "working"}
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
            aria-valuenow={Math.round(quotaWindow?.progressPercent ?? 0)}
            className="h-2.5 w-full overflow-hidden rounded-full bg-secondary"
          >
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-1000 ease-linear"
              style={{ width: `${quotaWindow?.progressPercent ?? 0}%` }}
            />
          </div>
          {/**
           * The bar carries the *window*, not the segment: the big countdown above is this cycle's
           * own remaining time, while this is the limiting account/device allowance — used across
           * cycles and accounts on the device, read back from the server — so it never restarts at zero
           * when a page is reopened or a cycle is stopped and resumed.
           */}
          <div className="mt-2 flex flex-wrap justify-between gap-x-4 text-xs text-muted-foreground">
            <span>
              {t("active.minedThisWindow", {
                time: countdown(quotaWindow?.minedSeconds ?? 0),
              })}
            </span>
            <span>
              {t("active.windowRemaining", {
                time: countdown(quotaWindow?.remainingSeconds ?? 0),
                max: countdown(quotaWindow?.dailyQuotaSeconds ?? 0),
              })}
            </span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {t("active.currentSession", {
              time: countdown(live?.elapsedSeconds ?? session.elapsedSeconds),
            })}
          </p>
        </div>

        <div className="mt-6 border-t pt-5">
          <FactList
            items={[
              [t("active.facts.rate"), rateText],
              ...((poolName ? [[t("active.facts.pool"), poolName]] : []) as [string, string][]),
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
          <div className="mt-5 flex flex-wrap gap-2">
            <MiningBusyButton
              label={page("actions.collect")}
              icon={Coins01Icon}
              busy={busy === "settle"}
              onAction={collect}
              disabled={busy !== null}
              busyLabel={page("actions.collectBusy")}
            />
            {session.status === "active" && stopButton}
          </div>
        )}
        {needsCollection && !session.canSettle && (
          <p className="mt-5 text-sm text-muted-foreground">{t("active.settlementPaused")}</p>
        )}
        {!actionsEnabled && (
          <p className="mt-5 text-sm text-muted-foreground">{t("active.miningPaused")}</p>
        )}
        {/* A running cycle with nothing accrued has nothing to collect: end it, hand back the window. */}
        {!needsCollection && session.status === "active" && (
          <div className="mt-5">{stopButton}</div>
        )}
      </section>

      <div className="grid gap-4">
        <section
          style={revealDelay(1)}
          className="card-enter rounded-[22px] border bg-card p-5 shadow-sm"
        >
          <p className="text-sm text-muted-foreground">{t("active.rateCard")}</p>
          <p className="mt-3 font-display text-xl font-bold tabular-nums">{rateText}</p>
          <p className="mt-3 text-xs text-muted-foreground">{t("active.rateNote")}</p>
        </section>
        {session.status === "active" ? (
          <div style={revealDelay(2)} className="card-enter">
            <MiningLiveLog events={feed} />
          </div>
        ) : (
          <MiningInfoCard delayMs={150} />
        )}
      </div>
    </div>
  );
}
