import { DEFAULT_LANGUAGE, getCurrentLanguage, type LanguageCode } from './config';
import { dictionaries, type Dictionary } from './locales';
import type {
  AtPath,
  TranslationKey,
  TranslationNamespace,
  TranslationParams,
} from './types';

/** Fills `{name}` placeholders; an unknown placeholder is left as written rather than blanked. */
function fillParams(text: string, params?: TranslationParams): string {
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}

function lookupNode(dictionary: Dictionary, key: string): unknown {
  let node: unknown = dictionary;
  for (const part of key.split('.')) {
    if (typeof node !== 'object' || node === null) return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return node;
}

function lookup(dictionary: Dictionary, key: string): string | undefined {
  const node = lookupNode(dictionary, key);
  return typeof node === 'string' ? node : undefined;
}

/**
 * One string, in one language, by its dot path (`"home.hero.title"`).
 *
 * A key an incomplete translation has not filled in yet falls back to English rather than showing a
 * raw path, so a half-translated language still reads as a site.
 */
export function translateIn(
  language: LanguageCode,
  key: string,
  params?: TranslationParams,
): string {
  const text = lookup(dictionaries[language], key) ?? lookup(dictionaries[DEFAULT_LANGUAGE], key);
  if (text === undefined) {
    if (process.env.NODE_ENV === 'development') {
      console.warn(`[i18n] missing translation: ${key} (${language})`);
    }
    return key;
  }
  return fillParams(text, params);
}

/**
 * The same lookup for code that runs outside React: formatting helpers and the metadata the router
 * builds before any component renders.
 */
export function translate(key: string, params?: TranslationParams): string {
  return translateIn(getCurrentLanguage(), key, params);
}

/**
 * A list of strings in one language, for the few places that need an array rather than a sentence —
 * the metadata keywords, which search engines read as a list.
 */
export function listIn(language: LanguageCode, key: string): string[] {
  const node = lookupNode(dictionaries[language], key) ?? lookupNode(dictionaries[DEFAULT_LANGUAGE], key);
  return Array.isArray(node) ? node.map(String) : [];
}

/**
 * One whole section, in one language.
 *
 * `createT` answers a single string; a page that renders a *list* — the pricing plans, the changelog
 * entries, the legal sections — needs the objects themselves, because the wording is attached to
 * data that lives outside the dictionary (a price, a version number, a block of legal text). The
 * section is the smallest unit the renderer can map over, and it falls back to English per key the
 * same way `translateIn` does.
 */
export function sectionIn<Namespace extends TranslationNamespace<Dictionary>>(
  language: LanguageCode,
  namespace: Namespace,
): AtPath<Dictionary, Namespace> {
  const node =
    lookupNode(dictionaries[language], namespace) ?? lookupNode(dictionaries[DEFAULT_LANGUAGE], namespace);

  if (node === undefined) {
    if (process.env.NODE_ENV === 'development') {
      console.warn(`[i18n] missing section: ${namespace} (${language})`);
    }
    return lookupNode(dictionaries[DEFAULT_LANGUAGE], namespace) as AtPath<Dictionary, Namespace>;
  }

  return node as AtPath<Dictionary, Namespace>;
}

/**
 * A namespace bound to one language, for the server components that render the document.
 *
 * Client components call `useT` instead — the same lookup, re-rendering on a language switch — but a
 * server component has no context to read and no second chance to render, so the language is passed
 * in explicitly: `const t = createT(await getRequestLanguage(), 'pricing')`.
 */
export function createT<Namespace extends TranslationNamespace<Dictionary>>(
  language: LanguageCode,
  namespace: Namespace,
): (key: TranslationKey<AtPath<Dictionary, Namespace>>, params?: TranslationParams) => string {
  return (key, params) => translateIn(language, `${namespace}.${key}`, params);
}