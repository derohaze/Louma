import { HugeiconsIcon } from "@hugeicons/react";
import {
  CheckmarkCircle02Icon,
  Notification01Icon,
  Refresh01Icon,
} from "@hugeicons/core-free-icons";
import { Button } from "@/shared/ui/button";
import { EmptyState, Icon, PageHeader, revealDelay } from "@/shared/ui/page";
import { useT } from "@/shared/i18n";
import { dateText } from "@/shared/lib/wallet";
import { notificationKindIcons } from "./notification-icons";
import { notificationText } from "./notification-text";
import { useNotificationFeed } from "./useNotificationFeed";

/**
 * The full notifications screen, reached from the bell panel's "View all".
 *
 * The panel is a glance at the newest notices; this page is the history. Both read the same cache
 * entry through `useNotificationFeed`, so marking everything read here clears the badge there, and a
 * notice the stream reports while this page is open appears in both without either asking again.
 */
export function NotificationsPage() {
  const t = useT("notifications");
  const common = useT("common");
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
    clearActionError,
    refreshIfStale,
  } = useNotificationFeed();

  return (
    <>
      <PageHeader
        title={t("title")}
        subtitle={
          unreadCount > 0
            ? unreadCount === 1
              ? t("unreadOne", { count: unreadCount })
              : t("unreadOther", { count: unreadCount })
            : t("description")
        }
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              disabled={query.isFetching}
              onClick={() => {
                refreshIfStale();
                void query.refetch();
              }}
            >
              <Icon icon={Refresh01Icon} size={17} />
              {common("actions.refresh")}
            </Button>
            <Button disabled={markingRead || unreadCount === 0} onClick={() => void markAllRead()}>
              <Icon icon={CheckmarkCircle02Icon} size={17} />
              {t("markAllRead")}
            </Button>
          </div>
        }
      />

      {error ? (
        <EmptyState
          title={t("unavailable")}
          detail={error}
          action={
            <Button
              onClick={() => {
                clearActionError();
                void query.refetch().catch(() => undefined);
              }}
            >
              {common("actions.retry")}
            </Button>
          }
        />
      ) : (
        <section
          style={revealDelay(0)}
          className="card-enter overflow-hidden rounded-[22px] border bg-card shadow-sm"
        >
          <div className="flex items-center justify-between gap-3 border-b px-5 py-4">
            <h2 className="font-display font-semibold">{t("all")}</h2>
            {unreadCount > 0 && (
              <span className="rounded-full bg-[#F5334F] px-2.5 py-1 text-[11px] font-bold leading-none text-white">
                {t("unreadBadge", { count: unreadCount })}
              </span>
            )}
          </div>

          {notifications.length ? (
            <ul className="divide-y divide-gray-100 dark:divide-border">
              {notifications.map((item, row) => {
                const copy = notificationText(item, t);
                return (
                  <li key={item.id} style={revealDelay(row, 45, 360)} className="list-enter">
                    <article className="flex items-start gap-3 px-5 py-4">
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
                          <p className="flex-1 text-[15px] font-bold leading-snug">{copy.title}</p>
                        </div>
                        <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
                          {copy.body}
                        </p>
                        <p className="mt-1 text-[12px] text-muted-foreground/80">
                          {dateText(item.createdAt)}
                        </p>
                      </div>
                    </article>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="px-5 py-10 text-center text-sm text-muted-foreground">
              {query.isPending ? t("empty.loading") : t("empty.caughtUp")}
            </p>
          )}

          {nextCursor && (
            <div className="border-t px-5 py-4 text-center">
              {pageError && <p className="pb-2 text-[13px] text-destructive">{pageError}</p>}
              <Button variant="outline" disabled={loadingOlder} onClick={() => void loadOlder()}>
                {loadingOlder
                  ? t("loadingOlder")
                  : pageError
                    ? common("actions.retry")
                    : t("loadOlder")}
              </Button>
            </div>
          )}
        </section>
      )}
    </>
  );
}
