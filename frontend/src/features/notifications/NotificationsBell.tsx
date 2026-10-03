import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowRight01Icon, Notification01Icon } from "@hugeicons/core-free-icons";
import { Button } from "@/shared/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/ui/popover";
import { useT } from "@/shared/i18n";
import { dateText } from "@/shared/lib/wallet";
import { notificationKindIcons } from "./notification-icons";
import { useNotificationFeed } from "./useNotificationFeed";

/**
 * The bell shows the newest notices in a bounded panel, and the notifications page shows the rest.
 *
 * The data itself comes from `useNotificationFeed`, the same reader the page uses, so the badge,
 * the panel, and the page are three views of one cache entry rather than three copies of the same
 * request.
 */
export function WalletNotifications() {
  const t = useT("notifications");
  const common = useT("common");
  const [open, setOpen] = useState(false);
  const {
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
    refreshIfStale,
  } = useNotificationFeed();

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
    if (initialCount.current !== null || !query.data?.pages) return;
    initialCount.current = unreadCount;
  }, [query.data, unreadCount]);

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
          aria-label={
            unreadCount > 0 ? t("bell.ariaUnread", { count: unreadCount }) : t("title")
          }
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
      {/*
       * A fixed footprint, not one that grows with the list: the newest notices are what the panel
       * is for, and the rest scroll inside it (or open on the notifications page). Without this the
       * panel measured itself against the list and covered the page on desktop.
       */}
      <PopoverContent
        align="end"
        sideOffset={12}
        className="w-[380px] max-w-[calc(100vw-2rem)] rounded-[24px] border-0 bg-[#E9E9EC] p-3 shadow-2xl dark:bg-card"
      >
        <div className="mb-1 flex items-center justify-between gap-2 px-2 pb-2 pt-1">
          <h2 className="text-[17px] font-bold text-gray-900 dark:text-white">{t("title")}</h2>
          <div className="flex shrink-0 items-center gap-3">
            {unreadCount > 0 && (
              <button
                type="button"
                disabled={markingRead}
                onClick={() => void markAllRead()}
                className="text-[13px] font-semibold text-violet-600 transition-colors hover:text-violet-700 disabled:opacity-60 dark:text-violet-400 dark:hover:text-violet-300"
              >
                {t("markAllRead")}
              </button>
            )}
            <button
              type="button"
              disabled={query.isFetching}
              onClick={() => void query.refetch()}
              className="text-[13px] font-semibold text-violet-600 transition-colors hover:text-violet-700 disabled:opacity-60 dark:text-violet-400 dark:hover:text-violet-300"
            >
              {common("actions.refresh")}
            </button>
          </div>
        </div>
        <div className="flex max-h-[min(62vh,440px)] flex-col rounded-[20px] bg-white shadow-sm dark:bg-background">
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4">
            {error ? (
              <p className="py-6 text-sm text-destructive">{error}</p>
            ) : notifications.length ? (
              <div className="divide-y divide-gray-100 dark:divide-border">
                {notifications.map((item) => (
                  <article key={item.id} className="py-4">
                    <div className="flex items-start gap-3">
                      <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-[#F4F4F5] text-gray-900 dark:bg-secondary dark:text-white">
                        <HugeiconsIcon
                          icon={notificationKindIcons[item.kind] ?? Notification01Icon}
                          size={20}
                          strokeWidth={1.7}
                        />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start gap-2">
                          {item.readAt === null && (
                            <span
                              aria-label={t("unreadAria")}
                              className="mt-2 size-2 shrink-0 rounded-full bg-[#F5334F]"
                            />
                          )}
                          <p className="flex-1 text-[15px] font-bold leading-snug text-gray-900 dark:text-white">
                            {item.title}
                          </p>
                        </div>
                        <p className="mt-1 text-[13px] leading-relaxed text-gray-500 dark:text-zinc-400">
                          {item.body}
                        </p>
                        <p className="mt-1 text-[12px] text-gray-400 dark:text-zinc-500">
                          {dateText(item.createdAt)}
                        </p>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <p className="py-6 text-sm text-gray-500 dark:text-zinc-400">
                {query.isPending ? t("empty.loading") : t("empty.caughtUp")}
              </p>
            )}
          </div>
          {/*
           * The footer stays put while the list scrolls under it, so the way out of the panel is
           * never the part that scrolled away. "Load older notices" acknowledges what the panel can
           * show; the full page is where the whole history lives.
           */}
          <div className="flex items-center justify-between gap-3 border-t border-gray-100 px-4 py-3 dark:border-border">
            {nextCursor ? (
              <div className="min-w-0">
                {pageError && <p className="pb-1 text-[12px] text-destructive">{pageError}</p>}
                <button
                  type="button"
                  disabled={loadingOlder}
                  onClick={() => void loadOlder()}
                  className="text-[13px] font-semibold text-violet-600 transition-colors hover:text-violet-700 disabled:opacity-60 dark:text-violet-400 dark:hover:text-violet-300"
                >
                  {loadingOlder
                    ? t("loadingOlder")
                    : pageError
                      ? common("actions.retry")
                      : t("loadOlder")}
                </button>
              </div>
            ) : (
              <span />
            )}
            <Link
              to="/notifications"
              onClick={() => setOpen(false)}
              className="flex shrink-0 items-center gap-1 text-[13px] font-semibold text-violet-600 transition-colors hover:text-violet-700 dark:text-violet-400 dark:hover:text-violet-300"
            >
              {t("bell.viewAll")}
              <HugeiconsIcon icon={ArrowRight01Icon} size={15} strokeWidth={2} />
            </Link>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
