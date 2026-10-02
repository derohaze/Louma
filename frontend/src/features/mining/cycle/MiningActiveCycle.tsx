import NumberFlow from "@number-flow/react";
import { BitcoinCpuIcon, Coins01Icon } from "@hugeicons/core-free-icons";
import { Button } from "@/shared/ui/button";
import { Icon } from "@/shared/ui/page";
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
                ? "Mining"
                : session.status === "completed"
                  ? "Cycle complete"
                  : "Cycle settled"}
            </p>
            <p className="mt-1 font-display text-4xl font-bold tabular-nums">
              {countdown(remaining)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {session.status === "active" ? "remaining" : "window closed"}
            </p>
          </div>
          <MiningOrb
            state={session.status === "active" || needsCollection ? "composing" : "shaping"}
            size={120}
            label={
              needsCollection
                ? "Mining reward ready to collect"
                : session.status === "active"
                  ? "Mining cycle hashing"
                  : "Mining cycle settled"
            }
            caption={
              needsCollection
                ? "Reward ready"
                : session.status === "active"
                  ? "Hashing…"
                  : "Settled"
            }
          />
          <div className="text-end">
            <p className="text-xs text-muted-foreground">Earned this cycle</p>
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
                {currency(session.settled)} already collected
              </p>
            )}
          </div>
        </div>

        <div className="mt-6">
          <div
            role="progressbar"
            aria-label="Mining cycle progress"
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
            <span>{countdown(live?.elapsedSeconds ?? session.elapsedSeconds)} elapsed</span>
            <span>24:00:00 cycle</span>
          </div>
        </div>

        <div className="mt-6 border-t pt-5">
          <FactList
            items={[
              ["Mining rate", rateText],
              ...((poolName ? [["Pool", poolName]] : []) as [string, string][]),
              ["Cycle", `#${session.cycleNumber} · started ${dateText(session.startedAt)}`],
              ["Window ends", dateText(session.endsAt)],
              ["Maximum this cycle", currency(session.totalAccrued)],
            ]}
          />
        </div>

        {needsCollection && session.canSettle && (
          <div className="mt-5">
            <MiningBusyButton
              label="Collect reward"
              icon={Coins01Icon}
              busy={busy === "settle"}
              onAction={collect}
              disabled={busy !== null}
              busyLabel="Collecting reward"
            />
          </div>
        )}
        {needsCollection && !session.canSettle && (
          <p className="mt-5 text-sm text-muted-foreground">
            Settlement is paused on this network, so collection is unavailable right now. Your
            earned reward stays on your account and nothing is lost.
          </p>
        )}
        {!needsCollection && session.status !== "active" && (
          <p className="mt-5 text-sm text-muted-foreground">
            This cycle is fully collected. Start a new one to keep mining.
          </p>
        )}
        {!actionsEnabled && (
          <p className="mt-5 text-sm text-muted-foreground">
            Mining is paused on this network, so actions are unavailable. Your earned reward stays
            on your account and nothing is lost.
          </p>
        )}
        {actionsEnabled && mining.data?.canStart && session.status !== "active" && (
          <div className="mt-5">
            <Button onClick={() => void start()} disabled={busy !== null}>
              <Icon icon={BitcoinCpuIcon} size={17} />
              {busy === "start" ? "Starting…" : "Start next cycle"}
            </Button>
          </div>
        )}
        {!needsCollection && session.status === "active" && (
          <div className="mt-5">
            <MiningBusyButton
              label="Collect reward"
              icon={Coins01Icon}
              busy={busy === "settle"}
              onAction={collect}
              disabled={busy !== null || !needsCollection}
              busyLabel="Collecting reward"
            />
          </div>
        )}
      </section>

      <div className="grid gap-4">
        <section className="rounded-[22px] border bg-card p-5 shadow-sm">
          <p className="text-sm text-muted-foreground">Mining rate</p>
          <p className="mt-3 font-display text-xl font-bold tabular-nums">{rateText}</p>
          <p className="mt-3 text-xs text-muted-foreground">
            Drawn by the server for this cycle and fixed until it ends.
          </p>
        </section>
        {session.status === "active" ? <MiningLiveLog events={feed} /> : <MiningInfoCard />}
      </div>
    </div>
  );
}
