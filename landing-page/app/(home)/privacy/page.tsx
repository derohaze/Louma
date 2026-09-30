import { LegalPage } from '@/components/layouts/legal-page';
import { privacySections } from './sections';
import { createMetadata } from '@/lib/metadata';

export const metadata = createMetadata({
  title: 'Privacy Policy',
  description:
    'How Louma collects, uses, protects, and shares data across the wallet.',
  path: '/privacy',
});
export default function PrivacyPage() {
  return (
    <LegalPage
      eyebrow="Legal"
      title="Privacy Policy"
      description="How Louma collects, uses, protects, and shares data across the wallet."
      lastUpdated="June 1, 2026"
      sections={privacySections}
    />
  );
}
