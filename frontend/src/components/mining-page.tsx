import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import NumberFlow from "@number-flow/react";
import {
  BitcoinCpuIcon,
  ChartIncreaseIcon,
  Coins01Icon,
  Timer01Icon,
} from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import { Loader } from "@/components/ui/loader";
import { useWallet } from "@/hooks/wallet-context";
import { toast } from "sonner";
import { api, messageForError, type ApiMiningSession, type ApiMiningState } from "@/lib/api";
import {
  DEVICE_IN_USE_MESSAGE,
  messageForMiningError,
  startMiningWithGuard,
} from "@/lib/device-guard";
import {
  accountFetchers,
  hasBrowserSession,
  serverStateFreshness,
  serverStateKeys,
} from "@/lib/server-state";
import { MONEY_SCALE, currency, dateText, moneyFromMinorUnits } from "@/lib/wallet-format";
import { cn } from "@/lib/utils";
import { EmptyState, Icon, PageHeader } from "./wallet-shell";
import { MiningSkeleton } from "./page-skeletons";
import { MiningOrb } from "./mining-orb";
import { MiningLiveLog, type FeedLine } from "./mining-live-log";
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

/**
 * Resolves after the browser has painted the latest commit. The checking card
 * (and its freshly mounted orb) must land its first frames before the
 * device-evidence collectors contend the main thread — otherwise the swap
 * visibly hitches. Falls back after ~300ms: a background tab pauses animation
 * frames, and the start request must not wait behind an unsent paint.
 */
function nextPaint(): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (!done) {
        done = true;
        resolve();
      }
    };
    requestAnimationFrame(() => requestAnimationFrame(finish));
    setTimeout(finish, 300);
  });
}

/**
 * Action button that keeps its exact size while busy: the label stays in
 * the layout invisibly and the loader overlays it centered, so the button
 * never shrinks or grows when the text swaps for the spinner. While busy
 * the button stays fully opaque (no faded disabled look); extra clicks are
 * ignored by the guard and announced via aria-disabled.
 */
