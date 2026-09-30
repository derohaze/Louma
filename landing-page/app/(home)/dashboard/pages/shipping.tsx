'use client';

import { HugeiconsIcon } from '@hugeicons/react';
import {
  Activity01Icon,
  BellIcon,
  CheckmarkCircle02Icon,
  DeliveryTruck01Icon,
} from '@hugeicons/core-free-icons';
import { cn } from '@/lib/cn';
import { demoMutedText, demoSoftTile } from '../tokens';
import { demoShipments } from '../data';
import { Reveal, SectionCard, ShortcutStat, StatusPill } from '../shared';

export function ShippingDemoPage() {
  return (
    <div className="w-full max-w-full min-w-0 space-y-4 overflow-hidden">
      <Reveal index={0}>
        <h2 className="text-xl font-semibold md:text-2xl">Settlements</h2>
      </Reveal>
      <div className="grid w-full max-w-full min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <ShortcutStat label="Settling" value="34" detail="in progress" icon="DeliveryTruck01Icon" index={1} />
        <ShortcutStat label="Settled" value="1,118" detail="this month" icon="CheckmarkCircle02Icon" index={2} />
        <ShortcutStat label="Failed" value="6" detail="need action" icon="BellIcon" index={3} />
        <ShortcutStat label="Avg. settlement" value="2.3 days" detail="end to end" icon="Activity01Icon" index={4} />
      </div>
      <Reveal index={5}>
        <SectionCard title="Active settlements">
          <div className="space-y-2">
            {demoShipments.map((shipment) => (
              <div
                key={shipment.code}
                className={cn(
                  'grid min-w-0 grid-cols-[2.25rem_minmax(0,1fr)] items-center gap-3 rounded-xl px-3 py-2.5 transition-colors sm:grid-cols-[2.25rem_minmax(0,1fr)_auto] hover:bg-black/[0.04] dark:hover:bg-white/[0.06]',
                  demoSoftTile,
                )}
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-black/[0.06] dark:bg-white/[0.07]">
                  <HugeiconsIcon icon={DeliveryTruck01Icon} size={16} strokeWidth={1.8} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium tabular-nums">{shipment.code} · {shipment.courier}</p>
                  <p className={cn('truncate text-[11px]', demoMutedText)}>{shipment.destination}</p>
                </div>
                <StatusPill label={shipment.status} tone={shipment.tone} />
              </div>
            ))}
          </div>
        </SectionCard>
      </Reveal>
    </div>
  );
}
