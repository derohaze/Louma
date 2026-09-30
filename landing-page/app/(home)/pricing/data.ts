export type BillingCycle = 'monthly' | 'yearly';

export type PricingPlan = {
  name: string;
  monthlyPrice: number;
  yearlyPrice: number;
  intro: string;
  buttonLabel: string;
  features: string[];
};

export type FaqItem = {
  question: string;
  answer: string;
};

export const plans: PricingPlan[] = [
  {
    name: 'Basic',
    monthlyPrice: 0,
    yearlyPrice: 0,
    intro: 'Includes:',
    buttonLabel: 'Get Basic',
    features: [
      '1 account',
      '1 wallet',
      '50 transfers / month',
      'Connected services',
      'Basic activity timeline',
      'Manual address book',
    ],
  },
  {
    name: 'Starter',
    monthlyPrice: 19,
    yearlyPrice: 15,
    intro: 'Everything in Basic, plus:',
    buttonLabel: 'Get Starter',
    features: [
      '1 account',
      '1 wallet',
      '750 transfers / month',
      'Transfer risk checks',
      'Settlement tracking',
      'Receipt templates',
      'Transfer notifications',
      'Basic activity reports',
    ],
  },
  {
    name: 'Pro',
    monthlyPrice: 49,
    yearlyPrice: 39,
    intro: 'Everything in Starter, plus:',
    buttonLabel: 'Get Pro',
    features: [
      '1 account',
      '1 wallet',
      '3,000 transfers / month',
      'Bulk transfer queues',
      'Recipient groups',
      'Risk review tools',
      'Custom address QR codes',
      'Statement templates',
      'Saved search queries',
      'Full history export',
    ],
  },
  {
    name: 'Max',
    monthlyPrice: 99,
    yearlyPrice: 79,
    intro: 'Everything in Pro, plus:',
    buttonLabel: 'Get Max',
    features: [
      '1 account',
      '3 wallets',
      '10,000 transfers / month',
      'Advanced risk screening',
      'Advanced transaction search',
      'Automated activity reports',
      'Balance snapshots',
      'Mining insights',
      'Realtime wallet alerts',
      'In-app support',
    ],
  },
  {
    name: 'Ultra',
    monthlyPrice: 199,
    yearlyPrice: 159,
    intro: 'Everything in Max, plus:',
    buttonLabel: 'Get Ultra',
    features: [
      '1 account',
      '5 wallets',
      '25,000 transfers / month',
      'Priority risk review',
      'Advanced activity insights',
      'Statement download links',
      'Receipt delivery tracking',
      'Admin controls',
      'Priority account support',
    ],
  },
];

export const faqItems: FaqItem[] = [
  {
    question: 'What plan should I start with?',
    answer:
      'Start with Basic if you are testing one account and one wallet. Starter is for regular transfers, and Pro is the first serious wallet plan.',
  },
  {
    question: 'How do transfer limits work?',
    answer:
      'Transfer limits are per wallet per month. Every plan gets one account; paid plans increase wallet capacity and transfer volume instead of changing the core model.',
  },
  {
    question: 'Do all plans support connected services?',
    answer:
      'Yes. Connected services are a normal wallet capability. Free/Basic does not include settlement, while paid plans add settlement workflows.',
  },
  {
    question: 'Which plans include risk protection?',
    answer:
      'Starter includes basic risk checks. Pro adds review tooling. Max and Ultra include advanced risk screening and deeper review workflows.',
  },
  {
    question: 'Where does transaction search fit?',
    answer:
      'Saved search queries start in Pro. Max adds the full history search set for accounts that need deeper transaction discovery.',
  },
  {
    question: 'Do reports and receipts run automatically?',
    answer:
      'Max adds automated activity reports and statement templates. Ultra adds receipt delivery tracking and statement download links for more control.',
  },
  {
    question: 'Can these packages change later?',
    answer:
      'Yes. We may update packaging over time, and existing account holders will receive advance notice before any plan change affects their account.',
  },
];
