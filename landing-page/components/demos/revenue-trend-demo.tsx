'use client';

import { useState } from 'react';
import { cn } from '@/lib/cn';

const revenueTrend = [
  { label: 'Jan', revenue: 312, orders: 640 },
  { label: 'Feb', revenue: 358, orders: 720 },
  { label: 'Mar', revenue: 341, orders: 690 },
  { label: 'Apr', revenue: 402, orders: 810 },
  { label: 'May', revenue: 445, orders: 902 },
  { label: 'Jun', revenue: 489, orders: 1120 },
  { label: 'Jul', revenue: 529, orders: 1284 },
];

const trendMetrics = [
  { key: 'revenue' as const, label: 'Balance', unit: 'k' },
  { key: 'orders' as const, label: 'Transfers', unit: '' },
];

const demoMutedText = 'text-neutral-500 dark:text-neutral-400';
const demoEase = 'ease-[cubic-bezier(0.4,0,0.2,1)]';

export function RevenueTrendDemo() {
  const [metricKey, setMetricKey] = useState<'revenue' | 'orders'>('revenue');
  const metric = trendMetrics.find((item) => item.key === metricKey)!;
  const max = Math.max(...revenueTrend.map((month) => month[metricKey]));

  return (
    <div className="rounded-xl border bg-fd-card p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className={cn('text-[10px] font-semibold uppercase tracking-[0.08em]', demoMutedText)}>
          Jan – Jul 2026
        </span>
        <div className="flex gap-1.5">
          {trendMetrics.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setMetricKey(item.key)}
              className={cn(
                'cursor-pointer rounded-full px-3 py-1 text-[11px] font-semibold ring-1 transition-colors',
                metricKey === item.key
                  ? 'bg-neutral-900 text-white ring-neutral-900 dark:bg-neutral-100 dark:text-neutral-900 dark:ring-neutral-100'
                  : cn('ring-black/10 hover:bg-black/5 dark:ring-white/15 dark:hover:bg-white/10', demoMutedText),
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
      <div key={metricKey} className="flex h-[150px] gap-2 overflow-hidden">
        {revenueTrend.map((month, index) => {
          const value = month[metricKey];
          const best = value === max;
          return (
            <div key={month.label} className="group/bar relative h-full min-w-0 flex-1">
              <span
                className={cn(
                  'absolute inset-x-0 top-0 text-center text-[10px] font-semibold tabular-nums opacity-0 transition-opacity duration-200 group-hover/bar:opacity-100',
                  best && 'opacity-100',
                )}
              >
                {value}
                {metric.unit}
              </span>
              <div className="absolute inset-x-0 bottom-5 top-5 flex items-end justify-center overflow-hidden">
                <div
                  className={cn(
                    'w-full max-w-9 rounded-t-lg fill-mode-both animate-in slide-in-from-bottom-full duration-700',
                    demoEase,
                    best
                      ? 'bg-neutral-900 dark:bg-neutral-100'
                      : 'bg-neutral-400/60 group-hover/bar:bg-neutral-500/70 dark:bg-neutral-600 dark:group-hover/bar:bg-neutral-500',
                  )}
                  style={{ height: `${(value / max) * 100}%`, animationDelay: `${index * 60}ms` }}
                />
              </div>
              <span className={cn('absolute inset-x-0 bottom-0 text-center text-[10px] font-semibold', demoMutedText)}>
                {month.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
