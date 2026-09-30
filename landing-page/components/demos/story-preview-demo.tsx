'use client';

import { useState } from 'react';
import { cn } from '@/lib/cn';

type ShipmentTone = 'success' | 'danger' | 'neutral';

interface DemoShipment {
  code: string;
  courier: string;
  destination: string;
  status: string;
  tone: ShipmentTone;
  eta: string;
  events: { label: string; time: string }[];
}

const demoShipments: DemoShipment[] = [
  {
    code: '#EF-1854',
    courier: 'LMA',
    destination: 'Maadi, Cairo',
    status: 'Pending',
    tone: 'neutral',
    eta: 'Soon',
    events: [
      { label: 'Arrived at settlement node', time: '2h ago' },
      { label: 'Broadcast to network', time: '6h ago' },
      { label: 'Transfer created', time: 'Yesterday' },
    ],
  },
  {
    code: '#EF-1852',
    courier: 'LMA',
    destination: 'Smouha, Alexandria',
    status: 'Confirming',
    tone: 'neutral',
    eta: 'Now',
    events: [
      { label: 'Confirmation is on its way', time: '25m ago' },
      { label: 'Reached settlement node', time: '4h ago' },
      { label: 'Broadcast to network', time: 'Yesterday' },
    ],
  },
  {
    code: '#EF-1849',
    courier: 'LMA',
    destination: 'Smouha, Alexandria',
    status: 'Settled',
    tone: 'success',
    eta: 'Settled',
    events: [
      { label: 'Settled — signed by recipient', time: '1h ago' },
      { label: 'Confirming', time: '5h ago' },
      { label: 'Reached settlement node', time: 'Yesterday' },
    ],
  },
  {
    code: '#EF-1845',
    courier: 'LMA',
    destination: 'Dokki, Giza',
    status: 'Failed',
    tone: 'danger',
    eta: 'Needs review',
    events: [
      { label: 'Recipient unreachable — retry scheduled', time: '40m ago' },
      { label: 'Confirming', time: '4h ago' },
      { label: 'Broadcast to network', time: 'Yesterday' },
    ],
  },
  {
    code: '#EF-1840',
    courier: 'LMA',
    destination: 'Mansoura, Dakahlia',
    status: 'Settled',
    tone: 'success',
    eta: 'Settled',
    events: [
      { label: 'Settled — LMA received', time: '3h ago' },
      { label: 'Confirming', time: '7h ago' },
      { label: 'Reached settlement node', time: '2 days ago' },
    ],
  },
];

const shipmentFilters = ['All', 'Pending', 'Confirming', 'Settled', 'Failed'] as const;

const demoCard = 'bg-white text-neutral-900 dark:bg-[#161616] dark:text-neutral-100';
const demoSoftTile = 'bg-[#f2f2f2] text-neutral-900 dark:bg-[#242424] dark:text-neutral-100';
const demoMutedText = 'text-neutral-500 dark:text-neutral-400';
const demoLabelMini =
  'text-[10px] font-semibold uppercase tracking-[0.08em] text-neutral-500 dark:text-neutral-400';
const demoEase = 'ease-[cubic-bezier(0.4,0,0.2,1)]';

const pillTones: Record<ShipmentTone, string> = {
  success:
    'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/30',
  danger:
    'bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-500/10 dark:text-rose-300 dark:ring-rose-500/30',
  neutral:
    'bg-black/[0.05] text-neutral-600 ring-black/[0.07] dark:bg-white/[0.06] dark:text-neutral-300 dark:ring-white/10',
};

function StatusPill({ label, tone }: { label: string; tone: ShipmentTone }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[10px] font-semibold ring-1',
        pillTones[tone],
      )}
    >
      <span className="size-1.5 rounded-full bg-current opacity-80" />
      {label}
    </span>
  );
}

