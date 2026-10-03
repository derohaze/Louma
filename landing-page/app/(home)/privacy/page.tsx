import type { Metadata } from 'next';
import { LegalPage } from '@/components/layouts/legal-page';
import { createMetadata } from '@/lib/metadata';
import { createT, getRequestLanguage, sectionIn } from '@/lib/i18n';

export async function generateMetadata(): Promise<Metadata> {
  const t = createT(await getRequestLanguage(), 'legal.privacy');

  return createMetadata({
    title: t('seo.title'),
    description: t('seo.description'),
    path: '/privacy',
  });
}

export default async function PrivacyPage() {
  const language = await getRequestLanguage();
  const t = createT(language, 'common');
  const privacy = sectionIn(language, 'legal.privacy');

  return (
    <LegalPage
      eyebrow={t('legal.eyebrow')}
      title={privacy.title}
      description={privacy.seo.description}
      lastUpdated={privacy.lastUpdated}
      sections={privacy.sections}
    />
  );
}