import { translateIn, type LanguageCode, type TranslationPath } from "@/shared/i18n";

/**
 * Shared `head()` payload for every route: the browser tab and the description search engines read.
 *
 * Both arguments are translation keys rather than text, because a route's head is module-level data
 * — it is evaluated per navigation, and a page can never show a different name in the tab than it
 * does in the navigation. The language arrives per call from the route match's own context (which
 * the root `beforeLoad` resolved from this request's cookie), never from module state: two requests
 * sharing one server process must not be able to name each other's tabs.
 */
export const pageHead = (
  titleKey: TranslationPath,
  descriptionKey: TranslationPath,
  language: LanguageCode,
) => ({
  meta: [
    { title: translateIn(language, titleKey) },
    { name: "description", content: translateIn(language, descriptionKey) },
    { property: "og:title", content: translateIn(language, titleKey) },
    { property: "og:description", content: translateIn(language, descriptionKey) },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary_large_image" },
  ],
});
