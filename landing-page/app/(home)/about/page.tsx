import { createMetadata } from '@/lib/metadata';
import { StructuredData } from '@/components/structured-data';
import { siteConfig } from '@/lib/site';

export const metadata = createMetadata({
  title: 'About Louma',
  description:
    'Louma is a digital wallet for holding, sending, and receiving LMA, with clear balance, transfers, mining, and history in one place.',
  path: '/about',
});

const structuredData = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'AboutPage',
      '@id': `${siteConfig.url}/about#webpage`,
      url: `${siteConfig.url}/about`,
      name: 'About Louma',
      description: siteConfig.description,
      isPartOf: { '@id': `${siteConfig.url}/#website` },
      breadcrumb: {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Home', item: siteConfig.url },
          { '@type': 'ListItem', position: 2, name: 'About', item: `${siteConfig.url}/about` },
        ],
      },
    },
    {
      '@type': 'Organization',
      '@id': `${siteConfig.url}/#organization`,
      name: siteConfig.name,
      url: siteConfig.url,
      logo: `${siteConfig.url}/whitelogo.svg`,
      description: siteConfig.description,
      sameAs: [`${siteConfig.url}/features`, `${siteConfig.url}/pricing`],
    },
  ],
};

export default function AboutPage() {
  return (
    <main className="mx-auto w-full max-w-[860px] px-4 pb-12 pt-8 md:py-12">
      <StructuredData value={structuredData} />
      <h1 className="text-3xl font-semibold tracking-tight mb-6">About Louma</h1>

      <div className="space-y-6 text-lg leading-9 text-fd-foreground">
        <p>
          Louma is a <strong>digital wallet for holding, sending, and receiving LMA</strong> that brings
          balance, transfers, contacts, settlement, mining, and history into one reliable
          place.
        </p>
        <p>
          People spend too much time switching between wallets, block explorers,
          and spreadsheets. Louma connects those tools through a single view so daily
          work — from checking balance to sending LMA to reviewing history — happens in one
          place.
        </p>
        <p>
          The wallet is built around clear account boundaries. Every account holds one wallet in full
          isolation with its own protection, so you can work without
          shared access or permission conflicts.
        </p>
        <p>
          Louma also includes structured workflows for{' '}
          <strong>
            transaction search by amount, address, date, and note
          </strong>{' '}
          — so any transfer is a few keystrokes away in your complete history.
        </p>
      </div>

      <div className="mt-12 rounded-2xl border bg-fd-card p-6 shadow-sm md:p-10">
        <h2 className="text-xl font-semibold tracking-tight mb-6">What Louma covers</h2>
        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {[
            ['Transfers', 'Send and receive LMA, with live status and settlement tracking.'],
            ['Wallet', 'Balance and receiving address, always ready to share.'],
            ['Contacts', 'Recipient records across all your connected services.'],
            ['Settlement', 'Confirmation events, status, and exception alerts.'],
            ['Mining', 'Earn LMA against a live rate, tracked by mining cycle.'],
            ['History', 'Every transaction, searchable and filterable in seconds.'],
          ].map(([term, detail]) => (
            <div key={term} className="py-3">
              <dt className="font-medium">{term}</dt>
              <dd className="mt-1 text-sm text-fd-muted-foreground leading-6">{detail}</dd>
            </div>
          ))}
        </dl>
      </div>
    </main>
  );
}
