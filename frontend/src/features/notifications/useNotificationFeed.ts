import { useCallback, useEffect, useMemo, useState } from "react";
import { useInfiniteQuery, useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { api, messageForError, type ApiNotification } from "@/shared/api";
import {
  accountFetchers,
  hasBrowserSession,
  serverStateFreshness,
  serverStateKeys,
  subscribeToNotificationChanges,
  type NotificationPage,
} from "@/shared/lib/platform";

/**
 * The account's notifications, read once and shared by every surface that shows them: the header
 * panel and the notifications page render the same cache entry under the same paging rules, so the
 * two can never disagree about what is unread or which page comes next.
 *
 * Nothing here is invented and nothing is polled. The realtime channel reports that a notice was
 * written; this hook answers that signal by re-reading the canonical page. A read also happens when
 * the last one has gone stale and the tab is looked at again, and when the owner asks for it. The
 * hook is therefore a reader of server state, not an owner of it: the server is the only authority
 * on which notices exist and which are unread.
 */
/**
 * The pagination guard, shared by every mounted reader in this tab. The bell panel and the
 * notifications page read the same cached pages through separate hook instances, so per-instance
 * guards cannot see each other: a refresh triggered by the bell would invalidate mid-flight while
 * the page is appending older notices, cancelling the page fetch and leaving history unloaded.
 * Module scope is per-tab in the browser (and these callbacks only ever run client-side), so one
 * shared guard is exactly one guard per cache.
 */
const sharedFetchGuard = {
  pageFetchInFlight: false,
  queuedRefresh: null as (() => void) | null,
};

export function useNotificationFeed() {
  const queryClient = useQueryClient();
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [markingRead, setMarkingRead] = useState(false);
  const [actionError, setActionError] = useState("");
  /** A failure of "load older" alone, kept apart from the list-wide error so it cannot hide the list. */
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
   * The count comes from the server, not from the loaded pages: a read asks for twenty notices, and
   * an account with more unread than that would show a badge that can never reach zero.
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
   * A refresh must not interleave with a page fetch. The refresh replaces the loaded pages; an older
   * page still in flight was requested for the list as it was, so appending its result to the
   * replaced list would skip every notice between them while the cursor moved past them. A refresh
   * that arrives while a page is loading is therefore queued and run once the page has landed.
   */
  const runOrQueueRefresh = useCallback((action: () => void) => {
    if (sharedFetchGuard.pageFetchInFlight) {
      sharedFetchGuard.queuedRefresh = action;
      return;
    }
    action();
  }, []);

  const refreshNow = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: serverStateKeys.notifications });
  }, [queryClient]);

  /**
   * The server pushes a frame when a notice is written for this account. That frame carries no
   * notice, so the signal is answered by re-reading the canonical page — one request, shared by
   * every mounted reader, instead of a poll.
   */
  useEffect(
    () => subscribeToNotificationChanges(() => runOrQueueRefresh(refreshNow)),
    [runOrQueueRefresh, refreshNow],
  );

  /**
   * Coming back to the tab re-reads the count, but only once the last read has gone stale: freshness
   * is the push channel's job, so this is a safety net for a stream that is down, not a schedule.
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
   * Appends the next older page. Without it a reader could only ever show the newest twenty while
   * "mark all as read" acknowledged notices the owner had no way to open. A failed page is reported
   * locally and leaves the list — and the retry — in place.
   */
  const loadOlder = useCallback(async () => {
    if (sharedFetchGuard.pageFetchInFlight) return;
    sharedFetchGuard.pageFetchInFlight = true;
    setLoadingOlder(true);
    setPageError("");
    try {
      // `cancelRefetch` cancels a refresh that started before this page did, so the page is appended
      // to the list it was requested against rather than to one a refresh replaced underneath it.
      // `throwOnError` is what puts a failed page in this `catch` at all: by default the fetch
      // resolves with the error on the result and the list keeps whichever pages already loaded,
      // which left the reader with no error text and no retry label.
      await query.fetchNextPage({ cancelRefetch: true, throwOnError: true });
    } catch (cause) {
      setPageError(messageForError(cause));
    } finally {
      sharedFetchGuard.pageFetchInFlight = false;
      setLoadingOlder(false);
      const queued = sharedFetchGuard.queuedRefresh;
      sharedFetchGuard.queuedRefresh = null;
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

  /**
   * Drops a stale action error (e.g. a failed "mark all as read") so a retry can bring the list
   * back: refetching alone leaves the error in place and the notices stay hidden behind it.
   */
  const clearActionError = useCallback(() => setActionError(""), []);

  return {
    query,
    notifications,
    unreadCount,
    nextCursor,
    error,
    pageError,
    loadingOlder,
    loadOlder,
    markingRead,
    markAllRead,
    clearActionError,
    refreshIfStale,
  };
}