function BusyButton({
  label,
  icon,
  busy,
  onAction,
  disabled,
  busyLabel,
}: {
  label: string;
  icon: Parameters<typeof Icon>[0]["icon"];
  busy: boolean;
  onAction: () => void;
  disabled: boolean;
  busyLabel: string;
}) {
  return (
    <Button
      onClick={() => {
        if (!busy) void onAction();
      }}
      disabled={!busy && disabled}
      aria-disabled={busy || disabled || undefined}
      className="relative"
    >
      <span
        aria-hidden={busy || undefined}
        className={cn("inline-flex items-center gap-2", busy && "invisible motion-reduce:visible")}
      >
        <Icon icon={icon} size={17} />
        {label}
      </span>
      {busy && (
        <span className="absolute inset-0 grid place-items-center motion-reduce:hidden">
          <Loader aria-label={busyLabel} />
        </span>
      )}
    </Button>
  );
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
  const [error, setError] = useState("");
  /** Cycles whose completion the page has already asked to settle, so it asks exactly once each. */
  const settleRequested = useRef<Set<string>>(new Set());
  /** When `canSettle` was last re-read per cycle, so a stale flag can be refreshed without busy-looping. */
  const canSettleRefetchAt = useRef<Map<string, number>>(new Map());

  /**
   * Local activity feed: narrates real page events (cycle announcements,
   * start/collect requests and confirmed outcomes) for the activity panel.
   * Display only — pushing a line performs no request and touches no state.
   * Lines that arrive in one burst cascade with a stagger instead of popping.
   */
  const [feed, setFeed] = useState<FeedLine[]>([]);
  const feedId = useRef(0);
  const feedBurst = useRef({ at: 0, delay: 0 });
  const pushFeed = useCallback((text: string) => {
    const now = Date.now();
    const burst = feedBurst.current;
    const delay = now - burst.at < 1000 ? Math.min(burst.delay + 75, 300) : 0;
    feedBurst.current = { at: now, delay };
    const line: FeedLine = { id: feedId.current++, text, delay };
    setFeed((current) => [...current.slice(-11), line]);
  }, []);

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

  /**
   * Settles the running cycle. Returns true only when the server confirmed the write — a refused
   * or failed request resolves false, so no caller can mistake it for a collected reward.
   */
  const settle = useCallback(async (): Promise<boolean> => {
    try {
      setError("");
      await api.post("/api/v1/mining/settle");
      await queryClient.invalidateQueries({ queryKey: serverStateKeys.mining });
      // A settlement moves the wallet balance, so the balance shown elsewhere has to be re-read.
      await refresh();
      return true;
    } catch (cause) {
      setError(messageForError(cause));
      return false;
    }
  }, [queryClient, refresh]);

  /** Last failed auto-collect per cycle, so a failing request backs off instead of refiring. */
  const autoSettleFailedAt = useRef<Map<string, number>>(new Map());
  /** Cycles with a settle request currently in flight: the effect ticks every second, and without
   * this guard a slow settle/invalidate/refresh would stack redundant `/settle` calls. */
  const settleInFlight = useRef<Set<string>>(new Set());
  /** Cycles already announced in the local activity feed, so reloads and refetches never repeat a line. */
  const feedAnnounced = useRef<Set<string>>(new Set());
  /** Baseline of the last heartbeat: each line reports only what was gained since. */
  const heartbeatBaseline = useRef<number | null>(null);

  /**
   * Announces each cycle once in the local activity feed from confirmed server
   * state: the cycle number and the rate the server assigned. Display only.
   */
  useEffect(() => {
    if (session && !feedAnnounced.current.has(`cycle-${session.id}`)) {
      feedAnnounced.current.add(`cycle-${session.id}`);
      heartbeatBaseline.current = session.accruedMinor;
      pushFeed(`Cycle #${session.cycleNumber} active · ${session.rate} LMA/h`);
      pushFeed(`Window ends ${dateText(session.endsAt)}`);
    }
  }, [session, pushFeed]);

  /**
   * Honest heartbeat while a cycle runs: every 30s a line reports only what
   * was gained since the previous line (never a total), plus the elapsed
   * time — the same confirmed numbers the session card already shows.
   * A stretch with no measurable gain is skipped instead of printing a zero
   * line, so the next line covers the whole stretch since the last one.
   * Latest snapshot is read through refs so the interval is never reset by
   * the per-second countdown ticks.
   */
  const liveRef = useRef(live);
  liveRef.current = live;
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const sessionId = session?.id;
  const sessionStatus = session?.status;
  useEffect(() => {
    if (!sessionId || sessionStatus !== "active") return;
    const id = window.setInterval(() => {
      const currentSession = sessionRef.current;
      const currentLive = liveRef.current;
      if (!currentSession || currentSession.status !== "active" || !currentLive) return;
      const baseline = heartbeatBaseline.current ?? currentLive.accruedMinor;
      heartbeatBaseline.current = currentLive.accruedMinor;
      const gained = currentLive.accruedMinor - baseline;
      if (gained <= 0) return;
      pushFeed(
        `+${currency(moneyFromMinorUnits(gained))} · ${countdown(currentLive.elapsedSeconds)} elapsed`,
      );
    }, 30_000);
    return () => window.clearInterval(id);
  }, [sessionId, sessionStatus, pushFeed]);

  /**
   * A finished cycle collects itself once it is confirmed. It is not polling: this fires when the
   * local countdown reaches the end of a cycle the server already described, and the server
   * credits only what the 24-hour window actually accrued. The cycle is marked in-flight
   * synchronously so the next one-second tick cannot start a second request while the first is
   * still running; a failure clears the mark and retries after a cooldown, so the reward can
   * never be stranded by one bad request while the page stays open.
   */
  useEffect(() => {
    if (!session || !live) return;
    if (session.status === "settled") return;
    if (session.settledMinor >= live.accruedMinor) return;
    // `canSettle` is a snapshot from the last server read: a cycle that loaded while nothing had
    // accrued yet reports `canSettle: false`, and the per-second countdown advances locally without
    // refreshing that flag. Before the window closes one re-read is enough (nothing has accrued, the
    // flag may simply be stale). After it closes the flag is re-read on a cooldown instead: a
    // settlement that was paused can resume while the page stays open, and a single read taken while
    // it was paused must not pin `canSettle` false forever — that would leave Collect disabled and
    // the reward uncollected until some unrelated event refreshed the page.
    if (!session.canSettle) {
      const lastReadAt = canSettleRefetchAt.current.get(session.id) ?? 0;
      const due = live.completed ? Date.now() - lastReadAt >= 30_000 : !settleRequested.current.has(`refetched-${session.id}`);
      if (due) {
        settleRequested.current.add(`refetched-${session.id}`);
        canSettleRefetchAt.current.set(session.id, Date.now());
        void refetch();
      }
      return;
    }
    if (!live.completed) return;
    if (settleRequested.current.has(session.id)) return;
    if (settleInFlight.current.has(session.id)) return;
    const failedAt = autoSettleFailedAt.current.get(session.id) ?? 0;
    if (Date.now() - failedAt < 30_000) return;
    settleInFlight.current.add(session.id);
    if (!feedAnnounced.current.has(`auto-${session.id}`)) {
      feedAnnounced.current.add(`auto-${session.id}`);
      pushFeed(`Cycle #${session.cycleNumber} window closed · collecting reward…`);
    }
    void settle().then((ok) => {
      settleInFlight.current.delete(session.id);
      if (ok) {
        settleRequested.current.add(session.id);
        autoSettleFailedAt.current.delete(session.id);
        pushFeed("Reward settled · in your wallet");
      } else {
        autoSettleFailedAt.current.set(session.id, Date.now());
      }
    });
  }, [session, live, settle, pushFeed, refetch]);

  // LMDG: submits multi-signal device evidence with the start; the server alone decides
  // eligibility. A rejection names no account, IP, or detection detail — just the device rule.
  const start = async () => {
    setBusy("start");
    setError("");
    pushFeed("Starting cycle request…");
    await nextPaint();
    try {
      await startMiningWithGuard();
      await queryClient.invalidateQueries({ queryKey: serverStateKeys.mining });
      await refresh();
    } catch (cause) {
      setError(messageForMiningError(cause, messageForError));
      pushFeed("Start request refused");
    } finally {
      setBusy(null);
    }
  };

  const collect = async () => {
    setBusy("settle");
    setError("");
    pushFeed("Collecting reward…");
    const settledBefore = session?.settledMinor ?? 0;
    try {
      const ok = await settle();
      if (!ok) {
        pushFeed("Collection not confirmed · try again");
        return;
      }
      // Success is claimed only against fresh server state: the settled total must have advanced
      // past what this click saw, or already cover everything the window accrued.
      const fresh = await refetch();
      const next = fresh.data?.session;
      if (next && (next.settledMinor > settledBefore || next.settledMinor >= next.accruedMinor)) {
        toast.success("Reward collected into your wallet.", { position: "top-center" });
        pushFeed(
          `Reward collected · ${currency(moneyFromMinorUnits(next.settledMinor - settledBefore))}`,
        );
      } else {
        setError("The reward could not be confirmed yet. Try again.");
        pushFeed("Collection not confirmed · try again");
      }
    } finally {
      setBusy(null);
    }
  };

  // A failed read is never "Ready to mine": the account may hold a running cycle, and a Start
  // pressed on a guessed state would be refused or misleading. The error names the failure and
  // offers the retry that re-renders this state.
  if (mining.isError && !mining.data) {
    return (
      <>
        <PageHeader title="Mining" subtitle="Earn LMA by mining a 24-hour cycle." />
        <EmptyState
          title="Couldn't load mining state"
          detail={messageForError(mining.error)}
          action={<Button onClick={() => void refetch()}>Try again</Button>}
        />
      </>
    );
  }

  // Mining switched off hides the actions but never an existing cycle: an accrued-but-unsettled
  // reward stays visible (read-only) until settlement is available again.
  const actionsEnabled = mining.data?.enabled === true;
  if (mining.data && !mining.data.enabled && !mining.data.session) {
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
  // A device-guard block replaces the whole Ready card instead of rendering
  // above it: the message is the verdict, so it owns the card's content.
  const isDeviceBlocked = !session && error === DEVICE_IN_USE_MESSAGE;
  const isChecking = !session && busy === "start";
  const rateText = session ? `${session.rate} LMA / hour` : "—";
  const remaining = live?.remainingSeconds ?? session?.remainingSeconds ?? 0;
  const accruedMinor = live?.accruedMinor ?? session?.accruedMinor ?? 0;
  const progressPercent =
    session && live ? Math.min(100, (live.elapsedSeconds / session.durationSeconds) * 100) : 0;
  const needsCollection = session ? session.settledMinor < accruedMinor : false;
  // Header action follows the same rules as the body: collect while anything is pending, start
  // the next cycle once the old one is done and the server allows it, nothing while paused.
  const headerAction =
    !actionsEnabled || !mining.data ? null : !session ? (
      <BusyButton
        label="Start mining"
        icon={BitcoinCpuIcon}
        busy={busy === "start"}
        onAction={start}
        disabled={busy !== null || loading}
        busyLabel="Start mining in progress"
      />
    ) : session.status === "active" || needsCollection ? (
      <BusyButton
        label="Collect reward"
        icon={Coins01Icon}
        busy={busy === "settle"}
        onAction={collect}
        // `canSettle` is the server's capability flag: while settlement is paused the endpoint
        // refuses every request, so the action stays unavailable instead of calling it.
        disabled={busy !== null || !needsCollection || !session.canSettle}
        busyLabel="Collecting reward"
      />
    ) : mining.data.canStart ? (
      <BusyButton
        label="Start next cycle"
        icon={BitcoinCpuIcon}
        busy={busy === "start"}
        onAction={start}
        disabled={busy !== null}
        busyLabel="Start mining in progress"
      />
    ) : null;

  return (
    <>
      <PageHeader
        title="Mining"
        subtitle="A 24-hour cycle at a rate chosen for your account by the server."
        action={headerAction}
      />

      {error && !isDeviceBlocked && (
        <div className="mb-4">
          <FormMessage tone="error">{error}</FormMessage>
        </div>
      )}

      {loading ? (
        <MiningSkeleton title="Mining" />
      ) : !session ? (
        <div className="grid gap-4 sm:grid-cols-3">
          <section className="overflow-hidden rounded-[22px] border bg-card p-5 shadow-sm sm:col-span-2">
            {isChecking ? (
              <div className="grid items-center gap-6 md:grid-cols-[1fr_auto]">
                <div>
                  <h2 className="font-display font-semibold">Running security check</h2>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Verifying this device with the protection system. This takes a few seconds — do
                    not close the page.
                  </p>
                </div>
                <MiningOrb
                  state="solving"
                  size={180}
                  label="Running device security check"
                  caption="Checking security…"
                  captionShimmer
                />
              </div>
            ) : isDeviceBlocked ? (
              <div className="grid items-center gap-6 md:grid-cols-[1fr_auto]">
                <div>
                  <h2 className="font-display font-semibold">Mining blocked on this device</h2>
                  <p role="alert" className="mt-2 text-sm text-muted-foreground">
                    {error}
                  </p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    This decision comes from the protection system, not from this browser. Mining
                    will not start on this device until the current cycle ends.
                  </p>
                </div>
                <MiningOrb
                  state="working"
                  ink="danger"
                  size={180}
                  label="Mining blocked on this device"
                  caption="Blocked"
                  captionClassName="font-semibold text-destructive"
                />
              </div>
            ) : (
              <div className="grid items-center gap-6 md:grid-cols-[1fr_auto]">
                <div>
                  <h2 className="font-display font-semibold">Ready to mine</h2>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Start a cycle and the server assigns your rate for the next 24 hours. The rate
                    is drawn per cycle and cannot be changed while the cycle runs.
                  </p>
                  <ul className="mt-4 flex flex-wrap gap-2 text-[11px] font-semibold">
                    <li className="rounded-full border bg-secondary px-3 py-1 text-secondary-foreground">
                      24-hour lock
                    </li>
                    <li className="rounded-full border bg-secondary px-3 py-1 text-secondary-foreground">
                      Server-assigned rate
                    </li>
                    <li className="rounded-full border bg-secondary px-3 py-1 text-secondary-foreground">
                      Resumes on any device
                    </li>
                  </ul>
                  <p className="mt-4 text-xs text-muted-foreground">
                    Use the Start mining action above — the orb shows the idle prospector.
                  </p>
                </div>
                <MiningOrb state="working" size={180} label="Mining prospector idle" />
              </div>
            )}
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
                  ["Cycle", `#${session.cycleNumber} · started ${dateText(session.startedAt)}`],
                  ["Window ends", dateText(session.endsAt)],
                  ["Maximum this cycle", currency(session.totalAccrued)],
                ]}
              />
            </div>

            {needsCollection && session.canSettle && (
              <div className="mt-5">
                <BusyButton
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
                Mining is paused on this network, so actions are unavailable. Your earned reward
                stays on your account and nothing is lost.
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
                <BusyButton
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
            {session.status === "active" ? <MiningLiveLog events={feed} /> : <InfoCard />}
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
