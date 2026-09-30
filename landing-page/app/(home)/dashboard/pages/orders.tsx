'use client';

import { useState } from 'react';
import { cn } from '@/lib/cn';
import { demoMutedText, pillTones } from '../tokens';
import { demoOrders, orderFilters, type DemoOrder } from '../data';
import { Reveal, SectionCard, OrdersTable } from '../shared';
import { useLiveActivity } from '../live-activity';

export function OrdersDemoPage({ onSelectOrder }: { onSelectOrder: (order: DemoOrder) => void }) {
  const [filter, setFilter] = useState<(typeof orderFilters)[number]>('All');
  // Scripted live orders land on top of the queue as their events fire.
  const { liveOrders } = useLiveActivity();
  const allOrders = [...liveOrders, ...demoOrders];
  const filtered = filter === 'All' ? allOrders : allOrders.filter((order) => order.status === filter);

  return (
    <div className="w-full max-w-full min-w-0 space-y-4 overflow-hidden">
      <Reveal index={0} className="flex flex-wrap items-center gap-3">
        <h2 className="text-xl font-semibold md:text-2xl">Transfers</h2>
        <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1', pillTones.neutral)}>
          {allOrders.length} this week
        </span>
      </Reveal>
      <Reveal index={1} className="flex flex-wrap gap-1.5">
        {orderFilters.map((item) => {
          const count = item === 'All' ? allOrders.length : allOrders.filter((order) => order.status === item).length;
          return (
            <button
              key={item}
              type="button"
              onClick={() => setFilter(item)}
              className={cn(
                'cursor-pointer rounded-full px-3 py-1 text-[11px] font-semibold ring-1 transition-colors',
                filter === item
                  ? 'bg-neutral-900 text-white ring-neutral-900 dark:bg-neutral-100 dark:text-neutral-900 dark:ring-neutral-100'
                  : cn('ring-black/10 hover:bg-black/5 dark:ring-white/15 dark:hover:bg-white/10', demoMutedText),
              )}
            >
              {item} <span className="opacity-60">{count}</span>
            </button>
          );
        })}
      </Reveal>
      <Reveal index={2}>
        <SectionCard title="Transfer queue">
          {filtered.length === 0 ? (
            <p className={cn('py-8 text-center text-sm', demoMutedText)}>No transfers match this filter.</p>
          ) : (
            <OrdersTable orders={filtered} showCustomer onSelect={onSelectOrder} />
          )}
        </SectionCard>
      </Reveal>
    </div>
  );
}