function ShipmentTimeline({ shipment, isOpen }: { shipment: DemoShipment; isOpen: boolean }) {
  const stagedClass = cn(
    'transition-all duration-500',
    demoEase,
    isOpen ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0',
  );
  const stagedDelay = (index: number) => ({
    transitionDelay: isOpen ? `${index * 75}ms` : '0ms',
  });

  return (
    <div
      aria-hidden={!isOpen}
      inert={!isOpen}
      className={cn(
        'grid transition-all duration-500',
        demoEase,
        isOpen ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0',
      )}
    >
      <div className="overflow-hidden">
        <div className="space-y-2 px-3 pb-3 pt-1">
          {shipment.events.map((event, index) => (
            <div
              key={event.label}
              className={cn('flex items-center gap-3 text-[11px]', stagedClass)}
              style={stagedDelay(index)}
            >
              <span
                className={cn(
                  'size-1.5 shrink-0 rounded-full',
                  index === 0
                    ? 'bg-neutral-900 dark:bg-neutral-100'
                    : 'bg-neutral-300 dark:bg-neutral-600',
                )}
              />
              <p className={cn('min-w-0 flex-1 truncate', index === 0 ? 'font-medium' : demoMutedText)}>
                {event.label}
              </p>
              <span className={cn('shrink-0 tabular-nums', demoMutedText)}>{event.time}</span>
            </div>
          ))}
          <div
            className={cn('flex items-center justify-between pt-1 text-[11px]', stagedClass)}
            style={stagedDelay(shipment.events.length)}
          >
            <span className={demoMutedText}>Estimated settlement</span>
            <span className="font-semibold">{shipment.eta}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export function StoryPreviewDemo() {
  const [filter, setFilter] = useState<(typeof shipmentFilters)[number]>('All');
  const [selectedCode, setSelectedCode] = useState<string | null>('#EF-1852');

  return (
    <div className="rounded-xl border bg-fd-background p-3 text-sm">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          { label: 'Pending', value: '34', detail: 'awaiting confirm' },
          { label: 'Settled', value: '1,118', detail: 'this month' },
          { label: 'Failed', value: '6', detail: 'need review' },
          { label: 'Avg. settlement', value: '2.3 days', detail: 'send to settled' },
        ].map((stat) => (
          <div key={stat.label} className={cn('min-w-0 rounded-2xl px-3 py-3', demoCard, 'border')}>
            <div className={cn('truncate text-xs font-medium', demoMutedText)}>{stat.label}</div>
            <div className="mt-1 truncate text-lg font-semibold tabular-nums">{stat.value}</div>
            <div className={cn('truncate text-[11px]', demoMutedText)}>{stat.detail}</div>
          </div>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {shipmentFilters.map((item) => {
          const count =
            item === 'All'
              ? demoShipments.length
              : demoShipments.filter((shipment) => shipment.status === item).length;
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
      </div>

      <div className={cn('mt-3 overflow-hidden rounded-[24px] border', demoCard)}>
        <header className="px-4 pb-1.5 pt-4 sm:px-5">
          <h3 className={demoLabelMini}>Active transfers</h3>
        </header>
        <div className="p-4 pt-3 sm:p-5 sm:pt-3">
          {demoShipments.map((shipment) => {
            const matchesFilter = filter === 'All' || shipment.status === filter;
            const isOpen = matchesFilter && shipment.code === selectedCode;

            return (
              <div
                key={shipment.code}
                aria-hidden={!matchesFilter}
                inert={!matchesFilter}
                className={cn(
                  'grid transition-all duration-500',
                  demoEase,
                  matchesFilter ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0',
                )}
              >
                <div className="overflow-hidden">
                  <div className={cn('mb-2 min-w-0 rounded-xl', demoSoftTile)}>
                    <button
                      type="button"
                      aria-expanded={isOpen}
                      onClick={() => setSelectedCode(isOpen ? null : shipment.code)}
                      className="grid w-full min-w-0 cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-xl px-3 py-2.5 text-start transition-colors hover:bg-black/[0.04] dark:hover:bg-white/[0.06]"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-xs font-medium tabular-nums">
                          {shipment.code} · {shipment.courier}
                        </p>
                        <p className={cn('truncate text-[11px]', demoMutedText)}>
                          {shipment.destination}
                        </p>
                      </div>
                      <StatusPill label={shipment.status} tone={shipment.tone} />
                    </button>
                    <ShipmentTimeline shipment={shipment} isOpen={isOpen} />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
