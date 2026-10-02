export type BillingCycle = 'monthly' | 'yearly';

export type PlanStatus = 'available' | 'coming-soon';

export type PricingPlan = {
  name: string;
  tagline: string;
  monthlyPrice: number;
  yearlyPrice: number;
  status: PlanStatus;
  buttonLabel: string;
  /** Elevated card that overlaps its neighbour. */
  featured?: boolean;
  badge?: string;
  /** Only present on available plans. */
  features?: string[];
  /** Shown instead of the feature list when status is 'coming-soon'. */
  note?: string;
};

export type FaqItem = {
  question: string;
  answer: string;
};

export const annualSavingsLabel = 'Save 20%';

export const plans: PricingPlan[] = [
  {
    name: 'Basic',
    tagline: 'Everything available today, free forever.',
    monthlyPrice: 0,
    yearlyPrice: 0,
    status: 'available',
    buttonLabel: 'Get Basic',
    features: [
      'Send and receive LMA',
      'Live balance overview',
      'Receiving address with QR code',
      'Transfer feed with filtering and contact labels',
      'Settlement status and confirmation events',
      'Mining rewards, tracked by cycle',
      'Transaction history and search',
      'Receipts and transaction statements as CSV',
      'Transfer password and 2FA approvals',
      'Security centre and active sessions',
    ],
  },
  {
    name: 'Pro',
    tagline: 'For heavier use. Not available yet.',
    monthlyPrice: 5,
    yearlyPrice: 4,
    status: 'coming-soon',
    buttonLabel: 'Coming soon',
    featured: true,
    badge: 'Coming soon',
    note: 'Pro is not available yet. Everything you can use today is included in the Free plan.',
  },
];

export const faqItems: FaqItem[] = [
  {
    question: 'Which plans are available right now?',
    answer:
      'Only Basic. It is free, needs no payment details, and includes the full wallet feature set — transfers, balance, addresses, mining, history, and security.',
  },
  {
    question: 'What does Pro include?',
    answer:
      'Pro is priced at $5 per month. No Pro-only features have shipped yet, so there is nothing extra to use today and nothing to buy.',
  },
  {
    question: 'Are transfers limited?',
    answer:
      'No. Sending and receiving LMA is not capped by the plan — the Free plan includes the full wallet feature set, with no monthly transfer limit.',
  },
  {
    question: 'Can these packages change later?',
    answer:
      'Yes. We may update packaging over time, and existing account holders will receive advance notice before any plan change affects their account.',
  },
];
