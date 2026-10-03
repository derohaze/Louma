import type { Metadata } from 'next';
import { PricingPageClient } from './page.client';
import { faqKeys } from './data';
import { createMetadata } from '@/lib/metadata';
import { StructuredData } from '@/components/structured-data';
import { siteConfig } from '@/lib/site';
import { createT, getRequestLanguage, sectionIn } from '@/lib/i18n';

export async function generateMetadata(): Promise<Metadata> {
  const t = createT(await getRequestLanguage(), 'pricing');

  return createMetadata({
    title: t('seo.title'),
    description: t('seo.description'),
    path: '/pricing',
  });
}

export default async function PricingPage() {
  const language = await getRequestLanguage();
  const pricing = sectionIn(language, 'pricing');

  // Rebuilt per request: the questions a search engine reads have to match the page it lands on.
  const structuredData = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    '@id': `${siteConfig.url}/pricing#faq`,
    mainEntity: faqKeys.map((key) => ({
      '@type': 'Question',
      name: pricing.faq[key].question,
      acceptedAnswer: { '@type': 'Answer', text: pricing.faq[key].answer },
    })),
  };

  return (
    <>
      <StructuredData value={structuredData} />
      <PricingPageClient />
    </>
  );
}