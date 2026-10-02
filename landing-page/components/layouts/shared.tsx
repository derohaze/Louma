import type { BaseLayoutProps, LinkItemType } from 'fumadocs-ui/layouts/shared';

export const linkItems: LinkItemType[] = [
  {
    text: 'Features',
    url: '/features',
    active: 'nested-url',
  },
  {
    text: 'Blog',
    url: '/blog',
    active: 'nested-url',
  },
  {
    text: 'Pricing',
    url: '/pricing',
  },
];

// Brand mark removed temporarily — nav shows the wordmark only.
export const logo = null;

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: (
        <>
          {logo}
          <span className="font-medium in-[.uwu]:hidden">Louma</span>
        </>
      ),
    },
  };
}
