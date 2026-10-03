'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  DEFAULT_LANGUAGE,
  LANGUAGES,
  parseLanguage,
  persistLanguage,
  readLanguageCookie,
  setCurrentLanguage,
  type LanguageCode,
} from './config';
import { translateIn, sectionIn } from './translate';
import type { Dictionary } from './locales';
import type {
  AtPath,
  TranslationKey,
  TranslationNamespace,
  TranslationParams,
} from './types';

interface I18nValue {
  language: LanguageCode;
  setLanguage: (code: LanguageCode) => void;
}

const I18nContext = createContext<I18nValue>({
  language: DEFAULT_LANGUAGE,
  setLanguage: () => undefined,
});

/**
 * Owns the language of the whole site.
 *
 * `initialLanguage` is the value the document was rendered with: the server layout reads it from the
 * request and passes the same value here, so the first client render reproduces the server's markup
 * instead of reading the cookie again and swapping languages after paint. The choice is mirrored
 * into a module-level value as well (`setCurrentLanguage`), because formatting helpers and the
 * document metadata are not components and cannot read a hook.
 */
export function I18nProvider({
  initialLanguage,
  children,
}: {
  initialLanguage: LanguageCode;
  children: ReactNode;
}) {
  const [language, setLanguageState] = useState<LanguageCode>(initialLanguage);
  setCurrentLanguage(language);

  /**
   * The cookie is the authority on a first client render too — a tab that has never rendered a
   * document of its own (a client-side navigation into the site) starts from what the browser holds.
   */
  useEffect(() => {
    const persisted = readLanguageCookie();
    if (persisted !== language) {
      setCurrentLanguage(persisted);
      setLanguageState(persisted);
    }
    // Once, on mount only: after that the language follows the visitor's choice, not the cookie.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setLanguage = useCallback((code: LanguageCode) => {
    if (!LANGUAGES.some((item) => item.code === code)) return;
    setCurrentLanguage(code);
    persistLanguage(code);
    setLanguageState(code);
  }, []);

  const value = useMemo<I18nValue>(() => ({ language, setLanguage }), [language, setLanguage]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/** The current language and the way to switch it. */
export function useI18n(): I18nValue {
  return useContext(I18nContext);
}

/**
 * The strings of one section or page, ready to render: `const t = useT('home')` then
 * `t('hero.title')`. Scoping to a namespace keeps the keys short and the typos out — only paths
 * that exist in that section compile — and the returned function re-renders the caller when the
 * language changes.
 */
export function useT<Namespace extends TranslationNamespace<Dictionary>>(
  namespace: Namespace,
): (key: TranslationKey<AtPath<Dictionary, Namespace>>, params?: TranslationParams) => string {
  const { language } = useI18n();
  return useCallback(
    (key: TranslationKey<AtPath<Dictionary, Namespace>>, params?: TranslationParams) =>
      translateIn(language, `${namespace}.${key}`, params),
    [language, namespace],
  );
}

/**
 * The same section, for the client: `const pricing = useSection('pricing')` then map over
 * `pricing.plans.basic.features`. See `sectionIn` for when a page needs this instead of `useT`.
 */
export function useSection<Namespace extends TranslationNamespace<Dictionary>>(
  namespace: Namespace,
): AtPath<Dictionary, Namespace> {
  const { language } = useI18n();
  return useMemo(() => sectionIn(language, namespace), [language, namespace]);
}