import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChartIncreaseIcon,
  Coins01Icon,
  Mining01Icon,
  Timer01Icon,
} from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import { useWallet } from "@/hooks/wallet-context";
import { api, messageForError, type ApiMiningSession, type ApiMiningState } from "@/lib/api";
import {
  accountFetchers,
  hasBrowserSession,
  serverStateFreshness,
  serverStateKeys,
} from "@/lib/server-state";
import { MONEY_SCALE, currency, dateText, moneyFromMinorUnits } from "@/lib/wallet-format";
import { EmptyState, Icon, PageHeader } from "./wallet-shell";
import { FactList, FormMessage, Panel } from "./security-ui";

const SECONDS_PER_HOUR = 3600n;

/**
 * The live numbers the page paints between server reads.
 *
 * This mirrors the server's arithmetic exactly — the same integer rate, the same floored elapsed
 * seconds, the same floor division — but it is a *renderer*, not a source of truth: the authoritative
 * numbers arrive with every state read, the clock is offset by the server's own answer, and nothing
 * computed here is ever sent back as an amount. A tampered tab can therefore drag its own display
 * around and change nothing about what the account earns.
 */
function liveSnapshot(session: ApiMiningSession, serverNowMs: number) {
  const startedAtMs = new Date(session.startedAt).getTime();
  const endsAtMs = new Date(session.endsAt).getTime();
  const effectiveNow = Math.min(serverNowMs, endsAtMs);
  const elapsedSeconds = Math.max(
    0,
    Math.min(Math.floor((effectiveNow - startedAtMs) / 1000), session.durationSeconds),
  );
  const accruedMinor = Number(
    (BigInt(session.rateUnits) * BigInt(MONEY_SCALE) * BigInt(elapsedSeconds)) /
      (BigInt(session.rateScale) * SECONDS_PER_HOUR),
  );
  return {
    elapsedSeconds,
    remainingSeconds: Math.max(0, session.durationSeconds - elapsedSeconds),
    accruedMinor,
    completed: serverNowMs >= endsAtMs,
  };
}

function countdown(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map((part) => String(part).padStart(2, "0")).join(":");
}

