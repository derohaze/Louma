import type { BaseLayoutProps, LinkItemType } from 'fumadocs-ui/layouts/shared';
import type { TranslationKey } from '@/lib/i18n/types';
import type { createT } from '@/lib/i18n';

/**
 * The link list the home layout hands to Fumadocs, named by translation key: the layout is a server
 * component, so the words are resolved once per request in `translatedLinkItems` rather than by a
 * hook that would only work on the client.
 */
export const linkItems: readonly {
  labelKey: string;
  url: string;
  active?: 'nested-url';
}[] = [
  { labelKey: 'footer.links.features', url: '/features', active: 'nested-url' },
  { labelKey: 'footer.links.blog', url: '/blog', active: 'nested-url' },
  { labelKey: 'footer.links.pricing', url: '/pricing' },
];

export function translatedLinkItems(
  t: ReturnType<typeof createT<'common'>>,
): LinkItemType[] {
  return linkItems.map((item) => ({
    text: t(item.labelKey as TranslationKey<ReturnType<typeof t>>),
    url: item.url,
    active: item.active,
  }));
}

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