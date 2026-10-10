import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useWallet } from "@/shared/hooks";
import { api, ApiError, messageForError, type ApiMiningState } from "@/shared/api";
import {
  DEVICE_IN_USE_MESSAGE,
  messageForMiningError,
  startMiningWithGuard,
} from "@/features/mining/device-guard";
import {
  accountFetchers,
  hasBrowserSession,
  serverStateFreshness,
  serverStateKeys,
} from "@/shared/lib/platform";
import { translate } from "@/shared/i18n";
import { currency, utcDateText, moneyFromMinorUnits } from "@/shared/lib/wallet";
import {
  countdown,
  liveSnapshot,
  miningServerNow,
  nextPaint,
  windowSnapshot,
} from "@/features/mining/cycle/mining-format";
import type { FeedLine } from "@/features/mining/live/MiningLiveLog";

/**
 * The mining cycle state machine: the authoritative state read, the local countdown clock, the
 * activity feed, and the start/collect actions. Rendering lives in MiningPage / MiningReadyPanel /
 * MiningActiveCycle; everything they need comes out of this hook.
 */
export function useMiningCycle() {
  const { refresh, refreshNotifications } = useWallet();
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

  const [tick, setTick] = useState(() => Date.now());
  const [busy, setBusy] = useState<"start" | "settle" | "stop" | null>(null);
  const [error, setError] = useState("");
  const [verificationRequired, setVerificationRequired] = useState(false);
  /** Cycles whose completion the page has already asked to settle, so it asks exactly once each. */
  const settleRequested = useRef<Set<string>>(new Set());
  /** When `canSettle` was last re-read per cycle, so a stale flag can be refreshed without busy-looping. */
  const canSettleRefetchAt = useRef<Map<string, number>>(new Map());
  /** How many times it has been re-read per cycle, so a long pause backs off instead of polling at 30s. */
  const canSettleRefetchCount = useRef<Map<string, number>>(new Map());

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

  // One interval for the whole page, and only while a cycle is on screen.
  useEffect(() => {
    if (!mining.data?.session) return;
    const id = window.setInterval(() => setTick(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [mining.data?.session]);

  const refetch = mining.refetch;
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        void queryClient.refetchQueries(
          { queryKey: serverStateKeys.mining, stale: true },
          { cancelRefetch: false },
        );
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [queryClient]);

  const session = mining.data?.session ?? null;
  const serverNowMs = mining.data
    ? miningServerNow(mining.data.serverNow, mining.dataUpdatedAt, tick)
    : tick;
  const live = useMemo(
    () => (session ? liveSnapshot(session, serverNowMs) : null),
    [session, serverNowMs],
  );

  // The counter reaching zero is announced once per cycle: the bell is told
  // so the notice survives navigation, and the toast is the immediate hint.
  // No polling involved — this fires off the countdown the page already runs.
  // Placed before the early returns below: hooks must run on every render.
  const completionAnnounced = useRef<string | null>(null);
  useEffect(() => {
    if (!session || !live?.completed) return;
    const accrued = live.accruedMinor ?? session.accruedMinor;
    if (session.settledMinor >= accrued) return;
    if (completionAnnounced.current === session.id) return;
    completionAnnounced.current = session.id;
    toast.success(translate("mining.cycle.toasts.complete"), { position: "top-center" });
    refreshNotifications();
  }, [session, live, refreshNotifications]);

  /**
   * Settles the running cycle. Returns true only when the server confirmed the write — a refused
   * or failed request resolves false, so no caller can mistake it for a collected reward.
   */
  const settle = useCallback(async (): Promise<boolean> => {
    try {
      setError("");
      await api.post("/api/v1/mining/settle");
      await queryClient.invalidateQueries({ queryKey: serverStateKeys.mining });
      // A settlement closes a finished cycle, and a cycle's end is also its room's end.
      await queryClient.invalidateQueries({ queryKey: serverStateKeys.miningPools });
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
      pushFeed(
        translate("mining.cycle.feed.cycleActive", {
          number: session.cycleNumber,
          rate: session.rate,
        }),
      );
      pushFeed(translate("mining.cycle.feed.windowEnds", { date: utcDateText(session.endsAt) }));
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
        translate("mining.cycle.feed.heartbeat", {
          amount: currency(moneyFromMinorUnits(gained)),
          time: countdown(currentLive.elapsedSeconds),
        }),
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
      // `canSettle` is gated on mining being enabled server-side, but the flag can flip back on
      // while this page stays open: keep re-reading on the cooldown below so an open page observes
      // the flip instead of pinning `enabled: false` (and an uncollectable reward) indefinitely.
      // The cooldown keeps an open page to a handful of requests per hour.
      const attempts = canSettleRefetchCount.current.get(session.id) ?? 0;
      // A server-side settlement pause can last arbitrarily long, so keep checking — but back off, so
      // an open page costs a handful of requests per hour instead of one every 30 seconds.
      const cooldownMs = Math.min(30_000 * 2 ** Math.min(attempts, 4), 5 * 60_000);
      const lastReadAt = canSettleRefetchAt.current.get(session.id) ?? 0;
      const due = live.completed
        ? Date.now() - lastReadAt >= cooldownMs
        : !settleRequested.current.has(`refetched-${session.id}`);
      if (due) {
        settleRequested.current.add(`refetched-${session.id}`);
        canSettleRefetchAt.current.set(session.id, Date.now());
        canSettleRefetchCount.current.set(session.id, attempts + 1);
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
      pushFeed(translate("mining.cycle.feed.autoCollecting", { number: session.cycleNumber }));
    }
    void settle().then((ok) => {
      settleInFlight.current.delete(session.id);
      if (ok) {
        settleRequested.current.add(session.id);
        autoSettleFailedAt.current.delete(session.id);
        pushFeed(translate("mining.cycle.feed.settled"));
      } else {
        autoSettleFailedAt.current.set(session.id, Date.now());
      }
    });
  }, [session, live, settle, pushFeed, refetch, mining.data?.enabled]);

  // LMDG: submits multi-signal device evidence with the start; the server alone decides
  // eligibility. A rejection names no account, IP, or detection detail — just the device rule.
  const start = async (verification?: { password: string; twoFactorCode?: string }) => {
    setBusy("start");
    setError("");
    pushFeed(translate("mining.cycle.feed.startRequest"));
    await nextPaint();
    try {
      await startMiningWithGuard(verification);
      setVerificationRequired(false);
      await queryClient.invalidateQueries({ queryKey: serverStateKeys.mining });
      await refresh();
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === "mining_account_verification_required") setVerificationRequired(true);
      setError(messageForMiningError(cause, messageForError));
      pushFeed(translate("mining.cycle.feed.startRefused"));
    } finally {
      setBusy(null);
    }
  };

  const collect = async () => {
    setBusy("settle");
    setError("");
    pushFeed(translate("mining.cycle.feed.collectingRequest"));
    const settledBefore = session?.settledMinor ?? 0;
    try {
      const ok = await settle();
      if (!ok) {
        pushFeed(translate("mining.cycle.feed.collectionFailed"));
        return;
      }
      // Success is claimed only against fresh server state: the settled total must have advanced
      // past what this click saw, or already cover everything the window accrued.
      const fresh = await refetch();
      const next = fresh.data?.session;
      if (next && (next.settledMinor > settledBefore || next.settledMinor >= next.accruedMinor)) {
        toast.success(translate("mining.cycle.toasts.collected"), { position: "top-center" });
        pushFeed(
          translate("mining.cycle.feed.collected", {
            amount: currency(moneyFromMinorUnits(next.settledMinor - settledBefore)),
          }),
        );
      } else {
        setError(translate("mining.cycle.errors.notConfirmed"));
        pushFeed(translate("mining.cycle.feed.collectionFailed"));
      }
    } finally {
      setBusy(null);
    }
  };

  /**
   * Stops the running cycle early.
   *
   * The server truncates the segment at its own clock, posts what accrued through the ledger and
   * releases the device lease in the same transaction, so the hours left in the window stay
   * spendable on the next cycle. This is the only way a customer can end a segment before its
   * window closes without waiting: `settle` pays an already-finished cycle, it never ends one.
   *
   * Confirmation follows the same rule as collection: the fresh server state has to show the cycle
   * is no longer running, or the request is reported as unconfirmed rather than as a stop that
   * never happened.
   */
  const stop = async () => {
    setBusy("stop");
    setError("");
    pushFeed(translate("mining.cycle.feed.stopRequest"));
    try {
      const stopped = await api.post<ApiMiningState>("/api/v1/mining/stop");
      await queryClient.cancelQueries({ queryKey: serverStateKeys.mining });
      queryClient.setQueryData(serverStateKeys.mining, stopped);
      // Clear the old hold even when the pools page is inactive and cannot refetch yet.
      await queryClient.resetQueries({ queryKey: serverStateKeys.miningPools, exact: true });
      await queryClient.invalidateQueries({ queryKey: serverStateKeys.mining });
      // A stop pays out whatever accrued, so the balance shown elsewhere has to be re-read.
      await refresh();
      const fresh = await refetch();
      const next = fresh.data;
      if (next && next.status !== "active" && next.poolId === null && next.poolRequired) {
        toast.success(translate("mining.cycle.toasts.stopped"), { position: "top-center" });
        pushFeed(translate("mining.cycle.feed.stopped"));
      } else {
        setError(translate("mining.cycle.errors.stopNotConfirmed"));
        pushFeed(translate("mining.cycle.feed.stopFailed"));
      }
    } catch (cause) {
      setError(messageForError(cause));
      pushFeed(translate("mining.cycle.feed.stopFailed"));
    } finally {
      setBusy(null);
    }
  };

  const loading = mining.isPending && !mining.data;
  // A device-guard block replaces the whole Ready card instead of rendering
  // above it: the message is the verdict, so it owns the card's content. Both
  // flags describe that Ready card, which is also what a finished cycle falls
  // back to, so neither is scoped to "no cycle on screen".
  const isDeviceBlocked = error === DEVICE_IN_USE_MESSAGE;
  const isChecking = busy === "start";
  // Room gate: a cycle only opens from inside a held room, and the server reports whether one is
  // held right now (a stop, and a window that ended, both release it). Where it is absent the page
  // offers the pools instead of a Start that could only be refused.
  const poolRequired = mining.data?.poolRequired === true;
  /** The room's own name, in the language the page is being read in. */
  const poolId = mining.data?.poolId ?? null;
  const poolName = poolId
    ? translate(`mining.cycle.pools.${poolId === "medium" ? "medium" : "low"}`)
    : null;
  const rateText = session ? translate("mining.cycle.ratePerHour", { rate: session.rate }) : "—";
  const remaining = live?.remainingSeconds ?? session?.remainingSeconds ?? 0;
  const accruedMinor = live?.accruedMinor ?? session?.accruedMinor ?? 0;
  /**
   * The limiting account/device window's numbers: accumulated consumption across its segments,
   * including other accounts on the same device, how much of the 10 hours is left,
   * and the bar between them. `remaining` above stays this cycle's own countdown; this is the
   * allowance the server actually enforces, so stopping and reopening — here or in a second browser
   * — continues the same total instead of restarting it.
   */
  const quota = mining.data?.quota ?? null;
  const quotaWindow = useMemo(
    () => (quota ? windowSnapshot(quota, live, session?.elapsedSeconds ?? 0) : null),
    [quota, live, session?.elapsedSeconds],
  );
  const needsCollection = session ? session.settledMinor < accruedMinor : false;
  // A cycle that is over and has nothing left to collect has no card of its own: the page goes
  // back to the ready panel (pool gate or Start) instead of parking on a settled record, and the
  // earnings stay reachable in cycle history.
  const cycleComplete = session !== null && session.status !== "active" && !needsCollection;
  const actionsEnabled = mining.data?.enabled === true;

  return {
    mining,
    refetch,
    session,
    live,
    feed,
    busy,
    error,
    loading,
    isDeviceBlocked,
    isChecking,
    poolRequired,
    poolName,
    rateText,
    remaining,
    accruedMinor,
    quotaWindow,
    needsCollection,
    cycleComplete,
    actionsEnabled,
    start,
    verificationRequired,
    collect,
    stop,
  };
}

export type MiningCycle = ReturnType<typeof useMiningCycle>;
