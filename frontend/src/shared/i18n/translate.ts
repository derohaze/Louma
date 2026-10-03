import { DEFAULT_LANGUAGE, getCurrentLanguage, type LanguageCode } from "./config";
import { dictionaries, type Dictionary } from "./locales";
import type { TranslationParams } from "./types";

/** Fills `{name}` placeholders; an unknown placeholder is left as written rather than blanked. */
function fillParams(text: string, params?: TranslationParams): string {
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}

function lookup(dictionary: Dictionary, key: string): string | undefined {
  let node: unknown = dictionary;
  for (const part of key.split(".")) {
    if (typeof node !== "object" || node === null) return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === "string" ? node : undefined;
}

/**
 * One string, in one language, by its dot path (`"security.center.title"`).
 *
 * A key an incomplete translation has not filled in yet falls back to English rather than showing a
 * raw path, so a half-translated language still reads as a wallet.
 */
export function translateIn(
  language: LanguageCode,
  key: string,
  params?: TranslationParams,
): string {
  const text = lookup(dictionaries[language], key) ?? lookup(dictionaries[DEFAULT_LANGUAGE], key);
  if (text === undefined) {
    if (import.meta.env.DEV) console.warn(`[i18n] missing translation: ${key} (${language})`);
    return key;
  }
  return fillParams(text, params);
}

/**
 * The same lookup for code that runs outside React: formatting helpers, derived security copy, and
 * the router's page titles. Components use `useT` (see provider.tsx), which re-renders on a switch.
 */
export function translate(key: string, params?: TranslationParams): string {
  return translateIn(getCurrentLanguage(), key, params);
}
