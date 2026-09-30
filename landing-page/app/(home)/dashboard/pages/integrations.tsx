'use client';

import { HugeiconsIcon } from '@hugeicons/react';
import {
  DeliveryTruck01Icon,
  Megaphone01Icon,
  StoreLocation01Icon,
} from '@hugeicons/core-free-icons';
import { cn } from '@/lib/cn';
import { demoMutedText, demoSoftTile } from '../tokens';
import { demoIntegrations } from '../data';
import { Reveal, SectionCard, StatusPill } from '../shared';

export function IntegrationsDemoPage() {
  return (
    <div className="w-full max-w-full min-w-0 space-y-4 overflow-hidden">
      <Reveal index={0}>
        <h2 className="text-xl font-semibold md:text-2xl">Connected services</h2>
      </Reveal>
      <Reveal index={1}>
        <SectionCard title="Connected services">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {demoIntegrations.map((integration) => (
              <div
                key={integration.name}
                className={cn(
                  'flex items-center gap-3 rounded-xl px-3 py-3 transition-colors hover:bg-black/[0.04] dark:hover:bg-white/[0.06]',
                  demoSoftTile,
                )}
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-black/[0.06] dark:bg-white/[0.07]">
                  <HugeiconsIcon icon={integration.icon === 'StoreLocation01Icon' ? StoreLocation01Icon : integration.icon === 'Megaphone01Icon' ? Megaphone01Icon : integration.icon === 'DeliveryTruck01Icon' ? DeliveryTruck01Icon : StoreLocation01Icon} size={17} strokeWidth={1.8} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium">{integration.name}</p>
                  <p className={cn('truncate text-[11px]', demoMutedText)}>{integration.detail}</p>
                </div>
                <StatusPill label={integration.status} tone={integration.tone} />
              </div>
            ))}
          </div>
        </SectionCard>
      </Reveal>
      <Reveal index={2}>
        <SectionCard title="Sync activity">
          <div className="space-y-2">
            {[
              { label: 'Ledger balance sync', detail: '38 transfers imported', time: '4m ago' },
              { label: 'Bridge settlement update', detail: '12 settlement events', time: '18m ago' },
              { label: 'MetaMask signing sync', detail: '6,120 signed', time: '1h ago' },
            ].map((activity) => (
              <div key={activity.label} className={cn('flex items-center gap-3 rounded-xl px-3 py-2.5', demoSoftTile)}>
                <span className="size-1.5 shrink-0 rounded-full bg-emerald-500" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium">{activity.label}</p>
                  <p className={cn('truncate text-[11px]', demoMutedText)}>{activity.detail}</p>
                </div>
                <span className={cn('shrink-0 text-[11px] tabular-nums', demoMutedText)}>{activity.time}</span>
              </div>
            ))}
          </div>
        </SectionCard>
      </Reveal>
    </div>
  );
}
