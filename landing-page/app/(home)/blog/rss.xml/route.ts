import { getBlogPosts } from '@/lib/blog';
import { NextResponse } from 'next/server';

export const revalidate = false;

const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://louma.com';

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

export async function GET() {
  const items = (await getBlogPosts())
    .map(
      (page) => `<item>
        <guid>${escapeXml(`${baseUrl}${page.url}`)}</guid>
        <title>${escapeXml(page.data.title)}</title>
        <description>${escapeXml(page.data.description ?? '')}</description>
        <link>${escapeXml(`${baseUrl}${page.url}`)}</link>
        <pubDate>${new Date(page.data.date ?? page.slug).toUTCString()}</pubDate>
      </item>`,
    )
    .join('');

  return new NextResponse(
    `<?xml version="1.0" encoding="UTF-8" ?>
    <rss version="2.0">
      <channel>
        <title>Louma Blog</title>
        <link>${baseUrl}/blog</link>
        <description>Practical notes on holding, sending, and receiving LMA, with a focus on clarity and reliability.</description>
        ${items}
      </channel>
    </rss>`,
    {
      headers: {
        'content-type': 'application/rss+xml; charset=utf-8',
      },
    },
  );
}
