'use client';

import { HugeiconsIcon } from '@hugeicons/react';
import {
  ChartBarBigIcon,
  File01Icon,
  Package01Icon,
  ShippingTruck01Icon,
} from '@hugeicons/core-free-icons';
import { cn } from '@/lib/cn';
import { demoMutedText, demoSoftTile } from '../tokens';
import { demoProducts } from '../data';
import { Reveal, SectionCard, ShortcutStat, StatusPill } from '../shared';

export function ProductsDemoPage() {
  return (
    <div className="w-full max-w-full min-w-0 space-y-4 overflow-hidden">
      <Reveal index={0}>
        <h2 className="text-xl font-semibold md:text-2xl">Wallet</h2>
      </Reveal>
      <div className="grid w-full max-w-full min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <ShortcutStat label="Addresses" value="248" detail="231 active" icon="Package01Icon" index={1} />
        <ShortcutStat label="Low balance" value="9" detail="needs top-up" icon="ShippingTruck01Icon" index={2} />
        <ShortcutStat label="Empty" value="8" detail="hidden" icon="File01Icon" index={3} />
        <ShortcutStat label="Types" value="14" detail="synced" icon="ChartBarBigIcon" index={4} />
      </div>
      <Reveal index={5}>
        <SectionCard title="Receiving addresses">
          <div className="space-y-2">
            {demoProducts.map((product) => (
              <div
                key={product.sku}
                className={cn(
                  'grid min-w-0 grid-cols-[2.25rem_minmax(0,1fr)] items-center gap-3 rounded-xl px-3 py-2.5 transition-colors sm:grid-cols-[2.25rem_minmax(0,1fr)_auto_auto] hover:bg-black/[0.04] dark:hover:bg-white/[0.06]',
                  demoSoftTile,
                )}
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-black/[0.06] dark:bg-white/[0.07]">
                  <HugeiconsIcon icon={Package01Icon} size={16} strokeWidth={1.8} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium">{product.name}</p>
                  <p className={cn('text-[11px] tabular-nums', demoMutedText)}>
                    {product.sku} · {product.stock} transfers
                  </p>
                </div>
                <span className="hidden whitespace-nowrap text-xs font-semibold tabular-nums sm:inline">{product.price}</span>
                <StatusPill label={product.status} tone={product.tone} />
              </div>
            ))}
          </div>
        </SectionCard>
      </Reveal>
    </div>
  );
}
