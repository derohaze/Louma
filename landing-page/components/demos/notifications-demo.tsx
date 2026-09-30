'use client';

import { useEffect, useState } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  CheckmarkCircle02Icon,
  DeliveryTruck01Icon,
  Package01Icon,
  Plug01Icon,
  Shield01Icon,
  ShoppingBag01Icon,
} from '@hugeicons/core-free-icons';
import { cn } from '@/lib/cn';

const notificationPool = [
  { title: 'New transfer #EF-1861', detail: 'Salma Adel · 1,450 · Cairo', icon: ShoppingBag01Icon },
  { title: 'Transfer confirmed', detail: '#EF-1854 settled today', icon: DeliveryTruck01Icon },
  { title: 'Low balance warning', detail: 'LMA balance — 6 left', icon: Package01Icon },
  { title: 'Transfer held for review', detail: '#EF-1859 · unusual transfer pattern', icon: Shield01Icon },
  { title: 'Wallet sync finished', detail: '38 transfers imported', icon: Plug01Icon },
  { title: 'Settled — LMA received', detail: '#EF-1840 · settled', icon: CheckmarkCircle02Icon },
];

const VISIBLE_NOTIFICATIONS = 4;
const notificationTimes = ['Just now', '3m ago', '9m ago', '16m ago', '24m ago'];

const demoSoftTile = 'bg-[#f2f2f2] text-neutral-900 dark:bg-[#242424] dark:text-neutral-100';
const demoMutedText = 'text-neutral-500 dark:text-neutral-400';
const demoEase = 'ease-[cubic-bezier(0.4,0,0.2,1)]';

function NotificationRow({
  notification,
  isOpen,
  isNew,
  time,
}: {
  notification: (typeof notificationPool)[number];
  isOpen: boolean;
  isNew: boolean;
  time: string;
}) {
  const [entered, setEntered] = useState(!isNew);
  useEffect(() => {
    if (entered) return;
    const frame = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(frame);
  }, [entered]);

  const open = isOpen && entered;

  return (
    <div
      aria-hidden={!open}
      className={cn(
        'grid transition-all duration-500',
        demoEase,
        open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0',
      )}
    >
      <div className="overflow-hidden">
        <div
          className={cn(
            'flex items-start gap-2.5 rounded-xl px-2.5 py-2 transition-all duration-500',
            demoEase,
            open ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0',
            isNew && 'bg-black/[0.05] dark:bg-white/[0.08]',
          )}
          style={{ transitionDelay: open && isNew ? '75ms' : '0ms' }}
        >
          <span className={cn('mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', demoSoftTile)}>
            <HugeiconsIcon icon={notification.icon} size={15} strokeWidth={1.8} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-xs font-semibold">{notification.title}</span>
            <span className={cn('block truncate text-[11px]', demoMutedText)}>
              {notification.detail}
            </span>
          </span>
          <span className={cn('shrink-0 text-[10px] tabular-nums', demoMutedText)}>{time}</span>
        </div>
      </div>
    </div>
  );
}

export function NotificationsDemo({ className }: { className?: string }) {
  const [head, setHead] = useState(VISIBLE_NOTIFICATIONS);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setHead((current) => current + 1);
    }, 2800);
    return () => window.clearInterval(timer);
  }, []);

  const rows = Array.from({ length: VISIBLE_NOTIFICATIONS + 1 }, (_, offset) => {
    const key = head - offset;
    return {
      key,
      notification: notificationPool[((key % notificationPool.length) + notificationPool.length) % notificationPool.length],
      isOpen: offset < VISIBLE_NOTIFICATIONS,
      isNew: offset === 0,
      time: notificationTimes[offset],
    };
  });

  return (
    <div
      className={cn(
        'flex flex-col rounded-xl border bg-neutral-50/90 text-neutral-800 shadow-lg backdrop-blur-lg dark:bg-neutral-900/90 dark:text-neutral-200',
        className,
      )}
    >
      <div className="border-b px-4 py-2">
        <p className="text-sm font-medium text-neutral-500 dark:text-neutral-400">Notifications</p>
      </div>
      <div className="flex flex-col p-2">
        {rows.map((row) => (
          <NotificationRow
            key={row.key}
            notification={row.notification}
            isOpen={row.isOpen}
            isNew={row.isNew}
            time={row.time}
          />
        ))}
      </div>
    </div>
  );
}