export function MiningContent() {
  const { refresh } = useWallet();
  const queryClient = useQueryClient();

  /**
   * One read of the authoritative state. The query cache carries it across navigation, and the
   * page re-reads on mount, when the tab returns to the foreground, and after any action — never on
   * a short poll, because the counter advances locally from the server's own clock.
   */
  const mining = useQuery<ApiMiningState>({
    queryKey: serverStateKeys.mining,
    queryFn: accountFetchers.mining,
    staleTime: serverStateFreshness.miningMs,
    enabled: hasBrowserSession,
  });

  const [clockOffsetMs, setClockOffsetMs] = useState(0);
  const [tick, setTick] = useState(() => Date.now());
  const [busy, setBusy] = useState<"start" | "settle" | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  /** Cycles whose completion the page has already asked to settle, so it asks exactly once each. */
  const settleRequested = useRef<Set<string>>(new Set());

  // The server's clock is the reference: the tab's own clock may be wrong, and the offset is what
  // lets the countdown agree with the accrual the server reported.
  useEffect(() => {
    const serverNow = mining.data?.serverNow;
    if (serverNow) setClockOffsetMs(new Date(serverNow).getTime() - Date.now());
  }, [mining.data]);

  // One interval for the whole page, and only while a cycle is on screen.
  useEffect(() => {
    if (!mining.data?.session) return;
    const id = window.setInterval(() => setTick(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [mining.data?.session]);

  const refetch = mining.refetch;
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") void refetch();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [refetch]);

  const session = mining.data?.session ?? null;
  const serverNowMs = tick + clockOffsetMs;
  const live = useMemo(
    () => (session ? liveSnapshot(session, serverNowMs) : null),
    [session, serverNowMs],
  );

  const settle = useCallback(async () => {
    try {
      setError("");
      await api.post("/api/v1/mining/settle");
      await queryClient.invalidateQueries({ queryKey: serverStateKeys.mining });
      // A settlement moves the wallet balance, so the balance shown elsewhere has to be re-read.
      await refresh();
    } catch (cause) {
      setError(messageForError(cause));
    }
  }, [queryClient, refresh]);

  /**
   * A finished cycle collects itself once. It is not polling: this fires when the local countdown
   * reaches the end of a cycle the server already described, and the server credits only what the
   * 24-hour window actually accrued.
   */
  useEffect(() => {
    if (!session || !live) return;
    if (!live.completed || session.status === "settled") return;
    if (session.settledMinor >= live.accruedMinor) return;
    if (settleRequested.current.has(session.id)) return;
    settleRequested.current.add(session.id);
    void settle();
  }, [session, live, settle]);

  const start = async () => {
    setBusy("start");
    setError("");
    setMessage("");
    try {
      await api.post("/api/v1/mining/start");
      setMessage("Mining started. Your rate is locked for the next 24 hours.");
      await queryClient.invalidateQueries({ queryKey: serverStateKeys.mining });
      await refresh();
    } catch (cause) {
      setError(messageForError(cause));
    } finally {
      setBusy(null);
    }
  };

  const collect = async () => {
    setBusy("settle");
    setError("");
    setMessage("");
    try {
      await settle();
      setMessage("Reward collected into your wallet.");
    } finally {
      setBusy(null);
    }
  };

  if (mining.data && !mining.data.enabled) {
    return (
      <>
        <PageHeader title="Mining" subtitle="Earn LMA by mining a 24-hour cycle." />
        <EmptyState
          title="Mining is unavailable"
          detail="Mining is temporarily switched off on this network. Your wallet is unaffected."
        />
      </>
    );
  }

  const loading = mining.isPending && !mining.data;
  const rateText = session ? `${session.rate} LMA / hour` : "—";
  const remaining = live?.remainingSeconds ?? session?.remainingSeconds ?? 0;
  const accruedMinor = live?.accruedMinor ?? session?.accruedMinor ?? 0;
  const progressPercent =
    session && live ? Math.min(100, (live.elapsedSeconds / session.durationSeconds) * 100) : 0;
  const needsCollection = session ? session.settledMinor < accruedMinor : false;

  return (
    <>
      <PageHeader
        title="Mining"
        subtitle="A 24-hour cycle at a rate chosen for your account by the server."
        action={
          session ? (
            <Button onClick={() => void collect()} disabled={busy !== null || !needsCollection}>
              <Icon icon={Coins01Icon} size={17} />
              {busy === "settle" ? "Collecting…" : "Collect reward"}
            </Button>
          ) : (
            <Button onClick={() => void start()} disabled={busy !== null || loading}>
              <Icon icon={Mining01Icon} size={17} />
              {busy === "start" ? "Starting…" : "Start mining"}
            </Button>
          )
        }
      />

      {error && (
        <div className="mb-4">
          <FormMessage tone="error">{error}</FormMessage>
        </div>
      )}
      {message && (
        <div className="mb-4">
          <FormMessage tone="ok">{message}</FormMessage>
        </div>
      )}

      {loading ? (
        <EmptyState
          title="Loading mining state"
          detail="Asking the server for your current cycle."
        />
      ) : !session ? (
        <div className="grid gap-4 sm:grid-cols-3">
          <section className="rounded-[22px] border bg-card p-5 shadow-sm sm:col-span-2">
            <h2 className="font-display font-semibold">Ready to mine</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Start a cycle and the server assigns your rate for the next 24 hours. The rate is
              drawn per cycle and cannot be changed while the cycle runs.
            </p>
            <div className="mt-5">
              <Button onClick={() => void start()} disabled={busy !== null}>
                <Icon icon={Mining01Icon} size={17} />
                {busy === "start" ? "Starting…" : "Start mining"}
              </Button>
            </div>
          </section>
          <InfoCard />
        </div>
      ) : (
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
              <div className="text-end">
                <p className="text-xs text-muted-foreground">Earned this cycle</p>
                <p className="mt-1 font-display text-2xl font-bold tabular-nums">
                  {currency(moneyFromMinorUnits(accruedMinor))}
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
                  ["Cycle", `#${session.cycleNumber} · started ${dateText(session.startedAt)}`],
                  ["Window ends", dateText(session.endsAt)],
                  ["Maximum this cycle", currency(session.totalAccrued)],
                ]}
              />
            </div>

            {needsCollection && (
              <div className="mt-5">
                <Button onClick={() => void collect()} disabled={busy !== null}>
                  <Icon icon={Coins01Icon} size={17} />
                  {busy === "settle" ? "Collecting…" : "Collect reward"}
                </Button>
              </div>
            )}
            {!needsCollection && session.status !== "active" && (
              <p className="mt-5 text-sm text-muted-foreground">
                This cycle is fully collected. Start a new one to keep mining.
              </p>
            )}
            {!needsCollection && session.status === "active" && (
              <p className="mt-5 text-sm text-muted-foreground">
                Nothing to collect yet — your reward accrues continuously and stays on the server.
              </p>
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
            <InfoCard />
          </div>
        </div>
      )}
    </>
  );
}

function InfoCard() {
  return (
    <Panel title="How mining works" description="What the server guarantees.">
      <FactList
        items={[
          ["Cycle length", "Exactly 24 hours"],
          ["Rate", "Chosen per cycle on the server"],
          ["Accrual", "Continuous, and capped at the cycle's end"],
          ["Storage", "Held on your account, not in this browser"],
        ]}
      />
      <p className="mt-4 flex items-start gap-2 text-xs text-muted-foreground">
        <Icon icon={Timer01Icon} size={15} className="mt-0.5 shrink-0" />
        Closing the tab or switching devices never stops or loses a cycle: reopening the page
        re-reads the same state from the server.
      </p>
      <p className="mt-3 flex items-start gap-2 text-xs text-muted-foreground">
        <Icon icon={ChartIncreaseIcon} size={15} className="mt-0.5 shrink-0" />
        The counter you see is a display of the server's reward. Only the server decides how much
        LMA is credited.
      </p>
    </Panel>
  );
}
