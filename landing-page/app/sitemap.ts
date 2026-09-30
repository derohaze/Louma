import type { MetadataRoute } from 'next';
import { getBlogPosts } from '@/lib/blog';
import { siteConfig } from '@/lib/site';

const staticLastModified = new Date('2026-07-05');

const staticRoutes: { path: string; changeFrequency: 'weekly' | 'monthly'; priority: number }[] = [
  { path: '',          changeFrequency: 'weekly',  priority: 1.0 },
  { path: '/features', changeFrequency: 'weekly',  priority: 0.9 },
  { path: '/about',    changeFrequency: 'monthly', priority: 0.8 },
  { path: '/pricing',  changeFrequency: 'weekly',  priority: 0.8 },
  { path: '/blog',     changeFrequency: 'weekly',  priority: 0.7 },
  { path: '/sponsors', changeFrequency: 'monthly', priority: 0.6 },
  { path: '/changelog',changeFrequency: 'monthly', priority: 0.5 },
  { path: '/privacy',  changeFrequency: 'monthly', priority: 0.3 },
  { path: '/terms',    changeFrequency: 'monthly', priority: 0.3 },
];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const posts = await getBlogPosts();

  return [
    ...staticRoutes.map((route) => ({
      url: `${siteConfig.url}${route.path}`,
      lastModified: staticLastModified,
      changeFrequency: route.changeFrequency,
      priority: route.priority,
    })),
    ...posts.map((post) => ({
      url: `${siteConfig.url}${post.url}`,
      lastModified: post.data.date ? new Date(post.data.date) : undefined,
      changeFrequency: 'monthly' as const,
      priority: 0.6,
    })),
  ];
}
