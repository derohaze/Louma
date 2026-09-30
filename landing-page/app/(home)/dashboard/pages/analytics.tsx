'use client';

import { HugeiconsIcon } from '@hugeicons/react';
import {
  Activity01Icon,
  ChartBarBigIcon,
  CheckmarkCircle02Icon,
  ChevronRightIcon,
  Megaphone01Icon,
  ShoppingBag01Icon,
} from '@hugeicons/core-free-icons';
import { cn } from '@/lib/cn';
import { demoEase, demoMutedText, demoSoftTile } from '../tokens';
import { demoTrafficSources } from '../data';
import { Reveal, SectionCard, ShortcutStat } from '../shared';

export function AnalyticsDemoPage() {
  return (
    <div className="w-full max-w-full min-w-0 space-y-4 overflow-hidden">
      <Reveal index={0}>
        <h2 className="text-xl font-semibold md:text-2xl">Activity</h2>
      </Reveal>
      <div className="grid w-full max-w-full min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <ShortcutStat label="Transfers" value="3,412" detail="last 7 days" icon="Activity01Icon" index={1} />
        <ShortcutStat label="Confirmation" value="2.8%" detail="+0.4 pts" icon="CheckmarkCircle02Icon" index={2} />
        <ShortcutStat label="Volume" value="42.3K" detail="LMA moved" icon="Megaphone01Icon" index={3} />
        <ShortcutStat label="Unconfirmed" value="118" detail="transfers" icon="ShoppingBag01Icon" index={4} />
      </div>
      <Reveal index={5}>
        <SectionCard title="Transfer sources">
          <div className="space-y-3">
            {demoTrafficSources.map((source, index) => (
              <div key={source.label}>
                <div className="mb-1 flex items-center justify-between text-xs">
                  <span className="font-medium">{source.label}</span>
                  <span className={cn('tabular-nums', demoMutedText)}>
                    {source.detail} · <span className="font-semibold text-neutral-900 dark:text-neutral-100">{source.share}%</span>
                  </span>
                </div>
                <div className={cn('h-2 overflow-hidden rounded-full', demoSoftTile)}>
                  <div
                    className={cn(
                      'h-full rounded-full bg-neutral-900 fill-mode-both animate-in slide-in-from-left-full duration-700 dark:bg-neutral-100',
                      demoEase,
                    )}
                    style={{ width: `${source.share}%`, animationDelay: `${index * 75}ms` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </SectionCard>
      </Reveal>
      <Reveal index={6}>
        <SectionCard title="Flow — Last 7 days">
          <div className="grid w-full max-w-full min-w-0 grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { label: 'Created', value: '3,412' },
              { label: 'Signed', value: '486' },
              { label: 'Broadcast', value: '214' },
              { label: 'Settled', value: '96' },
            ].map((step, index) => (
              <div key={step.label} className={cn('rounded-xl px-3 py-3', demoSoftTile)}>
                <div className={cn('text-[10px] font-semibold uppercase tracking-[0.08em]', demoMutedText)}>{step.label}</div>
                <div className="mt-1 flex items-center gap-1 text-lg font-semibold tabular-nums">
                  {step.value}
                  {index < 3 && (
                    <HugeiconsIcon icon={ChevronRightIcon} size={13} strokeWidth={1.8} className={cn('ms-auto', demoMutedText)} />
                  )}
                </div>
              </div>
            ))}
          </div>
        </SectionCard>
      </Reveal>
    </div>
  );
}
