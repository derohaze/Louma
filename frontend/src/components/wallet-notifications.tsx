import { useCallback, useEffect, useRef, useState } from "react";
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
import { useWallet } from "@/hooks/wallet-context";
import { dateText } from "@/lib/wallet-format";

type IconData = Parameters<typeof HugeiconsIcon>[0]["icon"];

/** Icon per notification kind, so a security notice reads differently from a transfer notice. */
const kindIcons: Record<string, IconData> = {
  transfer_received: ArrowDownLeft01Icon,
  transfer_sent: ArrowUpRight01Icon,
  security: SecurityCheckIcon,
};

/**
 * The bell reads the account's notifications from the API. Nothing is invented: when the account
 * has no notifications the panel says so instead of showing placeholder tasks.
 */
export function WalletNotifications() {
  const { notificationsRevision } = useWallet();
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<ApiNotification[]>([]);
  /**
   * The count comes from the server, not from the loaded page: the panel asks for twenty notices,
   * and an account with more unread than that would show a badge that can never reach zero.
   */
  const [unreadCount, setUnreadCount] = useState(0);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  /**
   * The badge slide-in must only play when the unread count changes in place
   * (a new notification). Every route renders its own shell, so navigation
   * remounts this button — playing the enter animation on mount makes the
   * badge look like it jumps on every page change. The count the first load
   * reports is therefore the baseline, and only a later change animates.
   */
  const [canAnimate, setCanAnimate] = useState(false);
  const initialCount = useRef<number | null>(null);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setCanAnimate(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  const load = useCallback(async () => {
    try {
      const response = await api.get<{ notifications: ApiNotification[]; unread: number }>(
        "/api/v1/notifications?limit=20",
      );
      setNotifications(response.notifications);
      setUnreadCount(response.unread);
      if (initialCount.current === null) initialCount.current = response.unread;
      setError("");
    } catch (cause) {
      setError(messageForError(cause));
    } finally {
      setLoaded(true);
    }
  }, []);

  /**
   * The badge follows the server, so the list reloads on mount, whenever this tab did something that
   * can produce a notice (a transfer), and when the window is focused again.
   */
  useEffect(() => {
    void load();
  }, [load, notificationsRevision]);

  useEffect(() => {
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [load]);

  /** The badge is only as fresh as the last read, so the list reloads whenever the panel opens. */
  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  /** Clearing the badge is the only way to acknowledge a notice: they carry no action of their own. */
  const markAllRead = useCallback(async () => {
    try {
      await api.post<{ read: number; unread: number }>("/api/v1/notifications/read", {});
      setError("");
      await load();
    } catch (cause) {
      setError(messageForError(cause));
    }
  }, [load]);

  /** Flipping `data-animate` alone must not start the slide-in, so the count has to actually differ. */
  const badgeChanged = initialCount.current !== null && unreadCount !== initialCount.current;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : "Notifications"}
          aria-expanded={open}
          className="relative rounded-full border border-primary-foreground/15 text-primary-foreground hover:bg-primary/20 hover:text-primary-foreground"
        >
          <HugeiconsIcon icon={Notification01Icon} size={20} strokeWidth={1.7} />
          {/*
           * Notification badge transition (transitions.dev "Notification badge"):
           * the wrapper slides in diagonally while the dot pops independently,
           * so the bell button itself never moves. `key` replays the enter
           * animation whenever the unread count changes (new notification).
           * `data-animate` stays false on mount so route changes (which remount
           * the shell) render the badge statically instead of replaying it.
           * It arms only when the count differs from the mount count, so the
           * rAF flip alone never starts the slide-in.
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
        className="w-[400px] max-w-[calc(100vw-2rem)] rounded-[24px] border-0 bg-[#E9E9EC] p-3 shadow-2xl"
      >
        <div className="mb-1 flex items-center justify-between gap-2 px-2 pb-2 pt-1">
          <h2 className="text-[17px] font-bold text-gray-900">Notifications</h2>
          <div className="flex shrink-0 items-center gap-3">
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={() => void markAllRead()}
                className="text-[13px] font-semibold text-violet-600 transition-colors hover:text-violet-700"
              >
                Mark all as read
              </button>
            )}
            <button
              type="button"
              onClick={() => void load()}
              className="text-[13px] font-semibold text-violet-600 transition-colors hover:text-violet-700"
            >
              Refresh
            </button>
          </div>
        </div>
        <div className="rounded-[20px] bg-white px-4 shadow-sm">
          {error ? (
            <p className="py-6 text-sm text-destructive">{error}</p>
          ) : notifications.length ? (
            <div className="divide-y divide-gray-100">
              {notifications.map((item) => (
                <article key={item.id} className="py-4">
                  <div className="flex items-start gap-3">
                    <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-[#F4F4F5] text-gray-900">
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
                        <p className="flex-1 text-[15px] font-bold leading-snug text-gray-900">
                          {item.title}
                        </p>
                      </div>
                      <p className="mt-1 text-[13px] leading-relaxed text-gray-500">{item.body}</p>
                      <p className="mt-1 text-[12px] text-gray-400">{dateText(item.createdAt)}</p>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <p className="py-6 text-sm text-gray-500">
              {loaded
                ? "You are all caught up. Transfer and security notices appear here."
                : "Loading notifications…"}
            </p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
