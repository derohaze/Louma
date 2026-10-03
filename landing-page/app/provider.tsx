'use client';

import { RootProvider } from 'fumadocs-ui/provider/base';
import { ThemeProvider } from 'next-themes';
import type { ReactNode } from 'react';
import { TooltipProvider } from '@radix-ui/react-tooltip';
import { I18nProvider, type LanguageCode } from '@/lib/i18n';

export function Provider({
  initialLanguage,
  children,
}: {
  initialLanguage: LanguageCode;
  children: ReactNode;
}) {
  return (
    <RootProvider>
      <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
        <I18nProvider initialLanguage={initialLanguage}>
          <TooltipProvider>{children}</TooltipProvider>
        </I18nProvider>
      </ThemeProvider>
    </RootProvider>
  );
}