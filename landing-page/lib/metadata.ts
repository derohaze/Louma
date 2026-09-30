import type { Metadata } from 'next';
import { siteConfig } from '@/lib/site';

type PageMetadata = {
  title: string;
  description: string;
  path: string;
  type?: 'article' | 'website';
  publishedTime?: string;
  authors?: string[];
};

export function createMetadata(page: PageMetadata): Metadata {
  const openGraph: Metadata['openGraph'] = {
    type: page.type ?? 'website',
    title: page.title,
    description: page.description,
    url: page.path,
    siteName: siteConfig.name,
    images: [{ url: siteConfig.socialImage, width: 1200, height: 630, alt: siteConfig.name }],
    ...(page.type === 'article' && {
      publishedTime: page.publishedTime,
      authors: page.authors,
    }),
  };

  return {
    title: page.title,
    description: page.description,
    alternates: { canonical: page.path },
    openGraph,
    twitter: {
      card: 'summary_large_image',
      title: page.title,
      description: page.description,
      images: [siteConfig.socialImage],
    },
  };
}
