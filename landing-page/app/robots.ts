import type { MetadataRoute } from 'next';
import { siteConfig } from '@/lib/site';

// Search and AI crawlers are explicitly allowed so the AEO/GEO intent is
// stated rather than left to the wildcard rule. Google-Extended and
// Applebot-Extended govern training/citation use; the rest govern search and
// answer engines (ChatGPT, Claude, Perplexity).
const aiCrawlers = [
  'Googlebot',
  'Google-Extended',
  'Bingbot',
  'GPTBot',
  'OAI-SearchBot',
  'ChatGPT-User',
  'ClaudeBot',
  'Claude-User',
  'Claude-SearchBot',
  'anthropic-ai',
  'PerplexityBot',
  'Applebot',
  'Applebot-Extended',
  'CCBot',
  'Bytespider',
  'meta-externalagent',
  'DuckAssistBot',
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/api/'],
      },
      ...aiCrawlers.map((userAgent) => ({
        userAgent,
        allow: '/',
        disallow: ['/api/'],
      })),
    ],
    sitemap: `${siteConfig.url}/sitemap.xml`,
    host: siteConfig.url,
  };
}
