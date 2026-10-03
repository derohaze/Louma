/**
 * The languages the landing site can be read in.
 *
 * Adding a language is two steps, in this order:
 * 1. add `xx.ts` to every folder under `./locales` (same keys as the `en.ts` beside it — the
 *    compiler enforces it, because each file is typed against its English sibling), and
 * 2. add one entry to `LANGUAGES` below.
 * The registry in `./locales/index.ts` picks the new code up from those two places; nothing else in
 * the site knows how many languages exist.
 *
 * The cookie is deliberately the one the dashboard already uses (`louma_lang`): a visitor who picks
 * Arabic on the app and opens the marketing site reads it in Arabic too, and the other way round.
 *
 * A language changes the words of the site and nothing else: the layout keeps the direction it was
 * designed in (`<html dir="ltr">`, see `app/layout.tsx`), so switching to Arabic never mirrors the
 * hero, the grids, or the demo dashboard. The one typographic concession is the Arabic font family,
 * because the Latin faces carry no Arabic glyphs.
 */
export const LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'ar', label: 'العربية' },
] as const;

export type LanguageCode = (typeof LANGUAGES)[number]['code'];

export const DEFAULT_LANGUAGE: LanguageCode = 'en';

/**
 * The choice lives in a readable cookie rather than only in localStorage, because the server renders
 * every document: `<html lang>` plus every translated string in that document can only match the
 * visitor's choice if the request carries it. The cookie holds no secret.
 */
export const LANGUAGE_COOKIE = 'louma_lang';
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
 * How dates are written in each language: the same words the reader chose, and Latin digits — the
 * wallet prints money with Latin digits everywhere else, so a date that switched to ٠١٢٣ would read
 * as a different number system on the same page.
 */
const LOCALES: Record<LanguageCode, string> = {
  en: 'en-GB',
  ar: 'ar-u-nu-latn',
};

export function languageLocale(code: LanguageCode): string {
  return LOCALES[code] ?? code;
}

/** The locale of the language being rendered — for the code that formats outside React. */
export function currentLocale(): string {
  return languageLocale(currentLanguage);
}

/** The choice this browser holds. */
export function readLanguageCookie(): LanguageCode {
  if (typeof document === 'undefined') return DEFAULT_LANGUAGE;
  return parseLanguage(COOKIE_PATTERN.exec(document.cookie)?.[1] ?? null);
}

/** Writes the choice where the next server render of this browser will find it. */
export function persistLanguage(code: LanguageCode): void {
  if (typeof document === 'undefined') return;
  const secure = window.location.protocol === 'https:' ? '; secure' : '';
  // Shared with the wallet app: a host-only cookie set on one hostname is never sent to the
  // other, so the choice follows the visitor between `loumapay.com` and `app.loumapay.com` via the
  // parent domain. Localhost and preview hosts keep a host-only cookie — a Domain attribute for a
  // suffix that is not theirs would be rejected and the choice lost entirely.
  const host = window.location.hostname;
  const domain =
    host === 'loumapay.com' || host.endsWith('.loumapay.com') ? '; domain=.loumapay.com' : '';
  document.cookie = `${LANGUAGE_COOKIE}=${code}; path=/; max-age=${COOKIE_MAX_AGE_SECONDS}; samesite=lax${secure}${domain}`;
}

/**
 * The language the request was sent in, for the server components that render the document.
 *
 * Next.js makes the request headers readable only from the server, which is exactly where this is
 * needed: a server component asks for this and passes the value down, so the first paint is in the
 * visitor's language without the client having to correct it after hydration.
 */
export async function getRequestLanguage(): Promise<LanguageCode> {
  const { cookies } = await import('next/headers');
  return parseLanguage((await cookies()).get(LANGUAGE_COOKIE)?.value ?? null);
}

/**
 * The language the screen is being rendered in, readable outside React.
 *
 * The provider owns the choice; this mirror exists for the code that cannot call a hook — the
 * `<title>` of a document that is built before React runs, and the formatting helpers. It is
 * written while the provider renders, so any string formatted inside that render agrees with the
 * strings around it.
 */
let currentLanguage: LanguageCode = DEFAULT_LANGUAGE;

// In the browser the cookie is readable the moment this module is first evaluated, before any
// component renders, so the mirror starts at the visitor's choice rather than the default.
if (typeof document !== 'undefined') currentLanguage = readLanguageCookie();

export function getCurrentLanguage(): LanguageCode {
  return currentLanguage;
}

export function setCurrentLanguage(code: LanguageCode): void {
  currentLanguage = code;
}