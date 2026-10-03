import { translate, type TranslationPath } from "@/shared/i18n";

/**
 * Shared `head()` payload for every route: the browser tab and the description search engines read.
 *
 * Both arguments are translation keys rather than text, because a route's head is module-level data
 * — it is evaluated per navigation, and a page can never show a different name in the tab than it
 * does in the navigation. `translate()` reads the language the router resolved from the request
 * cookie before any head was built (see `__root.tsx`).
 */
export const pageHead = (titleKey: TranslationPath, descriptionKey: TranslationPath) => ({
  meta: [
    { title: translate(titleKey) },
    { name: "description", content: translate(descriptionKey) },
    { property: "og:title", content: translate(titleKey) },
    { property: "og:description", content: translate(descriptionKey) },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary_large_image" },
  ],
});
