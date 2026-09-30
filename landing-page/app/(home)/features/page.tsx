import { createMetadata } from '@/lib/metadata';
import { StructuredData } from '@/components/structured-data';
import { siteConfig } from '@/lib/site';
import { cn } from '@/lib/cn';
import { cva } from 'class-variance-authority';

export const metadata = createMetadata({
  title: 'Features',
  description:
    'Louma features: transfers, balance, settlement visibility, activity, connected services, and transaction search workflows — all in one digital wallet.',
  path: '/features',
});

const features = [
  {
    name: 'Transfers',
    description:
      'Live transfer feed with filtering, contact labels, suspicious transfer review, and settlement tracking across connected services — no tab switching.',
  },
  {
    name: 'Wallet',
    description:
      'Hold LMA in one place. Your balance and receiving address stay ready to share, and a custom address gives you a memorable one with its own QR code.',
  },
  {
    name: 'Overview',
    description:
      'Live balance and recent activity across every connected service. One view for what you hold, what moved, and what needs attention.',
  },
  {
    name: 'Settlement',
    description:
      'Live settlement status, confirmation events, and exception alerts in one timeline. Track every transfer from one view without switching apps.',
  },
  {
    name: 'Mining',
    description:
      'Earn LMA against a live rate, tracked by mining cycle. Watch your balance grow in one view — no exports, no spreadsheets.',
  },
  {
    name: 'Connected Services',
    description:
      'Services, networks, and tools connect through one integration layer. Transfers, confirmation events, and activity land in the same account timeline.',
  },
  {
    name: 'History',
    description:
      'Every transaction in one searchable, filterable record. Find any transfer by amount, address, date, or note in seconds.',
  },
  {
    name: 'Receipts & Statements',
    description:
      'Receipts and statements render as clean PDFs straight from transfer data. No templates to build — documents draw themselves.',
  },
  {
    name: 'Suspicious Transfer Review',
    description:
      'Automated risk scoring flags suspicious transfers before settlement. Review queue surfaces borderline cases with evidence so you decide fast.',
  },
  {
    name: 'Account Security',
    description:
      'One wallet per account. Passwords, active sessions, and account protection stay scoped to you — no shared access by design.',
  },
] as const;

const faqItems = [
  {
    question: 'What transfer features does Louma include?',
    answer:
      'Louma includes a live transfer feed with filtering, contact labels, suspicious transfer review, settlement tracking, and confirmation status — all in one wallet without switching between services.',
  },
  {
    question: 'Does Louma support multiple connected services?',
    answer:
      'Yes. Louma connects services, networks, and tools through one integration layer so transfers, confirmation events, and activity land in the same account.',
  },
  {
    question: 'How does Louma handle transaction search?',
    answer:
      'Louma lets you search every transfer by amount, address, date, or note, with filters and saved queries that surface any transaction in your history in seconds.',
  },
  {
    question: 'Is Louma one wallet per account?',
    answer:
      'Yes. Every Louma account holds one wallet. Your balance, addresses, and history stay scoped to you with no shared access by design.',
  },
] as const;

const structuredData = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'WebPage',
      '@id': `${siteConfig.url}/features#webpage`,
      url: `${siteConfig.url}/features`,
      name: 'Louma Features',
      description:
        'Transfers, wallet balance, settlement visibility, activity, connected services, and transaction search in one digital wallet.',
      isPartOf: { '@id': `${siteConfig.url}/#website` },
      breadcrumb: {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Home', item: siteConfig.url },
          { '@type': 'ListItem', position: 2, name: 'Features', item: `${siteConfig.url}/features` },
        ],
      },
    },
    {
      '@type': 'SoftwareApplication',
      '@id': `${siteConfig.url}/#software`,
      name: siteConfig.name,
      applicationCategory: 'BusinessApplication',
      operatingSystem: 'Web',
      url: siteConfig.url,
      featureList: features.map((f) => f.name),
    },
    {
      '@type': 'FAQPage',
      '@id': `${siteConfig.url}/features#faq`,
      mainEntity: faqItems.map((faq) => ({
        '@type': 'Question',
        name: faq.question,
        acceptedAnswer: { '@type': 'Answer', text: faq.answer },
      })),
    },
  ],
};

const cardVariants = cva('rounded-2xl border bg-fd-card p-6 shadow-sm');

export default function FeaturesPage() {
  return (
    <main className="mx-auto w-full max-w-page px-4 pb-12 pt-8 md:py-12">
      <StructuredData value={structuredData} />
      <div className="mb-12 max-w-2xl">
        <h1 className="text-3xl font-semibold tracking-tight mb-4">
          Everything your wallet needs in one place.
        </h1>
        <p className="text-lg text-fd-muted-foreground leading-8">
          Louma brings transfers, balance, contacts, settlement, mining, and history
          into one calm, reliable wallet.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 mb-16">
        {features.map((feature) => (
          <div key={feature.name} className={cn(cardVariants())}>
            <h2 className="font-semibold mb-2">{feature.name}</h2>
            <p className="text-sm text-fd-muted-foreground leading-7">{feature.description}</p>
          </div>
        ))}
      </div>

      <section
        id="faq"
        aria-labelledby="features-faq-heading"
        className="rounded-2xl border bg-fd-card p-6 shadow-sm md:p-10"
      >
        <h2 id="features-faq-heading" className="text-2xl font-semibold tracking-tight mb-8">
          Common questions about Louma features.
        </h2>
        <dl className="divide-y">
          {faqItems.map((faq) => (
            <div key={faq.question} className="py-5 first:pt-0 last:pb-0">
              <dt className="font-medium">{faq.question}</dt>
              <dd className="mt-2 leading-7 text-fd-muted-foreground">{faq.answer}</dd>
            </div>
          ))}
        </dl>
      </section>
    </main>
  );
}
