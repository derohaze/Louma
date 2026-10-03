'use client';

import NumberFlow from '@number-flow/react';
import { cn } from '@/lib/cn';
import { useSection, useT } from '@/lib/i18n';
import { BASIC_FEATURE_COUNT, type BillingCycle, type PricingPlan } from '../data';

export function PlanCard({
  plan,
  billingCycle,
}: {
  plan: PricingPlan;
  billingCycle: BillingCycle;
}) {
  const t = useT('pricing');
  const pricing = useSection('pricing');
  const price = billingCycle === 'yearly' ? plan.yearlyPrice : plan.monthlyPrice;
  const isComingSoon = plan.status === 'coming-soon';
  const copy = pricing.plans[plan.id];
  // Only the available plan carries a feature list; the coming-soon one carries a note instead.
  const features = 'features' in copy ? copy.features : [];

  return (
    <article
      className={cn(
        'relative flex flex-col rounded-[1.75rem] border border-fd-border bg-fd-card p-6 md:p-7 dark:border-[#252525] dark:bg-[#141414]',
        plan.featured && 'z-10 shadow-2xl shadow-black/10 sm:-my-4 sm:-ml-10 dark:shadow-black/60',
      )}
    >
      {plan.badge && (
        <span className="absolute right-6 top-6 rounded-full border border-fd-border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-fd-muted-foreground dark:border-[#2f2f2f]">
          {t(`plans.${plan.id}.badge` as 'plans.pro.badge')}
        </span>
      )}

      <h2 className="text-lg font-semibold tracking-tight md:text-xl">
        {t(`plans.${plan.id}.name` as 'plans.basic.name')}
      </h2>
      <p className="mt-1.5 max-w-[26ch] text-xs leading-5 text-fd-muted-foreground md:text-[13px]">
        {t(`plans.${plan.id}.tagline` as 'plans.basic.tagline')}
      </p>

      <div className="mt-6 flex items-baseline gap-1.5">
        {price === 0 ? (
          <span className="text-4xl font-semibold tracking-tight md:text-5xl">{t('card.free')}</span>
        ) : (
          <>
            <span className="text-4xl font-semibold tracking-tight tabular-nums md:text-5xl">
              $
              <NumberFlow
                value={price}
                format={{ minimumFractionDigits: 2, maximumFractionDigits: 2 }}
              />
            </span>
            <span className="text-xs font-medium text-fd-muted-foreground">{t('card.perMonth')}</span>
          </>
        )}
      </div>

      <div className="mt-6 h-px w-full bg-fd-border dark:bg-[#262626]" />

      <p className="mt-6 text-[10px] font-semibold uppercase tracking-[0.16em] text-fd-muted-foreground">
        {t('card.included')}
      </p>

      {isComingSoon ? (
        <div className="mt-4 rounded-2xl bg-fd-secondary px-4 py-4 dark:bg-[#1c1c1c]">
          <p className="text-xs font-semibold md:text-sm">{t('card.noFeaturesTitle')}</p>
          <p className="mt-2 text-[11px] font-medium leading-relaxed text-fd-muted-foreground md:text-xs">
            {t(`plans.${plan.id}.note` as 'plans.pro.note')}
          </p>
        </div>
      ) : (
        <ul className="mt-4 space-y-2.5 text-xs font-medium leading-snug md:text-[13px]">
          {features.slice(0, BASIC_FEATURE_COUNT).map((feature, index) => (
            <li key={index} className="flex gap-2.5">
              <span className="mt-0.5 text-fd-foreground" aria-hidden="true">
                &#10003;
              </span>
              <span>{feature}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-auto shrink-0 pt-7">
        <button
          type="button"
          disabled={isComingSoon}
          className={cn(
            'inline-flex h-11 w-full items-center justify-center rounded-full text-sm font-medium transition-colors',
            isComingSoon
              ? 'cursor-not-allowed border border-fd-border text-fd-muted-foreground dark:border-[#2f2f2f]'
              : 'bg-neutral-900 text-white hover:bg-neutral-700 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200',
          )}
        >
          {t(`plans.${plan.id}.action` as 'plans.basic.action')}
        </button>
      </div>
    </article>
  );
}