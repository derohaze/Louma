'use client';

import { useState } from 'react';
import { BillingToggle } from './components/billing-toggle';
import { FaqSection } from './components/faq-section';
import { PlanCard } from './components/plan-card';
import { plans } from './data';
import type { BillingCycle } from './data';

export function PricingPageClient() {
  const [billingCycle, setBillingCycle] = useState<BillingCycle>('monthly');

  return (
    <main className="min-h-screen bg-fd-background px-5 pb-16 pt-16 text-fd-foreground dark:bg-[#0A0A0A] md:px-8">
      <section className="mx-auto w-full max-w-[1500px]">
        <div className="flex flex-col items-center text-center">
          <h1 className="text-3xl font-medium leading-none tracking-normal text-fd-foreground md:text-5xl">
            Pricing
          </h1>
          <BillingToggle billingCycle={billingCycle} onChange={setBillingCycle} />
          <p className="mt-3 text-xs font-medium text-fd-muted-foreground">
            {billingCycle === 'yearly' ? 'Billed yearly' : 'Billed monthly'}
          </p>
        </div>

        <div className="mt-7 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
          {plans.map((plan) => (
            <PlanCard key={plan.name} billingCycle={billingCycle} plan={plan} />
          ))}
        </div>
      </section>

      <FaqSection />
    </main>
  );
}
