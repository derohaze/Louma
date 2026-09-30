'use client';

import { useState } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  BellIcon,
  DeliveryTruck01Icon,
  Package01Icon,
  ShoppingBag01Icon,
} from '@hugeicons/core-free-icons';
import { cn } from '@/lib/cn';
import { demoEase, demoLabelMini, demoMutedText, demoPopover, demoSoftTile, pillTones } from '../tokens';
import { useLiveActivity } from '../live-activity';

const notificationIconMap: Record<string, typeof BellIcon> = {
  ShoppingBag01Icon,
  Package01Icon,
  DeliveryTruck01Icon,
};

export function NotificationsMenu() {
  const [open, setOpen] = useState(false);
  const { notifications, unreadCount, markNotificationsRead } = useLiveActivity();

  const toggleMenu = () => {
    // Opening reads everything: the badge clears, like the real dashboard.
    if (!open) markNotificationsRead();
    setOpen((value) => !value);
  };

  return (
    <div className="relative">
      <button
        type="button"
        aria-expanded={open}
        onClick={toggleMenu}
        className={cn(
          'relative flex h-9 w-9 cursor-pointer items-center justify-center rounded-xl transition-colors',
          open
            ? 'bg-[#e8e8e8] dark:bg-[#242424]'
            : 'bg-[#f2f2f2] hover:bg-[#e8e8e8] dark:bg-[#242424] dark:hover:bg-[#303030]',
        )}
        aria-label="Notifications"
      >
        <HugeiconsIcon icon={BellIcon} size={18} strokeWidth={1.8} />
        {unreadCount > 0 && (
          <span
            // Keyed by count so every new event replays the pop-in animation.
            key={unreadCount}
            className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[9px] font-bold text-white shadow-sm animate-in zoom-in-50 duration-300 fill-mode-both"
          >
            {unreadCount}
          </span>
        )}
      </button>

      {open && <div aria-hidden className="fixed inset-0 z-40" onClick={() => setOpen(false)} />}

      <div
        inert={!open}
        className={cn(
          'absolute right-0 top-full z-50 mt-2 w-[min(300px,calc(100vw-2rem))] max-w-[calc(100vw-2rem)] p-1.5 transition-all duration-500',
          demoEase,
          demoPopover,
          open ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-3 opacity-0',
        )}
      >
        <div className="flex items-center justify-between px-2.5 pb-1 pt-1.5">
          <span className={demoLabelMini}>Notifications</span>
          <span className={cn('rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase ring-1', pillTones.neutral)}>
            {notifications.length} recent
          </span>
        </div>
        {notifications.map((notification, index) => {
          const IconComponent = notificationIconMap[notification.icon] ?? BellIcon;
          return (
            <button
              key={`${notification.title}-${index}`}
              type="button"
              onClick={() => setOpen(false)}
              className={cn(
                'flex w-full cursor-pointer items-start gap-2.5 rounded-xl px-2.5 py-2 text-start transition-all duration-500 hover:bg-black/[0.05] dark:hover:bg-white/[0.08]',
                demoEase,
                open ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0',
              )}
              style={{ transitionDelay: open ? `${index * 75}ms` : '0ms' }}
            >
              <span className={cn('mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', demoSoftTile)}>
                <HugeiconsIcon icon={IconComponent} size={15} strokeWidth={1.8} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-semibold">{notification.title}</span>
                <span className={cn('block truncate text-[11px]', demoMutedText)}>{notification.detail}</span>
              </span>
              <span className={cn('shrink-0 text-[10px] tabular-nums', demoMutedText)}>{notification.time}</span>
            </button>
          );
        })}
        <div
          className={cn(
            'px-2.5 pb-1 pt-1.5 text-center transition-all duration-500',
            demoEase,
            open ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0',
          )}
          style={{ transitionDelay: open ? `${notifications.length * 75}ms` : '0ms' }}
        >
          <button
            type="button"
            onClick={() => setOpen(false)}
            className={cn('cursor-pointer text-[11px] font-semibold transition-colors hover:text-neutral-900 dark:hover:text-neutral-100', demoMutedText)}
          >
            View all notifications
          </button>
        </div>
      </div>
    </div>
  );
}
