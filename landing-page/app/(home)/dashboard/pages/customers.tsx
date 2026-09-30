'use client';

import { HugeiconsIcon } from '@hugeicons/react';
import {
  ChartBarBigIcon,
  CheckmarkCircle02Icon,
  File01Icon,
  UserGroupIcon,
} from '@hugeicons/core-free-icons';
import { cn } from '@/lib/cn';
import { demoMutedText, demoSoftTile } from '../tokens';
import { demoCustomers } from '../data';
import { Reveal, SectionCard, ShortcutStat } from '../shared';

export function CustomersDemoPage() {
  return (
    <div className="w-full max-w-full min-w-0 space-y-4 overflow-hidden">
      <Reveal index={0}>
        <h2 className="text-xl font-semibold md:text-2xl">Recipients</h2>
      </Reveal>
      <div className="grid w-full max-w-full min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <ShortcutStat label="Recipients" value="3,412" detail="all time" icon="UserGroupIcon" index={1} />
        <ShortcutStat label="Repeat senders" value="642" detail="18.8%" icon="CheckmarkCircle02Icon" index={2} />
        <ShortcutStat label="New this month" value="187" detail="+12%" icon="ChartBarBigIcon" index={3} />
        <ShortcutStat label="Avg. sent" value="1,930" detail="per recipient" icon="File01Icon" index={4} />
      </div>
      <Reveal index={5}>
        <SectionCard title="Recent recipients">
          <div className="space-y-2">
            {demoCustomers.map((customer) => (
              <div
                key={customer.name}
                className={cn(
                  'grid min-w-0 grid-cols-[2.25rem_minmax(0,1fr)] items-center gap-3 rounded-xl px-3 py-2.5 transition-colors sm:grid-cols-[2.25rem_minmax(0,1fr)_auto] hover:bg-black/[0.04] dark:hover:bg-white/[0.06]',
                  demoSoftTile,
                )}
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-neutral-900 text-[11px] font-semibold text-white dark:bg-neutral-100 dark:text-neutral-900">
                  {customer.name.split(' ').map((part) => part[0]).join('')}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium">{customer.name}</p>
                  <p className={cn('text-[11px] tabular-nums', demoMutedText)}>
                    {customer.phone} · {customer.governorate}
                  </p>
                </div>
                <div className="hidden text-right sm:block">
                  <p className="text-xs font-semibold tabular-nums">{customer.spent}</p>
                  <p className={cn('text-[11px] tabular-nums', demoMutedText)}>{customer.orders} transfers</p>
                </div>
              </div>
            ))}
          </div>
        </SectionCard>
      </Reveal>
    </div>
  );
}
