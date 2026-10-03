/**
 * The languages the dashboard can be read in.
 *
 * Adding a language is two steps, in this order:
 * 1. add `xx.ts` to every folder under `./locales` (same keys as the `en.ts` beside it — the
 *    compiler enforces it, because each file is typed against its English sibling), and
 * 2. add one entry to `LANGUAGES` below.
 * The registry in `./locales/index.ts` picks the new code up from those two places; nothing else in
 * the app knows how many languages exist.
 *
 * A language changes the words of the dashboard and nothing else: the layout keeps the direction it
 * was designed in (`<html dir="ltr">`, see `__root.tsx`), so switching to Arabic never mirrors the
 * rail, the grids, or the charts. The one typographic concession is the Arabic font family below,
 * because the Latin faces carry no Arabic glyphs.
 */
export const LANGUAGES = [
  { code: "en", label: "English" },
  { code: "ar", label: "العربية" },
] as const;

export type LanguageCode = (typeof LANGUAGES)[number]["code"];

export const DEFAULT_LANGUAGE: LanguageCode = "en";

/**
 * The choice lives in a readable cookie rather than only in localStorage, for the same reason the
 * theme does: the server renders the first document, and `<html lang dir>` plus every translated
 * string in that document can only match the visitor's choice if the request carries it. The cookie
 * holds no secret — the worst a forged value does is show its sender a different language.
 */
export const LANGUAGE_COOKIE = "louma_lang";
const COOKIE_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;
const COOKIE_PATTERN = new RegExp(`(?:^|;\\s*)${LANGUAGE_COOKIE}=([^;]*)`);

export function isLanguageCode(value: string | null | undefined): value is LanguageCode {
  return LANGUAGES.some((language) => language.code === value);
}

/** Anything that is not a language this build ships falls back to the default one. */
export function parseLanguage(value: string | null | undefined): LanguageCode {
  return isLanguageCode(value) ? value : DEFAULT_LANGUAGE;
}

export function languageLabel(code: LanguageCode): string {
  return LANGUAGES.find((language) => language.code === code)?.label ?? code;
}

/**
 * How dates are written in each language: the same words the reader chose, and Latin digits — money
 * is printed with Latin digits everywhere else, so a date that switched to ٠١٢٣ would read as a
 * different number system on the same screen.
 */
const LOCALES: Record<LanguageCode, string> = {
  en: "en-GB",
  ar: "ar-u-nu-latn",
};

export function languageLocale(code: LanguageCode): string {
  return LOCALES[code] ?? code;
}

/** The locale of the language being rendered — for the code that formats outside React. */
export function currentLocale(): string {
  return languageLocale(currentLanguage);
}

/** The choice this browser holds, as the server rendered it. */
export function readLanguageCookie(): LanguageCode {
  if (typeof document === "undefined") return DEFAULT_LANGUAGE;
  return parseLanguage(COOKIE_PATTERN.exec(document.cookie)?.[1] ?? null);
}

/** Writes the choice where the next server render of this browser will find it. */
export function persistLanguage(code: LanguageCode): void {
  if (typeof document === "undefined") return;
  const secure = window.location.protocol === "https:" ? "; secure" : "";
  document.cookie = `${LANGUAGE_COOKIE}=${code}; path=/; max-age=${COOKIE_MAX_AGE_SECONDS}; samesite=lax${secure}`;
}

/**
 * The language the screen is being rendered in, readable outside React.
 *
 * The provider owns the choice; this mirror exists for the code that cannot call a hook — date and
 * country formatting, security copy derived in `shared/lib`, and the page titles the router renders.
 * It is written during the provider's render, so a string formatted anywhere inside that render
 * agrees with the strings around it, on the server as well as in the browser.
 */
let currentLanguage: LanguageCode = DEFAULT_LANGUAGE;

// In the browser the cookie is readable the moment this module is first evaluated, and the router
// asks every route for its `head` before the provider has rendered — so the mirror has to start at
// the visitor's choice or the browser tab would be named in the default language for the whole of
// the first paint. On the server there is no document, and `beforeLoad` writes the value per request.
if (typeof document !== "undefined") currentLanguage = readLanguageCookie();

export function getCurrentLanguage(): LanguageCode {
  return currentLanguage;
}

export function setCurrentLanguage(code: LanguageCode): void {
  currentLanguage = code;
}
