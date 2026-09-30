import { cn } from '@/lib/cn';
import { ScrollReveal } from '@/components/scroll-reveal';
import { releases, type ReleaseTag } from './releases';
import { createMetadata } from '@/lib/metadata';

export const metadata = createMetadata({
  title: 'Changelog',
  description: 'New features, improvements, and fixes shipped to the Louma wallet.',
  path: '/changelog',
});

const tagStyles: Record<ReleaseTag, string> = {
  New: 'bg-brand/10 text-brand',
  Improved: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
  Fixed: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
};

export default function ChangelogPage() {
  return (
    <main className="text-landing-foreground dark:text-landing-foreground-dark">
      <div className="mx-auto w-full max-w-[1100px] px-6 pt-16 pb-24 md:px-12">
        <header className="pb-6">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-fd-muted-foreground">
            Product
          </p>
          <h1 className="mt-3 text-4xl font-medium tracking-tight lg:text-5xl">Changelog</h1>
          <p className="mt-4 max-w-2xl text-fd-muted-foreground">
            Everything we ship — new features, improvements, and fixes, in one running record.
          </p>
        </header>

        {/*
          Cursor-style release feed: each release is a two-column section. The left
          rail (version + date) is sticky, so it travels with you through its own
          release and hands off to the next one's rail as you keep scrolling.
        */}
        {releases.map((release, index) => (
          <section
            key={release.version}
            id={`v${release.version.replace('.', '-')}`}
            className="grid scroll-mt-28 gap-x-12 gap-y-6 border-t py-14 lg:grid-cols-[200px_1fr]"
          >
            {/* Sticky meta rail */}
            <div className="h-fit lg:sticky lg:top-28">
              <div className="flex items-baseline gap-3 lg:flex-col lg:gap-2">
                <p className="text-3xl font-medium tracking-tight tabular-nums lg:text-4xl">
                  <span className="text-fd-muted-foreground">v</span>
                  {release.version}
                </p>
                <time className="text-sm font-medium text-fd-muted-foreground">
                  {release.date}
                </time>
                {index === 0 && (
                  <span className="w-fit rounded-full bg-brand/10 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand">
                    Latest
                  </span>
                )}
              </div>
            </div>

            {/* Release body */}
            <div className="min-w-0">
              <ScrollReveal>
                <h2 className="text-2xl font-medium tracking-tight lg:text-3xl">
                  {release.title}
                </h2>
                <p className="mt-3 max-w-2xl leading-relaxed text-fd-muted-foreground">
                  {release.summary}
                </p>
              </ScrollReveal>

              <div className="mt-8 flex flex-col gap-6">
                {release.highlights.map((highlight, highlightIndex) => (
                  <ScrollReveal key={highlight.title} delay={highlightIndex * 80}>
                    <div className="rounded-2xl border bg-fd-card p-6 shadow-sm transition-shadow duration-300 hover:shadow-md lg:p-7">
                      <h3 className="text-lg font-medium tracking-tight">{highlight.title}</h3>
                      <p className="mt-2.5 text-sm leading-relaxed text-fd-muted-foreground">
                        {highlight.description}
                      </p>
                    </div>
                  </ScrollReveal>
                ))}
              </div>

              {release.entries.length > 0 && (
                <ScrollReveal delay={120}>
                  <div className="mt-8">
                    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-fd-muted-foreground">
                      Also in this release
                    </p>
                    <ul className="mt-4 flex flex-col gap-3">
                      {release.entries.map((entry) => (
                        <li key={entry.text} className="flex items-start gap-3">
                          <span
                            className={cn(
                              'mt-0.5 w-[72px] shrink-0 rounded-md px-2 py-0.5 text-center text-[11px] font-semibold',
                              tagStyles[entry.tag],
                            )}
                          >
                            {entry.tag}
                          </span>
                          <p className="text-sm leading-relaxed text-fd-muted-foreground">
                            {entry.text}
                          </p>
                        </li>
                      ))}
                    </ul>
                  </div>
                </ScrollReveal>
              )}
            </div>
          </section>
        ))}
      </div>
    </main>
  );
}
