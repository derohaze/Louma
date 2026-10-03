import type { Metadata } from 'next';
import { createMetadata } from '@/lib/metadata';
import { StructuredData } from '@/components/structured-data';
import { siteConfig } from '@/lib/site';
import { RichText } from '@/components/rich-text';
import { createT, getRequestLanguage, sectionIn } from '@/lib/i18n';

const COVER_KEYS = ['transfers', 'wallet', 'contacts', 'settlement', 'mining', 'history'] as const;

export async function generateMetadata(): Promise<Metadata> {
  const t = createT(await getRequestLanguage(), 'about');

  return createMetadata({ title: t('seo.title'), description: t('seo.description'), path: '/about' });
}

export default async function AboutPage() {
  const language = await getRequestLanguage();
  const t = createT(language, 'about');
  const about = sectionIn(language, 'about');

  // Rebuilt per request: the wording a crawler reads has to match the page it lands on.
  const structuredData = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'AboutPage',
        '@id': `${siteConfig.url}/about#webpage`,
        url: `${siteConfig.url}/about`,
        name: t('title'),
        description: t('seo.description'),
        isPartOf: { '@id': `${siteConfig.url}/#website` },
        breadcrumb: {
          '@type': 'BreadcrumbList',
          itemListElement: [
            { '@type': 'ListItem', position: 1, name: 'Home', item: siteConfig.url },
            { '@type': 'ListItem', position: 2, name: t('title'), item: `${siteConfig.url}/about` },
          ],
        },
      },
      {
        '@type': 'Organization',
        '@id': `${siteConfig.url}/#organization`,
        name: siteConfig.name,
        url: siteConfig.url,
        description: t('seo.description'),
        sameAs: [`${siteConfig.url}/features`, `${siteConfig.url}/pricing`],
      },
    ],
  };

  return (
    <main className="mx-auto w-full max-w-[860px] px-4 pb-12 pt-8 md:py-12">
      <StructuredData value={structuredData} />
      <h1 className="text-3xl font-semibold tracking-tight mb-6">{t('title')}</h1>

      <div className="space-y-6 text-lg leading-9 text-fd-foreground">
        {about.paragraphs.map((paragraph, index) => (
          <p key={index}>
            <RichText text={paragraph} highlightClassName="font-bold" />
          </p>
        ))}
      </div>

      <div className="mt-12 rounded-2xl border bg-fd-card p-6 shadow-sm md:p-10">
        <h2 className="text-xl font-semibold tracking-tight mb-6">{t('covers.title')}</h2>
        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {COVER_KEYS.map((key) => (
            <div key={key} className="py-3">
              <dt className="font-medium">{t(`covers.items.${key}.term` as 'covers.items.wallet.term')}</dt>
              <dd className="mt-1 text-sm text-fd-muted-foreground leading-6">
                {t(`covers.items.${key}.detail` as 'covers.items.wallet.detail')}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </main>
  );
}