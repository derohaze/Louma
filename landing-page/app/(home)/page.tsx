import Image from 'next/image';
import { cn } from '@/lib/cn';
import Link from 'next/link';
import { cva } from 'class-variance-authority';
import { AgnosticBackground } from '@/app/(home)/page.client';
import { AntiSpamReviewPreview } from '@/app/(home)/anti-spam-review';
import {
  ModulesShowcaseDemo,
  NotificationsDemo,
  PdfTemplatesDemo,
  RevenueTrendDemo,
  SearchVisibilityDemo,
  SpamVerdictWindowDemo,
} from '@/components/engineers-demos';
import { DashboardDemo } from '@/app/(home)/dashboard-demo';
import StoryImage from './story.png';
import CLIImage from './cli.png';
import Bg2Image from './bg-2.png';
import { StoryPreviewDemo } from '@/components/demos';
import { siteConfig } from '@/lib/site';
import { createMetadata } from '@/lib/metadata';
import { StructuredData } from '@/components/structured-data';

export const metadata = createMetadata({
  title: 'Digital wallet for LMA',
  description: siteConfig.description,
  path: '/',
});

const homepageFaqItems = [
  {
    question: 'What is Louma?',
    answer:
      'Louma is a digital wallet for holding, sending, and receiving LMA. Balance, transfers, mining rewards, and transaction history live in one place, with a security centre for the account.',
  },
  {
    question: 'Who is Louma built for?',
    answer:
      'Louma is built for anyone who holds and moves LMA and wants one clear surface for it — no separate tools for balance, transfers, mining, and history.',
  },
  {
    question: 'How does Louma keep the account secure?',
    answer:
      'Protection lives inside the product: a security centre for passwords and active sessions, a confirmation step on every outgoing transfer, and a transaction history you can audit at any time.',
  },
] as const;

const structuredData = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'Organization',
      '@id': `${siteConfig.url}/#organization`,
      name: siteConfig.name,
      url: siteConfig.url,
      logo: `${siteConfig.url}/whitelogo.svg`,
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
    {
      '@type': 'FAQPage',
      '@id': `${siteConfig.url}/#faq`,
      mainEntity: homepageFaqItems.map((faq) => ({
        '@type': 'Question',
        name: faq.question,
        acceptedAnswer: { '@type': 'Answer', text: faq.answer },
      })),
    },
  ],
};

const headingVariants = cva('font-medium tracking-tight', {
  variants: {
    variant: {
      h2: 'text-3xl lg:text-4xl',
      h3: 'text-xl lg:text-2xl',
    },
  },
});

const buttonVariants = cva(
  'inline-flex justify-center px-5 py-3 rounded-full font-medium tracking-tight transition-colors',
  {
    variants: {
      variant: {
        primary: 'bg-[#fff383] text-black hover:bg-[#fff7c8]',
        secondary: 'border bg-fd-secondary text-fd-secondary-foreground hover:bg-fd-accent',
      },
    },
    defaultVariants: {
      variant: 'primary',
    },
  },
);

const cardVariants = cva('rounded-2xl text-sm p-6 bg-origin-border shadow-lg', {
  variants: {
    variant: {
      secondary: 'bg-brand-secondary text-brand-secondary-foreground',
      default: 'border bg-fd-card',
    },
  },
  defaultVariants: {
    variant: 'default',
  },
});

export default function Page() {
  return (
    <main className="overflow-x-hidden text-landing-foreground pt-4 pb-6 dark:text-landing-foreground-dark md:pb-12">
      <StructuredData value={structuredData} />
      <div className="relative mx-auto flex w-full max-w-[1400px] min-w-0 items-center overflow-hidden rounded-2xl border bg-origin-border">
        <Image
          src="/cover.svg"
          alt=""
          aria-hidden="true"
          fill
          priority
          sizes="100vw"
          className="pointer-events-none absolute inset-0 object-cover"
        />
        {/* Cursor-style hero: the interactive dashboard demo floats over the cover art */}
        <div className="z-2 w-full max-w-full min-w-0 overflow-hidden px-2 py-6 sm:px-6 sm:py-10 md:px-10 md:py-12 lg:py-10">
          <h1 className="sr-only">
            Louma digital wallet for holding, sending, and receiving LMA, with mining rewards and
            a complete transaction history
          </h1>
          <DashboardDemo />
        </div>
      </div>
      <div className="grid grid-cols-1 gap-10 mt-12 px-6 mx-auto w-full max-w-[1400px] md:px-12 lg:grid-cols-2 lg:mt-20">
        <p className="text-2xl tracking-tight leading-snug font-light col-span-full md:text-3xl xl:text-4xl">
          Louma is a <span className="text-brand font-medium">digital wallet</span> for holding,
          sending, and receiving <span className="text-brand font-medium">LMA</span>. It keeps
          balance, transfers, mining rewards, and transaction history in one reliable surface,
          backed by a security centre and a complete audit trail.
        </p>
        <div className="relative col-span-full z-2 overflow-hidden rounded-2xl p-4 md:p-8">
          <Image
            src={CLIImage}
            alt=""
            className="absolute inset-x-0 top-0 -z-1 h-[760px] w-full object-cover object-top"
          />
          <div className="mx-auto w-full max-w-[980px] rounded-2xl border bg-fd-card p-2 text-fd-card-foreground shadow-lg">
            <AntiSpamReviewPreview />
          </div>
        </div>
        <ForEngineers />
        <HomepageFaq />
      </div>
    </main>
  );
}

