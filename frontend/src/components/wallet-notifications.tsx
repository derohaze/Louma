import { useEffect, useRef, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  CreditCardAddIcon,
  MoneyReceive01Icon,
  Notification01Icon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

type IconData = Parameters<typeof HugeiconsIcon>[0]["icon"];

export interface WalletTask {
  id: string;
  icon: IconData;
  title: string;
  description: string;
  actionLabel: string;
  /** Button tone: violet for the primary task, dark for the secondary (matches reference). */
  tone?: "violet" | "dark";
}

const DEFAULT_TASKS: WalletTask[] = [
  {
    id: "add-payment-method",
    icon: CreditCardAddIcon,
    title: "Add a payment method to your wallet",
    description:
      "Link a card or bank account to fund your wallet instantly and never miss a top-up.",
    actionLabel: "Add Now",
    tone: "violet",
  },
  {
    id: "claim-bonus",
    icon: MoneyReceive01Icon,
    title: "Claim your welcome currency bonus",
    description:
      "Activate your account bonus and get free credit added directly to your wallet balance.",
    actionLabel: "Claim Now",
    tone: "dark",
  },
];

export function WalletNotifications({
  tasks = DEFAULT_TASKS,
  onAction,
}: {
  tasks?: WalletTask[];
  onAction?: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [readIds, setReadIds] = useState<string[]>([]);
  /**
   * The badge slide-in must only play when the unread count changes in place
   * (a new notification). Every route renders its own shell, so navigation
   * remounts this button — playing the enter animation on mount makes the
   * badge look like it jumps on every page change.
   */
  const [canAnimate, setCanAnimate] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setCanAnimate(true));
    return () => cancelAnimationFrame(frame);
  }, []);
  const unreadCount = tasks.filter((t) => !readIds.includes(t.id)).length;
  /**
   * Count on first paint of this mount (navigation remounts the shell).
   * Flipping `data-animate` alone must not start the slide-in, so the
   * animation is armed only once the count actually differs from it.
   */
  const initialCount = useRef<number | null>(null);
  if (initialCount.current === null) {
    initialCount.current = unreadCount;
  }
  const badgeChanged = unreadCount !== initialCount.current;
  const markRead = (id: string) => setReadIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
  const markAllRead = () => setReadIds(tasks.map((t) => t.id));

  const handleAction = (id: string) => {
    markRead(id);
    onAction?.(id);
    setOpen(false);
  };

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
          <h2 className="text-[17px] font-bold text-gray-900">Tasks to complete</h2>
          <button
            type="button"
            onClick={markAllRead}
            disabled={unreadCount === 0}
            className="shrink-0 text-[13px] font-semibold text-violet-600 transition-colors hover:text-violet-700 disabled:cursor-default disabled:opacity-40"
          >
            Mark all as read
          </button>
        </div>
        <div className="rounded-[20px] bg-white px-4 shadow-sm">
          <div className="divide-y divide-gray-100">
            {tasks.map((task) => {
              const read = readIds.includes(task.id);
              return (
                <article key={task.id} className={cn("py-4")}>
                  <div className="flex items-start gap-3">
                    <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-[#F4F4F5] text-gray-900">
                      <HugeiconsIcon icon={task.icon} size={20} strokeWidth={1.7} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start gap-2">
                        {!read && (
                          <span
                            aria-label="Unread"
                            className="mt-2 size-2 shrink-0 rounded-full bg-[#F5334F]"
                          />
                        )}
                        <p className="flex-1 text-[15px] font-bold leading-snug text-gray-900">
                          {task.title}
                        </p>
                        <button
                          type="button"
                          onClick={() => markRead(task.id)}
                          disabled={read}
                          aria-label={`Mark "${task.title}" as read`}
                          className="shrink-0 rounded-full p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700 disabled:opacity-30 disabled:hover:bg-transparent"
                        >
                          <HugeiconsIcon icon={Tick02Icon} size={18} strokeWidth={2} />
                        </button>
                      </div>
                      <p className="mt-1 text-[13px] leading-relaxed text-gray-500">
                        {task.description}
                      </p>
                      <Button
                        size="sm"
                        onClick={() => handleAction(task.id)}
                        className={cn(
                          "mt-3 h-9 rounded-full px-5 text-[13px] font-bold text-white",
                          task.tone === "dark"
                            ? "bg-gray-900 hover:bg-gray-800"
                            : "bg-primary hover:bg-primary/90",
                        )}
                      >
                        {task.actionLabel}
                      </Button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
