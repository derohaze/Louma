import type { Metadata } from 'next';
import { cn } from '@/lib/cn';
import { ScrollReveal } from '@/components/scroll-reveal';
import { releases } from './releases';
import { createMetadata } from '@/lib/metadata';
import { createT, getRequestLanguage, sectionIn } from '@/lib/i18n';

const tagStyles: Record<string, string> = {
  new: 'bg-brand/10 text-brand',
  improved: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
  fixed: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
};

export async function generateMetadata(): Promise<Metadata> {
  const t = createT(await getRequestLanguage(), 'changelog');

  return createMetadata({
    title: t('seo.title'),
    description: t('seo.description'),
    path: '/changelog',
  });
}

export default async function ChangelogPage() {
  const language = await getRequestLanguage();
  const t = createT(language, 'changelog');
  const changelog = sectionIn(language, 'changelog');

  const english = sectionIn('en', 'changelog');

  /**
   * Each release in the dictionary is matched to the version in `releases.ts`; the English file is
   * the one that fixes the order and the count. A release missing from the selected language falls
   * back to its English copy with a development warning — it must never silently disappear from
   * the public timeline because of a routine one-file update.
   */
  const timeline = releases.flatMap((release) => {
    const copy = changelog.releases.find((entry) => entry.version === release.version);
    const fallback = english.releases.find((entry) => entry.version === release.version);
    if (!copy && process.env.NODE_ENV === 'development') {
      console.warn(
        `[i18n] missing changelog entry: version ${release.version} (${language}) — showing English copy`,
      );
    }
    const entry = copy ?? fallback;
    return entry ? [{ ...release, ...entry }] : [];
  });

  return (
    <main className="text-landing-foreground dark:text-landing-foreground-dark">
      <div className="mx-auto w-full max-w-[1100px] px-6 pt-16 pb-24 md:px-12">
        <header className="pb-6">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-fd-muted-foreground">
            {t('header.eyebrow')}
          </p>
          <h1 className="mt-3 text-4xl font-medium tracking-tight lg:text-5xl">{t('header.title')}</h1>
          <p className="mt-4 max-w-2xl text-fd-muted-foreground">{t('header.description')}</p>
        </header>

        {/* Cursor-style release feed: each release is a two-column section. The left rail (version + date) is sticky, so it travels with you through its own release and hands off to the next one's rail as you keep scrolling. */}
        {timeline.map((release, index) => (
          <section
            key={release.version}
            id={`v${release.version.replace('.', '-')}`}
            className="grid scroll-mt-28 gap-x-12 gap-y-6 border-t py-14 lg:grid-cols-[200px_1fr]"
          >
            {/* Sticky meta rail */}
            <div className="h-fit lg:sticky lg:top-28">
              <div className="flex items-baseline gap-3 lg:flex-col lg:gap-2">
                <p className="text-3xl font-medium tracking-tight tabular-nums lg:text-4xl">
                  <span className="text-fd-muted-foreground">v</span> {release.version}
                </p>
                <time className="text-sm font-medium text-fd-muted-foreground">{release.date}</time>
                {index === 0 && (
                  <span className="w-fit rounded-full bg-brand/10 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand">
                    {t('latest')}
                  </span>
                )}
              </div>
            </div>

            {/* Release body */}
            <div className="min-w-0">
              <ScrollReveal>
                <h2 className="text-2xl font-medium tracking-tight lg:text-3xl">{release.title}</h2>
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
                      {t('alsoIn')}
                    </p>
                    <ul className="mt-4 flex flex-col gap-3">
                      {release.entries.map((entry) => (
                        <li key={entry.text} className="flex items-start gap-3">
                          <span
                            className={cn(
                              'mt-0.5 w-[72px] shrink-0 rounded-md px-2 py-0.5 text-center text-[11px] font-semibold',
                              tagStyles[entry.tag] ?? tagStyles.new,
                            )}
                          >
                            {t(`tags.${entry.tag}` as 'tags.new')}
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