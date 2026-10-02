import Image from 'next/image';
import { TransferAutomationHero } from '@/app/(home)/transfer-automation';
import { FeaturePillars } from '@/app/(home)/feature-pillars';
import { MiningGuard } from '@/app/(home)/mining-guard';
import { siteConfig } from '@/lib/site';
import { createMetadata } from '@/lib/metadata';
import { StructuredData } from '@/components/structured-data';

export const metadata = createMetadata({
  title: 'Digital wallet for LMA',
  description: siteConfig.description,
  path: '/',
});

const structuredData = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'Organization',
      '@id': `${siteConfig.url}/#organization`,
      name: siteConfig.name,
      url: siteConfig.url,
    },
    {
      '@type': 'WebSite',
      '@id': `${siteConfig.url}/#website`,
      name: siteConfig.name,
      url: siteConfig.url,
      publisher: { '@id': `${siteConfig.url}/#organization` },
    },
    {
      '@type': 'SoftwareApplication',
      '@id': `${siteConfig.url}/#software`,
      name: siteConfig.name,
      applicationCategory: 'FinanceApplication',
      operatingSystem: 'Web',
      url: siteConfig.url,
      description: siteConfig.description,
      publisher: { '@id': `${siteConfig.url}/#organization` },
      featureList: [
        'Balance overview',
        'Receiving addresses',
        'Custom address with QR code',
        'Send and receive LMA',
        'Mining rewards',
        'Transaction history',
        'Transaction search',
        'Security centre',
        'Profile and settings',
      ],
    },
  ],
};

export default function Page() {
  return (
    <main className="overflow-x-clip text-landing-foreground pt-4 pb-6 dark:text-landing-foreground-dark md:pb-12">
      <StructuredData value={structuredData} />
      <div className="relative mx-auto flex w-full max-w-[1400px] min-w-0 items-center overflow-hidden rounded-[2.5rem] border bg-origin-border">
        <Image
          src="/cover.svg"
          alt=""
          aria-hidden="true"
          fill
          priority
          sizes="100vw"
          className="pointer-events-none absolute inset-0 object-cover"
        />
        {/* Hero: formal LMA transfer-automation story over the cover art */}
        <div className="z-2 w-full max-w-full min-w-0 overflow-hidden px-2 py-6 sm:px-6 sm:py-10 md:px-10 md:py-12 lg:py-10">
          <h1 className="sr-only">
            Louma digital wallet for holding, sending, and receiving LMA, with mining rewards and
            a complete transaction history
          </h1>
          <TransferAutomationHero />
        </div>
      </div>
      <div className="grid grid-cols-1 gap-10 mt-12 px-6 mx-auto w-full max-w-[1400px] md:px-12 lg:grid-cols-2 lg:mt-20">
        <p className="text-2xl tracking-tight leading-snug font-light col-span-full md:text-3xl xl:text-4xl">
          Louma is a <span className="text-brand font-medium">digital wallet</span> for holding,
          sending, and receiving <span className="text-brand font-medium">LMA</span>. It keeps
          balance, transfers, mining rewards, and transaction history in one reliable surface,
          backed by a security centre and a complete audit trail.
        </p>
        <FeaturePillars />
        <MiningGuard />
      </div>
    </main>
  );
}
