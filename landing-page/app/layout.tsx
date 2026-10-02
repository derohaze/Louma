import './global.css';
import type { Metadata, Viewport } from 'next';
import Script from 'next/script';
import { NextProvider } from 'fumadocs-core/framework/next';
import type { ReactNode } from 'react';
import { Body } from './layout.client';
import { Provider } from './provider';
import { siteConfig } from '@/lib/site';

export const metadata: Metadata = {
  metadataBase: new URL(siteConfig.url),
  applicationName: siteConfig.name,
  title: {
    default: siteConfig.title,
    template: `%s | ${siteConfig.name}`,
  },
  description: siteConfig.description,
  keywords: [...siteConfig.keywords],
  authors: [{ name: siteConfig.name }],
  creator: siteConfig.name,
  publisher: siteConfig.name,
  category: 'digital wallet software',
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: '/',
    siteName: siteConfig.name,
    title: siteConfig.title,
    description: siteConfig.description,
    images: [
      {
        url: siteConfig.socialImage,
        width: 1200,
        height: 630,
        alt: 'Louma digital wallet dashboard',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: siteConfig.title,
    description: siteConfig.description,
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
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#1E1E1E' },
    { media: '(prefers-color-scheme: light)', color: '#fff' },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
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
          <Provider>{children}</Provider>
        </NextProvider>
      </Body>
    </html>
  );
}