function HomepageFaq() {
  return (
    <section
      id="faq"
      aria-labelledby="homepage-faq-heading"
      className="col-span-full grid gap-8 rounded-2xl border bg-fd-card p-6 shadow-sm md:p-10 lg:grid-cols-[0.8fr_1.2fr]"
    >
      <div>
        <h2 id="homepage-faq-heading" className={cn(headingVariants({ variant: 'h2' }))}>
          Louma, answered clearly.
        </h2>
        <p className="mt-4 max-w-md text-fd-muted-foreground">
          Direct answers about the wallet, who it is for, and how it keeps the account secure.
        </p>
      </div>
      <dl className="divide-y">
        {homepageFaqItems.map((faq) => (
          <div key={faq.question} className="py-5 first:pt-0 last:pb-0">
            <dt className="font-medium">{faq.question}</dt>
            <dd className="mt-2 leading-7 text-fd-muted-foreground">{faq.answer}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function Story() {
  return (
    <div className="relative col-span-full z-2 overflow-hidden rounded-2xl border px-2 py-6 shadow-md">
      <Image
        src={StoryImage}
        alt=""
        className="pointer-events-none absolute inset-x-0 top-0 -z-1 h-[980px] w-full object-cover object-top"
      />

      <div className="m-auto w-full max-w-[640px] rounded-xl border bg-fd-card/80 p-2 text-start shadow-xl shadow-black/50 backdrop-blur-md dark:bg-fd-card/50">
        <div className="px-3 pt-3">
          <h2
            className={cn(
              headingVariants({
                className: 'mb-4',
                variant: 'h3',
              }),
            )}
          >
            Louma Transfer Flow
          </h2>
          <p className="mb-4 text-sm">
            Follow every transfer — confirmation states, timestamps, and any exceptions — in one
            live view, exactly like the Louma wallet.
          </p>
          <Link
            href="/docs/integrations"
            className={cn(buttonVariants({ variant: 'secondary', className: 'mb-4 py-2 text-sm' }))}
          >
            Explore transfers
          </Link>
        </div>
        <StoryPreviewDemo />
      </div>
    </div>
  );
}

function ForEngineers() {
  return (
    <>
      <h2
        className={cn(
          headingVariants({
            variant: 'h2',
            className: 'text-brand text-center mb-4 col-span-full',
          }),
        )}
      >
        Everything that moves your balance.
      </h2>

      <div className={cn(cardVariants(), 'relative flex flex-col overflow-hidden z-2')}>
        <h3
          className={cn(
            headingVariants({
              variant: 'h3',
              className: 'mb-6',
            }),
          )}
        >
          Built to fit how you already work.
        </h3>
        <p className="mb-20">
          Your balance, transfers, and mining rewards land in the same timeline — one place to
          look, whatever you started with.
        </p>

        <AgnosticBackground />
      </div>
      <div
        className={cn(
          cardVariants({
            className: 'flex flex-col',
          }),
        )}
      >
        <h3 className={cn(headingVariants({ variant: 'h3', className: 'mb-6' }))}>
          Clear boundaries underneath.
        </h3>
        <p className="mb-8">
          Separated as <span className="text-brand">Gateway</span> →{' '}
          <span className="text-brand">Core</span> → <span className="text-brand">Workers</span>,
          offering the clear service boundaries engineers need while you get one clean wallet for
          daily use.
        </p>
        <ModulesShowcaseDemo />
      </div>
      <div className={cn(cardVariants())}>
        <h3 className={cn(headingVariants({ variant: 'h3', className: 'mb-6' }))}>
          Every move, in one report.
        </h3>
        <p className="mb-4">
          Every transfer, mining payout, and balance change becomes a{' '}
          <span className="text-brand">live report</span> — no exports, no spreadsheets. Switch the
          metric and watch the trend redraw.
        </p>
        <div className="flex flex-row w-fit items-center gap-4 mb-6">
          {[
            {
              href: '/blog/integrations-without-chaos',
              text: 'Connected services',
            },
            {
              href: '/blog/importing-products-safely',
              text: 'Receiving LMA',
            },
            {
              href: '/blog/analytics-for-daily-decisions',
              text: 'Wallet activity',
            },
          ].map((item) => (
            <a
              key={item.href}
              href={item.href}
              rel="noreferrer noopener"
              target="_blank"
              className="text-sm text-brand hover:underline"
            >
              {item.text}
            </a>
          ))}
        </div>
        <RevenueTrendDemo />
      </div>
      <div
        className={cn(cardVariants({ className: 'relative overflow-hidden min-h-[400px] z-2' }))}
      >
        <Image
          src={Bg2Image}
          alt=""
          className="absolute inset-0 size-full object-cover object-top -z-1"
        />
        <NotificationsDemo className="absolute top-8 left-4 w-[70%] shadow-black" />
        <SpamVerdictWindowDemo className="absolute bottom-8 right-4 w-[60%] shadow-black" />
      </div>
      <div className={cn(cardVariants(), 'flex flex-col')}>
        <h3 className={cn(headingVariants({ variant: 'h3', className: 'mb-6' }))}>
          Find any transaction in seconds.
        </h3>
        <p className="mb-6">
          Every transfer is indexed the moment it settles —{' '}
          <span className="text-brand">amount</span>, <span className="text-brand">address</span>,
          and date, so the one you need is a keystroke away. Switch a filter to see how it narrows.
        </p>
        <SearchVisibilityDemo />
      </div>
      <div className={cn(cardVariants(), 'flex flex-col')}>
        <h3 className={cn(headingVariants({ variant: 'h3', className: 'mb-6' }))}>
          Receipts and statements, ready to send.
        </h3>
        <p className="mb-6">
          Receipts, statements, and transfer confirmations render as branded PDFs straight from
          your transaction data. Pick a document and watch it draw itself.
        </p>
        <PdfTemplatesDemo />
      </div>
      <Story />
    </>
  );
}
