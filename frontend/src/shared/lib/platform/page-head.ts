/**
 * Shared `head()` payload for the Security and Settings routes, which are many small pages that
 * share one shape. The title and description come from the same catalogs the sidebar reads, so a
 * page can never show a different name in the browser tab than it does in the navigation.
 */
export const pageHead = (title: string, description: string) => ({
  meta: [
    { title },
    { name: "description", content: description },
    { property: "og:title", content: title },
    { property: "og:description", content: description },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary_large_image" },
  ],
});
