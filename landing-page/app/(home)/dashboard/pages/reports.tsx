'use client';

import { HugeiconsIcon } from '@hugeicons/react';
import {
  ChartBarBigIcon,
  CheckmarkCircle02Icon,
  CreditCardIcon,
  DeliveryTruck01Icon,
  ShoppingBag01Icon,
} from '@hugeicons/core-free-icons';
import { cn } from '@/lib/cn';
import { demoEase, demoMutedText, demoSoftTile } from '../tokens';
import { demoRevenueTrend, demoProducts } from '../data';
import { Reveal, SectionCard, ShortcutStat } from '../shared';

export function ReportsDemoPage() {
  const maxRevenue = Math.max(...demoRevenueTrend.map((month) => month.revenue));
  return (
    <div className="w-full max-w-full min-w-0 space-y-4 overflow-hidden">
      <Reveal index={0}>
        <h2 className="text-xl font-semibold md:text-2xl">Statements</h2>
      </Reveal>
      <div className="grid w-full max-w-full min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <ShortcutStat label="Volume YTD" value="2.87M" detail="+18% YoY" icon="ChartBarBigIcon" index={1} />
        <ShortcutStat label="Transfers YTD" value="6,166" detail="87% settled" icon="ShoppingBag01Icon" index={2} />
        <ShortcutStat label="Reversal rate" value="3.4%" detail="-0.8 pts" icon="DeliveryTruck01Icon" index={3} />
        <ShortcutStat label="Instant share" value="71%" detail="of transfers" icon="CreditCardIcon" index={4} />
      </div>
      <Reveal index={5}>
        <SectionCard
          title="Transfer volume"
          action={<span className={cn('text-[11px] font-semibold tabular-nums', demoMutedText)}>Jan – Jul 2026 · thousands</span>}
        >
          <div className="flex h-[190px] items-end gap-2 sm:gap-3">
            {demoRevenueTrend.map((month, index) => {
              const best = month.revenue === maxRevenue;
              return (
                <div key={month.label} className="group/bar flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1.5">
                  <span
                    className={cn(
                      'text-[10px] font-semibold tabular-nums opacity-0 transition-opacity duration-200 group-hover/bar:opacity-100',
                      best && 'opacity-100',
                    )}
                  >
                    {month.revenue}k
                  </span>
                  <div
                    className={cn(
                      'w-full max-w-9 rounded-t-lg transition-all duration-700 fill-mode-both animate-in slide-in-from-bottom-full',
                      demoEase,
                      best
                        ? 'bg-neutral-900 dark:bg-neutral-100'
                        : 'bg-neutral-400/60 group-hover/bar:bg-neutral-500/70 dark:bg-neutral-600 dark:group-hover/bar:bg-neutral-500',
                    )}
                    style={{ height: `${(month.revenue / maxRevenue) * 100}%`, animationDelay: `${index * 60}ms` }}
                  />
                  <span className={cn('text-[10px] font-semibold', demoMutedText)}>{month.label}</span>
                </div>
              );
            })}
          </div>
        </SectionCard>
      </Reveal>
      <Reveal index={6}>
        <SectionCard title="Top addresses — July">
          <div className="space-y-2">
            {demoProducts.slice(0, 4).map((product, index) => (
              <div key={product.sku} className={cn('flex items-center gap-3 rounded-xl px-3 py-2.5', demoSoftTile)}>
                <span className={cn('w-5 text-center text-xs font-bold tabular-nums', demoMutedText)}>{index + 1}</span>
                <p className="min-w-0 flex-1 truncate text-xs font-medium">{product.name}</p>
                <span className="text-xs font-semibold tabular-nums">{product.price}</span>
              </div>
            ))}
          </div>
        </SectionCard>
      </Reveal>
    </div>
  );
}
