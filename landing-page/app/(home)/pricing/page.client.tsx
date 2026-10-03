'use client';

import { useState } from 'react';
import { BillingToggle } from './components/billing-toggle';
import { FaqSection } from './components/faq-section';
import { PlanCard } from './components/plan-card';
import { plans } from './data';
import type { BillingCycle } from './data';
import { useT } from '@/lib/i18n';

export function PricingPageClient() {
  const t = useT('pricing');
  const [billingCycle, setBillingCycle] = useState<BillingCycle>('monthly');

  return (
    <main className="min-h-screen bg-fd-background px-5 pb-16 pt-20 text-fd-foreground dark:bg-[#0A0A0A] md:px-8">
      <section className="mx-auto w-full max-w-[980px]">
        <div className="flex flex-col items-center text-center">
          <h1 className="text-balance text-4xl font-semibold leading-[1.05] tracking-tight md:text-6xl">
            {t('hero.title')}
          </h1>
          <p className="mt-5 max-w-xl text-sm leading-6 text-fd-muted-foreground md:text-base">
            {t('hero.body')}
          </p>

          <BillingToggle billingCycle={billingCycle} onChange={setBillingCycle} />
        </div>

        <div className="relative mt-12 grid w-full grid-cols-1 items-stretch gap-5 rounded-[2rem] bg-[#f2f2f2] p-4 sm:grid-cols-2 sm:gap-6 dark:bg-[#0f0f0f]">
          {plans.map((plan) => (
            <PlanCard key={plan.id} billingCycle={billingCycle} plan={plan} />
          ))}
        </div>
      </section>

      <FaqSection />
    </main>
  );
}