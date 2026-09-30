import { HomeLayout } from 'fumadocs-ui/layouts/home';
import { baseOptions, linkItems } from '@/components/layouts/shared';
import { ResizableHomeHeader } from '@/components/layouts/resizable-home-header';
import { LandingFooter } from '@/components/layouts/footer';
import type { ReactNode } from 'react';

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <HomeLayout
      {...baseOptions()}
      links={[
        {
          type: 'main',
          text: 'Documentation',
          url: '/docs',
        },
        ...linkItems,
      ]}
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
