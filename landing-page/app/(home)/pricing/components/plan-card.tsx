'use client';

import NumberFlow from '@number-flow/react';
import type { BillingCycle, PricingPlan } from '../data';

const buttonClassName =
  'mt-auto inline-flex h-11 w-[136px] items-center justify-center rounded-full bg-white px-6 text-sm font-medium text-black shadow-sm transition-colors hover:bg-neutral-100 dark:bg-white dark:text-black dark:hover:bg-neutral-100';

export function PlanCard({
  plan,
  billingCycle,
}: {
  plan: PricingPlan;
  billingCycle: BillingCycle;
}) {
  const price = billingCycle === 'yearly' ? plan.yearlyPrice : plan.monthlyPrice;

  return (
    <article className="flex min-h-[550px] flex-col rounded-3xl border border-fd-border bg-fd-card px-5 py-5 dark:border-[#252525] dark:bg-[#111111]">
      <h2 className="text-lg font-medium leading-none tracking-normal md:text-xl">{plan.name}</h2>
      <div className="mt-1.5 min-h-6 text-lg font-semibold leading-none text-fd-muted-foreground md:text-xl">
        {price === 0 ? (
          'Free'
        ) : (
          <span className="inline-flex items-baseline [--muted:var(--color-fd-muted-foreground)]">
            $
            <NumberFlow
              className="font-semibold leading-none"
              value={price}
              suffix="/mo."
              format={{ maximumFractionDigits: 0 }}
              willChange
            />
          </span>
        )}
      </div>
      <p className="mt-2 text-[11px] font-medium text-fd-muted-foreground">
        {price === 0
          ? 'Always free'
          : billingCycle === 'yearly'
            ? 'Billed yearly'
            : 'Billed monthly'}
      </p>

      <p className="mt-7 text-xs font-semibold text-fd-muted-foreground md:text-sm">
        {plan.intro}
      </p>
      <ul className="mt-4 space-y-2 text-xs font-semibold leading-snug md:text-sm">
        {plan.features.map((feature) => (
          <li key={feature} className="flex gap-3">
            <span className="mt-0.5 text-fd-foreground" aria-hidden="true">
              &#10003;
            </span>
            <span>{feature}</span>
          </li>
        ))}
      </ul>
      <button type="button" className={buttonClassName}>
        {plan.buttonLabel}
      </button>
    </article>
  );
}
