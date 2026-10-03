import type { Metadata } from 'next';
import { LegalPage } from '@/components/layouts/legal-page';
import { createMetadata } from '@/lib/metadata';
import { createT, getRequestLanguage, sectionIn } from '@/lib/i18n';

export async function generateMetadata(): Promise<Metadata> {
  const t = createT(await getRequestLanguage(), 'legal.terms');

  return createMetadata({
    title: t('seo.title'),
    description: t('seo.description'),
    path: '/terms',
  });
}

export default async function TermsPage() {
  const language = await getRequestLanguage();
  const t = createT(language, 'common');
  const terms = sectionIn(language, 'legal.terms');

  return (
    <LegalPage
      eyebrow={t('legal.eyebrow')}
      title={terms.title}
      description={terms.description}
      lastUpdated={terms.lastUpdated}
      sections={terms.sections}
    />
  );
}