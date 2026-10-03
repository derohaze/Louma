import { HomeLayout } from 'fumadocs-ui/layouts/home';
import { baseOptions, translatedLinkItems } from '@/components/layouts/shared';
import { ResizableHomeHeader } from '@/components/layouts/resizable-home-header';
import { LandingFooter } from '@/components/layouts/footer';
import { createT, getRequestLanguage } from '@/lib/i18n';
import type { ReactNode } from 'react';

export default async function Layout({ children }: { children: ReactNode }) {
  const t = createT(await getRequestLanguage(), 'common');

  return (
    <HomeLayout
      {...baseOptions()}
      links={translatedLinkItems(t)}
      slots={{
        header: ResizableHomeHeader,
      }}
      className="dark:bg-neutral-950 dark:[--color-fd-background:var(--color-neutral-950)] [--color-fd-primary:var(--color-brand)]"
    >
      {children}
      <LandingFooter />
    </HomeLayout>
  );
}