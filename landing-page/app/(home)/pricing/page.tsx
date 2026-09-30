import { PricingPageClient } from './page.client';
import { faqItems } from './data';
import { createMetadata } from '@/lib/metadata';
import { StructuredData } from '@/components/structured-data';
import { siteConfig } from '@/lib/site';

export const metadata = createMetadata({
  title: 'Pricing',
  description: 'Compare Louma plans for wallet accounts, connected services, mining, automation, and transaction search workflows.',
  path: '/pricing',
});

const structuredData = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  '@id': `${siteConfig.url}/pricing#faq`,
  mainEntity: faqItems.map((faq) => ({
    '@type': 'Question',
    name: faq.question,
    acceptedAnswer: { '@type': 'Answer', text: faq.answer },
  })),
};

export default function PricingPage() {
  return (
    <>
      <StructuredData value={structuredData} />
      <PricingPageClient />
    </>
  );
}
