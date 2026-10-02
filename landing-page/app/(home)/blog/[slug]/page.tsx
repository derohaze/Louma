import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { getBlogPost, getBlogPosts } from '@/lib/blog';
import { createMetadata } from '@/lib/metadata';
import { buttonVariants } from '@/components/ui/button';
import { ShareButton } from '@/app/(home)/blog/[slug]/page.client';
import { cn } from '@/lib/cn';
import { siteConfig } from '@/lib/site';
import { StructuredData } from '@/components/structured-data';

function sanitizeMarkdown(content: string): string {
  return content
    .replace(/^import .+$/gm, '')
    .replace(/<[^>]+>/g, '')
    .trim();
}

function isTableRow(line: string): boolean {
  return line.trim().startsWith('|') && line.trim().endsWith('|');
}

function isTableSeparator(line: string): boolean {
  return /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(line.trim());
}

function parseTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

function isBlockStart(line: string): boolean {
  return (
    /^#{2,4}\s+/.test(line) ||
    /^-\s+/.test(line) ||
    /^\d+\.\s+/.test(line) ||
    /^>\s+/.test(line) ||
    isTableRow(line)
  );
}

function BlogContent({ content }: { content: string }) {
  const lines = sanitizeMarkdown(content).split(/\r?\n/);
  const blocks: ReactNode[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index]?.trim() ?? '';

    if (!line) {
      index += 1;
      continue;
    }

    const heading = line.match(/^(#{2,4})\s+(.+)$/);
    if (heading) {
      const text = heading[2];
      const level = heading[1].length;
      const className =
        level === 2
          ? 'mt-12 text-2xl font-semibold tracking-normal text-fd-foreground'
          : 'mt-8 text-xl font-semibold tracking-normal text-fd-foreground';

      blocks.push(
        level === 2 ? (
          <h2 key={blocks.length} className={className}>
            {text}
          </h2>
        ) : (
          <h3 key={blocks.length} className={className}>
            {text}
          </h3>
        ),
      );
      index += 1;
      continue;
    }

    if (isTableRow(line) && isTableSeparator(lines[index + 1] ?? '')) {
      const headers = parseTableRow(line);
      const rows: string[][] = [];
      index += 2;

      while (index < lines.length && isTableRow(lines[index] ?? '')) {
        rows.push(parseTableRow(lines[index]));
        index += 1;
      }

      blocks.push(
        <div key={blocks.length} className="my-8 overflow-x-auto rounded-2xl border bg-fd-card">
          <table className="w-full min-w-[640px] border-collapse text-left text-sm">
            <thead className="bg-fd-muted/60 text-fd-muted-foreground">
              <tr>
                {headers.map((header) => (
                  <th key={header} className="border-b px-4 py-3 font-semibold">
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr key={rowIndex} className="border-b last:border-b-0">
                  {row.map((cell, cellIndex) => (
                    <td key={`${rowIndex}-${cellIndex}`} className="px-4 py-3 align-top">
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    if (/^-\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^-\s+/.test(lines[index]?.trim() ?? '')) {
        items.push((lines[index] ?? '').trim().replace(/^-\s+/, ''));
        index += 1;
      }

      blocks.push(
        <ul key={blocks.length} className="my-6 list-disc space-y-2 pl-6 leading-8 text-fd-foreground">
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>,
      );
      continue;
    }

    if (/^\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^\d+\.\s+/.test(lines[index]?.trim() ?? '')) {
        items.push((lines[index] ?? '').trim().replace(/^\d+\.\s+/, ''));
        index += 1;
      }

      blocks.push(
        <ol
          key={blocks.length}
          className="my-6 list-decimal space-y-2 pl-6 leading-8 text-fd-foreground"
        >
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ol>,
      );
      continue;
    }

    if (/^>\s+/.test(line)) {
      const quote: string[] = [];
      while (index < lines.length && /^>\s+/.test(lines[index]?.trim() ?? '')) {
        quote.push((lines[index] ?? '').trim().replace(/^>\s+/, ''));
        index += 1;
      }

      blocks.push(
        <blockquote
          key={blocks.length}
          className="my-8 border-l-4 border-brand bg-fd-muted/40 px-5 py-4 text-lg leading-8 text-fd-foreground"
        >
          {quote.join(' ')}
        </blockquote>,
      );
      continue;
    }

    const paragraph: string[] = [];
    while (index < lines.length) {
      const current = lines[index]?.trim() ?? '';
      if (!current) break;
      if (paragraph.length > 0 && isBlockStart(current)) break;
      paragraph.push(current);
      index += 1;
    }

    blocks.push(
      <p key={blocks.length} className="my-6 text-lg leading-9 text-fd-foreground">
        {paragraph.join(' ')}
      </p>,
    );
  }

  return <div className="min-w-0 flex-1">{blocks}</div>;
}

export default async function Page(props: { params: Promise<{ slug: string }> }) {
  const params = await props.params;
  const page = await getBlogPost(params.slug);

  if (!page) notFound();

  const description = page.data.description ?? 'Wallet notes from Louma';
  const author = page.data.author ?? siteConfig.name;
  const structuredData = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Article',
        '@id': `${siteConfig.url}${page.url}#article`,
        headline: page.data.title,
        description,
        url: `${siteConfig.url}${page.url}`,
        mainEntityOfPage: `${siteConfig.url}${page.url}`,
        ...(page.data.date && { datePublished: page.data.date, dateModified: page.data.date }),
        author: { '@type': 'Organization', name: author },
        publisher: {
          '@type': 'Organization',
          '@id': `${siteConfig.url}/#organization`,
          name: siteConfig.name,
          url: siteConfig.url,
        },
        image: `${siteConfig.url}${siteConfig.socialImage}`,
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Home', item: siteConfig.url },
          { '@type': 'ListItem', position: 2, name: 'Blog', item: `${siteConfig.url}/blog` },
          {
            '@type': 'ListItem',
            position: 3,
            name: page.data.title,
            item: `${siteConfig.url}${page.url}`,
          },
        ],
      },
    ],
  };

  return (
    <article className="flex flex-col mx-auto w-full max-w-[860px] px-4 py-8 md:py-12">
      <StructuredData value={structuredData} />
      <Link
        href="/blog"
        className={cn(
          buttonVariants({
            size: 'sm',
            variant: 'secondary',
          }),
          'mb-10 w-fit gap-2 rounded-full',
        )}
      >
        <ArrowLeft className="size-4" />
        Back to Blog
      </Link>

      <h1 className="text-3xl font-semibold mb-4">{page.data.title}</h1>
      <p className="text-fd-muted-foreground">{description}</p>
      <p className="mt-3 mb-8 text-sm text-fd-muted-foreground">
        By {author}
        {page.data.date && (
          <>
            {' · '}
            <time dateTime={page.data.date}>
              {new Date(page.data.date).toLocaleDateString('en', {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
              })}
            </time>
          </>
        )}
      </p>

      <div className="min-w-0 flex-1">
        <div className="flex flex-row gap-2 mb-8 not-prose">
          <ShareButton url={page.url} />
        </div>

        <BlogContent content={page.data.content} />
      </div>
    </article>
  );
}

export async function generateMetadata(props: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const params = await props.params;
  const page = await getBlogPost(params.slug);

  if (!page) notFound();

  return createMetadata({
    title: page.data.title,
    description: page.data.description ?? 'Wallet notes from Louma',
    path: page.url,
    type: 'article',
    publishedTime: page.data.date,
    authors: [page.data.author ?? siteConfig.name],
  });
}

export async function generateStaticParams(): Promise<{ slug: string }[]> {
  return (await getBlogPosts()).map((page) => ({
    slug: page.slug,
  }));
}
