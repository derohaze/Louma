import { useEffect, useRef, useState } from "react";
import { useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { useRouteLoadingStatus } from "./route-loading";

/**
 * Walks a cursor-paged list to the end of its history, one page at a time, appending to the
 * shared cache entry every screen reads (never a private copy).
 *
 * `fetchInfiniteQuery` cannot do this walk: on an entry that already holds pages it re-asks for
 * those pages instead of appending the next one, so the page count never grows and a totals loop
 * built on it stops after its first call. Fetching the cursor directly and appending with
 * `setQueryData` is what actually advances the list.
 *
 * The walk is bounded (`cap` pages at most), gated by the caller (`enabled`, so it only starts
 * once the session is confirmed), and failure-tolerant: a failed page leaves the pages already
 * loaded on screen rather than blanking them. The append is guarded on the exact tail it was
 * fetched for, so two walkers racing the same cursor cannot file the same page twice.
 *
 * The walk reads the tail from the cache on every step rather than from a dependency, and its effect
 * is keyed only on the session/gate. Keying it on the tail would cancel the in-flight walk the very
 * moment it appended a page (the append is what moves the tail), and the replacement effect would
 * then see `walking.current` and exit — stopping the walk after a page or two.
 */
export function useHistoryWalk<Page>(options: {
  queryKey: readonly unknown[];
  fetchPage: (cursor: string | null) => Promise<Page>;
  nextCursor: (page: Page) => string | null;
  /** Hard bound on total pages, so a dashboard can never turn into an unbounded request loop. */
  cap: number;
  enabled: boolean;
  /**
   * Optional stop condition, evaluated on each page just appended. A dashboard that only needs a
   * date window returns false once a page is older than that window, so the walk keeps going past
   * `cap` while matching history remains instead of reporting totals from a truncated list.
   */
  shouldContinue?: (page: Page) => boolean;
}): void {
  const { queryKey, cap, enabled } = options;
  const queryClient = useQueryClient();
  const activeWalk = useRef<symbol | null>(null);
  const [walkFinished, setWalkFinished] = useState(false);
  const cached = queryClient.getQueryData<InfiniteData<Page, string | null>>(queryKey);
  const hasFirstPage = (cached?.pages.length ?? 0) > 0;
  const lastCachedPage = cached?.pages.at(-1);
  const hasMore =
    enabled &&
    (cached?.pages.length ?? 0) > 0 &&
    (cached?.pages.length ?? 0) < cap &&
    Boolean(lastCachedPage && options.nextCursor(lastCachedPage));
  useRouteLoadingStatus(`history-walk:${JSON.stringify(queryKey)}`, hasMore && !walkFinished);
  const latest = useRef({
    fetchPage: options.fetchPage,
    nextCursor: options.nextCursor,
    cap,
    shouldContinue: options.shouldContinue,
  });
  latest.current = {
    fetchPage: options.fetchPage,
    nextCursor: options.nextCursor,
    cap,
    shouldContinue: options.shouldContinue,
  };

  useEffect(() => {
    if (!enabled || !hasFirstPage || activeWalk.current) return;
    const walkId = Symbol("history-walk");
    activeWalk.current = walkId;
    setWalkFinished(false);
    let cancelled = false;
    void (async () => {
      // Let React's development effect replay clean up before any network work begins.
      await Promise.resolve();
      if (cancelled || activeWalk.current !== walkId) return;
      try {
        while (!cancelled && activeWalk.current === walkId) {
          const live = latest.current;
          const cached = queryClient.getQueryData<InfiniteData<Page, string | null>>(queryKey);
          const pages = cached?.pages.length ?? 0;
          const last = cached?.pages.at(-1);
          const cursor = last ? live.nextCursor(last) : null;
          // A cursor the API keeps answering with would append nothing; stop rather than spin.
          if (!cursor || pages >= live.cap) break;
          const page = await live.fetchPage(cursor);
          if (cancelled) break;
          let appended = false;
          queryClient.setQueryData<InfiniteData<Page, string | null>>(queryKey, (prev) => {
            if (!prev || prev.pages.length !== pages) return prev;
            const prevLast = prev.pages.at(-1);
            if (!prevLast || live.nextCursor(prevLast) !== cursor) return prev;
            appended = true;
            return { pages: [...prev.pages, page], pageParams: [...prev.pageParams, cursor] };
          });
          if (!appended) break;
          // Stop once the appended page has reached past the caller's window; the next page would
          // only hold older rows the totals ignore anyway.
          if (live.shouldContinue && !live.shouldContinue(page)) break;
        }
      } catch {
        // The pages already in the cache still describe this wallet.
      } finally {
        if (activeWalk.current === walkId) activeWalk.current = null;
        if (!cancelled) setWalkFinished(true);
      }
    })();
    return () => {
      cancelled = true;
      if (activeWalk.current === walkId) activeWalk.current = null;
    };
  }, [enabled, hasFirstPage, queryClient, queryKey]);
}
