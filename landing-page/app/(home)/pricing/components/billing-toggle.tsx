'use client';

import { cn } from '@/lib/cn';
import { useT } from '@/lib/i18n';
import type { BillingCycle } from '../data';

const labelClass = (active: boolean) =>
  cn(
    'text-[10px] font-semibold uppercase tracking-[0.16em] transition-colors',
    active ? 'text-fd-foreground' : 'text-fd-muted-foreground hover:text-fd-foreground',
  );

export function BillingToggle({
  billingCycle,
  onChange,
}: {
  billingCycle: BillingCycle;
  onChange: (value: BillingCycle) => void;
}) {
  const t = useT('pricing');
  const yearly = billingCycle === 'yearly';

  return (
    <div className="mt-8 flex items-center justify-center gap-3">
      <button type="button" onClick={() => onChange('monthly')} className={labelClass(!yearly)}>
        {t('billing.monthly')}
      </button>

      <button
        type="button"
        role="switch"
        aria-checked={yearly}
        aria-label={t('billing.billAnnually')}
        onClick={() => onChange(yearly ? 'monthly' : 'yearly')}
        className={cn(
          'relative h-5 w-9 shrink-0 rounded-full transition-colors',
          yearly ? 'bg-neutral-900 dark:bg-white' : 'bg-fd-secondary dark:bg-[#2f2f2f]',
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 size-4 rounded-full bg-white shadow-sm transition-all duration-200 dark:bg-[#0a0a0a]',
            yearly ? 'left-[18px]' : 'left-0.5',
          )}
        />
      </button>

      <button type="button" onClick={() => onChange('yearly')} className={labelClass(yearly)}>
        {t('billing.annually')} · {t('billing.annualSavings')}
      </button>
    </div>
  );
}