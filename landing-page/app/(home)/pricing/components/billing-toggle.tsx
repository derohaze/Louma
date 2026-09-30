'use client';

import { cn } from '@/lib/cn';
import type { BillingCycle } from '../data';

export function BillingToggle({
  billingCycle,
  onChange,
}: {
  billingCycle: BillingCycle;
  onChange: (value: BillingCycle) => void;
}) {
  return (
    <div className="mt-4 grid w-[178px] grid-cols-2 rounded-full bg-fd-secondary p-1 dark:bg-[#1b1b1b]">
      {(['monthly', 'yearly'] as const).map((cycle) => (
        <button
          key={cycle}
          type="button"
          aria-pressed={billingCycle === cycle}
          onClick={() => onChange(cycle)}
          className={cn(
            'rounded-full px-3 py-1 text-xs font-semibold text-fd-muted-foreground transition-colors md:text-sm',
            billingCycle === cycle &&
              'bg-fd-card text-fd-foreground shadow-sm dark:bg-[#2f2f2f] dark:text-white',
          )}
        >
          {cycle === 'monthly' ? 'Monthly' : 'Yearly'}
        </button>
      ))}
    </div>
  );
}
