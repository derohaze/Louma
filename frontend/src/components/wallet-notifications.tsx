import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useInfiniteQuery, useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowDownLeft01Icon,
  ArrowUpRight01Icon,
  Notification01Icon,
  SecurityCheckIcon,
} from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { api, messageForError, type ApiNotification } from "@/lib/api";
import {
  accountFetchers,
  hasBrowserSession,
  serverStateFreshness,
  serverStateKeys,
  type NotificationPage,
} from "@/lib/server-state";
import { subscribeToNotificationChanges } from "@/lib/notification-stream";
import { dateText } from "@/lib/wallet-format";

type IconData = Parameters<typeof HugeiconsIcon>[0]["icon"];

/** Icon per notification kind, so a security notice reads differently from a transfer notice. */
const kindIcons: Record<string, IconData> = {
  transfer_received: ArrowDownLeft01Icon,
  transfer_sent: ArrowUpRight01Icon,
  security: SecurityCheckIcon,
};

/**
 * The bell reads the account's notifications, and nothing is invented: when the account has none,
 * the panel says so instead of showing placeholder tasks.
 *
 * The list is a shared cache entry, so the bell is not a data owner either — it re-reads the API only
 * when the realtime channel reports a change, when the last read has gone stale and the tab is looked
 * at again, or when the owner asks for it. Reliability comes from the push channel; this screen only
 * decides what a "something changed" signal means for the page it renders.
 */
