import './global.css';
import type { Metadata, Viewport } from 'next';
import Script from 'next/script';
import { NextProvider } from 'fumadocs-core/framework/next';
import type { ReactNode } from 'react';
import { Body } from './layout.client';
import { Provider } from './provider';
import { createT, getRequestLanguage, listIn } from '@/lib/i18n';
import { siteConfig } from '@/lib/site';

/**
 * The site's own metadata, in the language the request was sent in.
 *
 * It has to be generated rather than exported as a constant: the wording is translated, and only the
 * request knows which language the visitor reads. `getRequestLanguage` reads the same cookie the
 * document is rendered with, so the title a search engine caches matches the page it links to.
 */
export async function generateMetadata(): Promise<Metadata> {
  const t = createT(await getRequestLanguage(), 'site');

  return {
    metadataBase: new URL(siteConfig.url),
    applicationName: siteConfig.name,
    title: {
      default: t('title'),
      template: `%s | ${siteConfig.name}`,
    },
    description: t('description'),
    keywords: listIn(await getRequestLanguage(), 'site.keywords'),
    authors: [{ name: siteConfig.name }],
    creator: siteConfig.name,
    publisher: siteConfig.name,
    category: t('category'),
    openGraph: {
      type: 'website',
      locale: t('locale'),
      url: '/',
      siteName: siteConfig.name,
      title: t('title'),
      description: t('description'),
      images: [
        {
          url: siteConfig.socialImage,
          width: siteConfig.socialImageWidth,
          height: siteConfig.socialImageHeight,
          alt: t('socialImageAlt'),
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title: t('title'),
      description: t('description'),
      images: [siteConfig.socialImage],
    },
    robots: {
      index: true,
      follow: true,
      googleBot: {
        index: true,
        follow: true,
        'max-image-preview': 'large',
        'max-snippet': -1,
        'max-video-preview': -1,
      },
    },
    ...(process.env.GOOGLE_SITE_VERIFICATION
      ? { verification: { google: process.env.GOOGLE_SITE_VERIFICATION } }
      : {}),
  };
}

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#1E1E1E' },
    { media: '(prefers-color-scheme: light)', color: '#fff' },
  ],
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const language = await getRequestLanguage();

  return (
    /*
     * `lang` follows the visitor's choice — it is what selects the Arabic font family and tells
     * assistive technology how to read the page. The direction deliberately does not: the site keeps
     * the layout it was designed in, so a translated page never mirrors its own columns.
     */
    <html lang={language} dir="ltr" suppressHydrationWarning>
      <head>
        <Script
          id="bis-skin-cleanup"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{
            __html: `(function(){var s="[bis_skin_checked]";function clean(){try{document.querySelectorAll(s).forEach(function(e){e.removeAttribute("bis_skin_checked")})}catch(_){}}clean();new MutationObserver(clean).observe(document.documentElement,{attributes:true,subtree:true,attributeFilter:["bis_skin_checked"]})})()`,
          }}
        />
      </head>
      <Body>
        <NextProvider>
          <Provider initialLanguage={language}>{children}</Provider>
        </NextProvider>
      </Body>
    </html>
  );
}
