export {
  DEFAULT_LANGUAGE,
  LANGUAGES,
  LANGUAGE_COOKIE,
  currentLocale,
  getCurrentLanguage,
  languageLocale,
  isLanguageCode,
  languageLabel,
  parseLanguage,
  persistLanguage,
  readLanguageCookie,
  setCurrentLanguage,
  type LanguageCode,
} from "./config";
export { dictionaries, type Dictionary } from "./locales";
export { I18nProvider, useI18n, useT, useTranslate } from "./provider";
export { translate, translateIn } from "./translate";
export type { Strings, TranslationKey, TranslationParams } from "./types";

import type { Dictionary } from "./locales";
import type { TranslationKey } from "./types";

/**
 * A path to any string in the dictionary (`"nav.pages.wallet.label"`). Module-level data — the
 * navigation catalog, the security catalog, the route heads — stores these instead of text, so the
 * same entry renders in whichever language is current when the page paints.
 */
export type TranslationPath = TranslationKey<Dictionary>;
