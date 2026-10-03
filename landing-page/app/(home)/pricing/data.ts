export type BillingCycle = 'monthly' | 'yearly';

export type PlanStatus = 'available' | 'coming-soon';

export type PlanId = 'basic' | 'pro';

/**
 * What the pricing page needs that is not a word: which plans exist, what they cost, and how a card
 * is laid out. Every label — the plan name, its tagline, the feature list, the FAQ — comes from
 * `lib/i18n/locales/pricing`, so the page reads as one document in either language instead of two
 * lists that can drift apart.
 */
export type PricingPlan = {
  id: PlanId;
  monthlyPrice: number;
  yearlyPrice: number;
  status: PlanStatus;
  /** Elevated card that overlaps its neighbour. */
  featured?: boolean;
  badge?: boolean;
};

/** The feature list is addressed by index because its length is part of the English layout. */
export const BASIC_FEATURE_COUNT = 10;

export const plans: PricingPlan[] = [
  {
    id: 'basic',
    monthlyPrice: 0,
    yearlyPrice: 0,
    status: 'available',
  },
  {
    id: 'pro',
    monthlyPrice: 5,
    yearlyPrice: 4,
    status: 'coming-soon',
    featured: true,
    badge: true,
  },
];

/** The pricing FAQ, in the order the accordion renders it. */
export const faqKeys = ['available', 'pro', 'limits', 'changes'] as const;