export function WalletNotifications() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [markingRead, setMarkingRead] = useState(false);
  const [actionError, setActionError] = useState("");
  /** A failure of "load older" alone, kept apart from the panel-wide error so it cannot hide the list. */
  const [pageError, setPageError] = useState("");

  const query = useInfiniteQuery<
    NotificationPage,
    Error,
    InfiniteData<NotificationPage, string | null>,
    typeof serverStateKeys.notifications,
    string | null
  >({
    queryKey: serverStateKeys.notifications,
    queryFn: ({ pageParam }) => accountFetchers.notifications(pageParam),
    initialPageParam: null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    staleTime: serverStateFreshness.notificationsMs,
    enabled: hasBrowserSession,
  });

  const pages = query.data?.pages;
  const notifications = useMemo<ApiNotification[]>(
    () => (pages ?? []).flatMap((page) => page.notifications),
    [pages],
  );
  /**
   * The count comes from the server, not from the loaded pages: the panel asks for twenty notices,
   * and an account with more unread than that would show a badge that can never reach zero.
   */
  const unreadCount = pages?.[0]?.unread ?? 0;
  const nextCursor = pages?.at(-1)?.nextCursor ?? null;

  /**
   * A failed read is shown in place of the list only when there is no list to show. A background
   * refresh that fails must not hide the notices the owner was already reading.
   */
  const readError = query.error && !query.data ? messageForError(query.error) : "";
  const error = actionError || readError;

  /**
   * The badge slide-in must only play when the unread count changes in place (a new notification).
   * The count the first read reports is therefore the baseline, and only a later change animates.
   */
  const [canAnimate, setCanAnimate] = useState(false);
  const initialCount = useRef<number | null>(null);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setCanAnimate(true));
    return () => cancelAnimationFrame(frame);
  }, []);
  useEffect(() => {
    if (initialCount.current !== null || !pages) return;
    initialCount.current = unreadCount;
  }, [pages, unreadCount]);

  /**
   * A refresh must not interleave with a page fetch. The refresh replaces the loaded pages; an older
   * page still in flight was requested for the list as it was, so appending its result to the
   * replaced list would skip every notice between them while the cursor moved past them. A refresh
   * that arrives while a page is loading is therefore queued and run once the page has landed.
   */
  const pageFetchInFlight = useRef(false);
  const queuedRefresh = useRef<(() => void) | null>(null);

  const runOrQueueRefresh = useCallback((action: () => void) => {
    if (pageFetchInFlight.current) {
      queuedRefresh.current = action;
      return;
    }
    action();
  }, []);

  const refreshNow = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: serverStateKeys.notifications });
  }, [queryClient]);

  /**
   * The server pushes a frame when a notice is written for this account. That frame carries no
   * notice, so the signal is answered by re-reading the canonical page — one request, shared by every
   * mounted bell, instead of the poll this used to be.
   */
  useEffect(
    () => subscribeToNotificationChanges(() => runOrQueueRefresh(refreshNow)),
    [runOrQueueRefresh, refreshNow],
  );

  /**
   * Coming back to the tab re-reads the badge, but only once the last read has gone stale. This is
   * the same rule the panel uses when it opens: freshness is the push channel's job, so these are a
   * safety net for a stream that is down, not a schedule.
   */
  const refreshIfStale = useCallback(() => {
    runOrQueueRefresh(() => {
      void queryClient.refetchQueries(
        { queryKey: serverStateKeys.notifications, stale: true },
        { cancelRefetch: false },
      );
    });
  }, [queryClient, runOrQueueRefresh]);

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState !== "visible") return;
      refreshIfStale();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [refreshIfStale]);

  /**
   * Appends the next older page. Without it the panel could only ever show the newest twenty while
   * "mark all as read" acknowledged notices the owner had no way to open. A failed page is reported
   * locally and leaves the list — and the retry — in place.
   */
  const loadOlder = useCallback(async () => {
    if (pageFetchInFlight.current) return;
    pageFetchInFlight.current = true;
    setLoadingOlder(true);
    setPageError("");
    try {
      // `cancelRefetch` cancels a refresh that started before this page did, so the page is appended
      // to the list it was requested against rather than to one a refresh replaced underneath it.
      // `throwOnError` is what puts a failed page in this `catch` at all: by default the fetch
      // resolves with the error on the result and the list keeps whichever pages already loaded,
      // which left this screen with no error text and no retry label.
      await query.fetchNextPage({ cancelRefetch: true, throwOnError: true });
    } catch (cause) {
      setPageError(messageForError(cause));
    } finally {
      pageFetchInFlight.current = false;
      setLoadingOlder(false);
      const queued = queuedRefresh.current;
      queuedRefresh.current = null;
      queued?.();
    }
  }, [query]);

  /** Clearing the badge is the only way to acknowledge a notice: they carry no action of their own. */
  const markAllRead = useCallback(async () => {
    setMarkingRead(true);
    setActionError("");
    try {
      await api.post<{ read: number; unread: number }>("/api/v1/notifications/read", {});
      await queryClient.invalidateQueries({ queryKey: serverStateKeys.notifications });
    } catch (cause) {
      setActionError(messageForError(cause));
    } finally {
      setMarkingRead(false);
    }
  }, [queryClient]);

  /** Flipping `data-animate` alone must not start the slide-in, so the count has to actually differ. */
  const badgeChanged = initialCount.current !== null && unreadCount !== initialCount.current;

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) refreshIfStale();
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : "Notifications"}
          aria-expanded={open}
          className="relative rounded-full border border-primary-foreground/10 text-primary-foreground hover:bg-primary/20 hover:text-primary-foreground dark:border-white/10 dark:text-white dark:hover:bg-white/10 dark:hover:text-white"
        >
          <HugeiconsIcon icon={Notification01Icon} size={20} strokeWidth={1.7} />
          {/*
           * Notification badge transition (transitions.dev "Notification badge"):
           * the wrapper slides in diagonally while the dot pops independently,
           * so the bell button itself never moves. `key` replays the enter
           * animation whenever the unread count changes (new notification).
           * `data-animate` stays false on mount so route changes render the
           * badge statically instead of replaying it.
           */}
          <span
            aria-hidden
            data-open={unreadCount > 0 ? "true" : "false"}
            data-animate={canAnimate && badgeChanged ? "true" : "false"}
            key={unreadCount > 0 ? unreadCount : "empty"}
            className="t-badge absolute -end-1 -top-1"
          >
            <span className="t-badge-dot grid h-[18px] min-w-[18px] place-items-center rounded-full bg-[#F5334F] px-1 text-[11px] font-bold leading-none text-white">
              {unreadCount}
            </span>
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={12}
        className="w-[400px] max-w-[calc(100vw-2rem)] rounded-[24px] border-0 bg-[#E9E9EC] p-3 shadow-2xl dark:bg-card"
      >
        <div className="mb-1 flex items-center justify-between gap-2 px-2 pb-2 pt-1">
          <h2 className="text-[17px] font-bold text-gray-900 dark:text-white">Notifications</h2>
          <div className="flex shrink-0 items-center gap-3">
            {unreadCount > 0 && (
              <button
                type="button"
                disabled={markingRead}
                onClick={() => void markAllRead()}
                className="text-[13px] font-semibold text-violet-600 transition-colors hover:text-violet-700 disabled:opacity-60 dark:text-violet-400 dark:hover:text-violet-300"
              >
                Mark all as read
              </button>
            )}
            <button
              type="button"
              disabled={query.isFetching}
              onClick={() => void query.refetch()}
              className="text-[13px] font-semibold text-violet-600 transition-colors hover:text-violet-700 disabled:opacity-60 dark:text-violet-400 dark:hover:text-violet-300"
            >
              Refresh
            </button>
          </div>
        </div>
        <div className="rounded-[20px] bg-white px-4 shadow-sm dark:bg-background">
          {error ? (
            <p className="py-6 text-sm text-destructive">{error}</p>
          ) : notifications.length ? (
            <div className="divide-y divide-gray-100 dark:divide-border">
              {notifications.map((item) => (
                <article key={item.id} className="py-4">
                  <div className="flex items-start gap-3">
                    <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-[#F4F4F5] text-gray-900 dark:bg-secondary dark:text-white">
                      <HugeiconsIcon
                        icon={kindIcons[item.kind] ?? Notification01Icon}
                        size={20}
                        strokeWidth={1.7}
                      />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start gap-2">
                        {item.readAt === null && (
                          <span
                            aria-label="Unread"
                            className="mt-2 size-2 shrink-0 rounded-full bg-[#F5334F]"
                          />
                        )}
                        <p className="flex-1 text-[15px] font-bold leading-snug text-gray-900 dark:text-white">
                          {item.title}
                        </p>
                      </div>
                      <p className="mt-1 text-[13px] leading-relaxed text-gray-500 dark:text-zinc-400">{item.body}</p>
                      <p className="mt-1 text-[12px] text-gray-400 dark:text-zinc-500">{dateText(item.createdAt)}</p>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <p className="py-6 text-sm text-gray-500 dark:text-zinc-400">
              {query.isPending
                ? "Loading notifications…"
                : "You are all caught up. Transfer and security notices appear here."}
            </p>
          )}
          {nextCursor && (
            <div className="border-t border-gray-100 py-3 text-center dark:border-border">
              {pageError && <p className="pb-2 text-[13px] text-destructive">{pageError}</p>}
              <button
                type="button"
                disabled={loadingOlder}
                onClick={() => void loadOlder()}
                className="text-[13px] font-semibold text-violet-600 transition-colors hover:text-violet-700 disabled:opacity-60 dark:text-violet-400 dark:hover:text-violet-300"
              >
                {loadingOlder
                  ? "Loading older notices…"
                  : pageError
                    ? "Try again"
                    : "Load older notices"}
              </button>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
