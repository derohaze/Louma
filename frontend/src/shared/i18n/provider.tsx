import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "@tanstack/react-router";
import { useIsomorphicLayoutEffect } from "@/shared/hooks";
import {
  DEFAULT_LANGUAGE,
  LANGUAGES,
  parseLanguage,
  persistLanguage,
  readLanguageCookie,
  setCurrentLanguage,
  type LanguageCode,
} from "./config";
import { translateIn } from "./translate";
import type { Dictionary } from "./locales";
import type { TranslationPath } from ".";
import type { AtPath, TranslationKey, TranslationNamespace, TranslationParams } from "./types";

interface I18nValue {
  language: LanguageCode;
  setLanguage: (code: LanguageCode) => void;
}

const I18nContext = createContext<I18nValue>({
  language: DEFAULT_LANGUAGE,
  setLanguage: () => undefined,
});

/**
 * Owns the language of the whole app.
 *
 * `initialLanguage` is the value the document was rendered with: the root shell reads it from the
 * request on the server and passes the same dehydrated value on the client, so the first client
 * render reproduces the server's markup instead of reading the cookie again and swapping languages
 * after paint. The choice is mirrored into a module-level value as well (`setCurrentLanguage`),
 * because formatting helpers and page titles are not components and cannot read a hook — that
 * mirror is written during render, so those strings always agree with the text around them.
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
   * document of its own (a client-side navigation into the app) starts from what the browser holds.
   * A layout effect runs before paint, so no frame is drawn in the wrong language.
   */
  useIsomorphicLayoutEffect(() => {
    const persisted = readLanguageCookie();
    if (persisted === language) return;
    setCurrentLanguage(persisted);
    setLanguageState(persisted);
  }, []);

  const router = useRouter();

  const setLanguage = useCallback(
    (code: LanguageCode) => {
      if (!LANGUAGES.some((item) => item.code === code)) return;
      setCurrentLanguage(code);
      persistLanguage(code);
      setLanguageState(code);
      // Route `head()` functions only re-run when the matches reload: without this the page
      // below switches language while the browser tab keeps the previous title and meta tags.
      // Invalidation re-reads the just-persisted cookie in `beforeLoad`, so heads rebuild in the
      // new language without a full document reload.
      void router.invalidate();
    },
    [router],
  );

  const value = useMemo<I18nValue>(() => ({ language, setLanguage }), [language, setLanguage]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/** The current language and the way to switch it. */
export function useI18n(): I18nValue {
  return useContext(I18nContext);
}

/**
 * The strings of one section or page, ready to render: `const t = useT("wallet")` then
 * `t("balance.available")`. Scoping to a namespace is what keeps the keys short and the typos out —
 * only paths that exist in that section compile, and the returned function re-renders the caller
 * when the language changes.
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
 * The same lookup for components that hold a full path rather than a key of their own: the
 * navigation, security, and settings catalogs store `"security.catalog.pages.devices.title"`, so
 * the page that renders them calls `t(page.titleKey)` and re-renders on a switch like every other
 * translated view.
 */
export function useTranslate(): (key: TranslationPath, params?: TranslationParams) => string {
  const { language } = useI18n();
  return useCallback(
    (key: TranslationPath, params?: TranslationParams) => translateIn(language, key, params),
    [language],
  );
}
