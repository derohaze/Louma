import Link from 'next/link';
import type { ReactNode } from 'react';

export interface LegalSection {
  id: string;
  title: string;
  body: ReactNode;
}

/**
 * Shared shell for legal documents (Privacy, Terms). Enterprise layout:
 * eyebrow + title header, sticky table of contents on the left, and a
 * readable prose column — all on theme tokens so dark mode just works.
 */
export function LegalPage({
  eyebrow,
  title,
  description,
  lastUpdated,
  sections,
}: {
  eyebrow: string;
  title: string;
  description: string;
  lastUpdated: string;
  sections: LegalSection[];
}) {
  return (
    <main className="text-landing-foreground dark:text-landing-foreground-dark">
      <div className="mx-auto w-full max-w-[1100px] px-6 pt-16 pb-24 md:px-12">
        {/* Document header */}
        <header className="border-b pb-10">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-fd-muted-foreground">
            {eyebrow}
          </p>
          <h1 className="mt-3 text-4xl font-medium tracking-tight lg:text-5xl">{title}</h1>
          <p className="mt-4 max-w-2xl text-fd-muted-foreground">{description}</p>
          <p className="mt-6 inline-flex rounded-full border px-3 py-1 text-xs font-semibold text-fd-muted-foreground">
            Last updated: {lastUpdated}
          </p>
        </header>

        <div className="mt-12 flex flex-col gap-12 lg:flex-row lg:gap-16">
          {/* Sticky table of contents */}
          <nav
            aria-label="Table of contents"
            className="top-24 h-fit shrink-0 lg:sticky lg:w-56"
          >
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-fd-muted-foreground">
              On this page
            </p>
            <ol className="mt-4 flex flex-col gap-2.5 border-s ps-4">
              {sections.map((section, index) => (
                <li key={section.id}>
                  <a
                    href={`#${section.id}`}
                    className="block text-sm text-fd-muted-foreground transition-colors hover:text-fd-foreground"
                  >
                    <span className="me-1.5 tabular-nums">{index + 1}.</span>
                    {section.title}
                  </a>
                </li>
              ))}
            </ol>
          </nav>

          {/* Document body */}
          <div className="min-w-0 flex-1">
            {sections.map((section, index) => (
              <section
                key={section.id}
                id={section.id}
                className="scroll-mt-28 border-b py-8 first:pt-0 last:border-b-0"
              >
                <h2 className="text-xl font-medium tracking-tight lg:text-2xl">
                  <span className="me-2 text-fd-muted-foreground tabular-nums">{index + 1}.</span>
                  {section.title}
                </h2>
                <div className="mt-4 flex flex-col gap-4 text-[15px] leading-relaxed text-fd-muted-foreground [&_strong]:font-semibold [&_strong]:text-fd-foreground [&_ul]:flex [&_ul]:list-disc [&_ul]:flex-col [&_ul]:gap-2 [&_ul]:ps-5">
                  {section.body}
                </div>
              </section>
            ))}

            {/* Contact strip */}
            <div className="mt-12 rounded-2xl border bg-fd-card p-6">
              <p className="font-medium text-fd-card-foreground">Questions about this document?</p>
              <p className="mt-1.5 text-sm text-fd-muted-foreground">
                We read every message. Reach us any time at{' '}
                <a href="mailto:legal@louma.com" className="font-semibold text-brand hover:underline">
                  legal@louma.com
                </a>{' '}
                or through the{' '}
                <Link href="/docs" className="font-semibold text-brand hover:underline">
                  documentation
                </Link>
                .
              </p>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
