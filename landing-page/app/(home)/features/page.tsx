import type { Metadata } from 'next';
import { createMetadata } from '@/lib/metadata';
import { StructuredData } from '@/components/structured-data';
import { siteConfig } from '@/lib/site';
import { cn } from '@/lib/cn';
import { cva } from 'class-variance-authority';
import { createT, getRequestLanguage, sectionIn } from '@/lib/i18n';

/** One card per feature; the wording comes from `locales/features`. */
const FEATURE_KEYS = [
  'transfers',
  'wallet',
  'overview',
  'settlement',
  'mining',
  'connectedServices',
  'history',
  'statements',
  'review',
  'security',
] as const;

const FAQ_KEYS = ['transferFeatures', 'connectedServices', 'search', 'oneWallet'] as const;

export async function generateMetadata(): Promise<Metadata> {
  const t = createT(await getRequestLanguage(), 'features');

  return createMetadata({
    title: t('seo.title'),
    description: t('seo.description'),
    path: '/features',
  });
}

const cardVariants = cva('rounded-2xl border bg-fd-card p-6 shadow-sm');

export default async function FeaturesPage() {
  const language = await getRequestLanguage();
  const t = createT(language, 'features');
  const featuresCopy = sectionIn(language, 'features');

  // Rebuilt per request: the wording a crawler reads has to match the page it lands on.
  const structuredData = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebPage',
        '@id': `${siteConfig.url}/features#webpage`,
        url: `${siteConfig.url}/features`,
        name: t('seo.title'),
        description: t('seo.description'),
        isPartOf: { '@id': `${siteConfig.url}/#website` },
        breadcrumb: {
          '@type': 'BreadcrumbList',
          itemListElement: [
            { '@type': 'ListItem', position: 1, name: 'Home', item: siteConfig.url },
            { '@type': 'ListItem', position: 2, name: t('seo.title'), item: `${siteConfig.url}/features` },
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
        featureList: FEATURE_KEYS.map((key) => featuresCopy.list[key].name),
      },
      {
        '@type': 'FAQPage',
        '@id': `${siteConfig.url}/features#faq`,
        mainEntity: FAQ_KEYS.map((key) => ({
          '@type': 'Question',
          name: featuresCopy.faq[key].question,
          acceptedAnswer: { '@type': 'Answer', text: featuresCopy.faq[key].answer },
        })),
      },
    ],
  };

  return (
    <main className="mx-auto w-full max-w-page px-4 pb-12 pt-8 md:py-12">
      <StructuredData value={structuredData} />
      <div className="mb-12 max-w-2xl">
        <h1 className="text-3xl font-semibold tracking-tight mb-4">{t('hero.title')}</h1>
        <p className="text-lg text-fd-muted-foreground leading-8">{t('hero.body')}</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 mb-16">
        {FEATURE_KEYS.map((key) => (
          <div key={key} className={cn(cardVariants())}>
            <h2 className="font-semibold mb-2">{t(`list.${key}.name` as 'list.transfers.name')}</h2>
            <p className="text-sm text-fd-muted-foreground leading-7">
              {t(`list.${key}.description` as 'list.transfers.description')}
            </p>
          </div>
        ))}
      </div>

      <section
        id="faq"
        aria-labelledby="features-faq-heading"
        className="rounded-2xl border bg-fd-card p-6 shadow-sm md:p-10"
      >
        <h2 id="features-faq-heading" className="text-2xl font-semibold tracking-tight mb-8">
          {t('faq.title')}
        </h2>
        <dl className="divide-y">
          {FAQ_KEYS.map((key) => {
            const faq = featuresCopy.faq[key];

            return (
              <div key={key} className="py-5 first:pt-0 last:pb-0">
                <dt className="font-medium">{faq.question}</dt>
                <dd className="mt-2 leading-7 text-fd-muted-foreground">{faq.answer}</dd>
              </div>
            );
          })}
        </dl>
      </section>
    </main>
  );
}