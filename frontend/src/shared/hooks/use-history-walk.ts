import { useEffect, useRef } from "react";
import { useQueryClient, type InfiniteData } from "@tanstack/react-query";

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
 */
export function useHistoryWalk<Page>(options: {
  queryKey: readonly unknown[];
  fetchPage: (cursor: string | null) => Promise<Page>;
  nextCursor: (page: Page) => string | null;
  /** Hard bound on total pages, so a dashboard can never turn into an unbounded request loop. */
  cap: number;
  enabled: boolean;
  /** The list's current tail cursor: the walk restarts whenever pagination state moves. */
  tailCursor: string | null | undefined;
}): void {
  const { queryKey, cap, enabled, tailCursor } = options;
  const queryClient = useQueryClient();
  const walking = useRef(false);
  const latest = useRef({ fetchPage: options.fetchPage, nextCursor: options.nextCursor, cap });
  latest.current = { fetchPage: options.fetchPage, nextCursor: options.nextCursor, cap };

  useEffect(() => {
    if (!enabled || walking.current) return;
    walking.current = true;
    let cancelled = false;
    void (async () => {
      try {
        while (!cancelled) {
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
        }
      } catch {
        // The pages already in the cache still describe this wallet.
      } finally {
        walking.current = false;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, queryClient, queryKey, tailCursor]);
}
