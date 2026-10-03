export {
  DEFAULT_LANGUAGE,
  LANGUAGES,
  LANGUAGE_COOKIE,
  currentLocale,
  getCurrentLanguage,
  getRequestLanguage,
  isLanguageCode,
  languageLabel,
  languageLocale,
  parseLanguage,
  persistLanguage,
  readLanguageCookie,
  setCurrentLanguage,
  type LanguageCode,
} from './config';
export { dictionaries, type Dictionary, type TranslationPath } from './locales';
export { I18nProvider, useI18n, useSection, useT } from './provider';
export { createT, listIn, sectionIn, translate, translateIn } from './translate';
export type { Strings, TranslationKey, TranslationNamespace, TranslationParams } from './types';