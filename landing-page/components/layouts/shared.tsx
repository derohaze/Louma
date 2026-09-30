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

export const logo = (
  <span className="relative block h-5 w-8 shrink-0" aria-hidden="true">
    <img src="/darklogo.svg" alt="" className="block h-full w-full object-contain dark:hidden" />
    <img src="/whitelogo.svg" alt="" className="hidden h-full w-full object-contain dark:block" />
  </span>
);

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
