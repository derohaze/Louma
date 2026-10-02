import { useCallback, useSyncExternalStore } from "react";
import { useIsomorphicLayoutEffect } from "./use-isomorphic-layout-effect";

export type Theme = "light" | "dark";

/**
 * The choice lives in a readable cookie rather than only in localStorage, because the server has to
 * render the same document the browser will: `<html>`'s `dark` class is part of the HTML the first
 * paint uses, and a server render can only learn the choice from the request. The cookie holds no
 * secret — this module writes it from the browser — and the worst a forged value does is show its
 * sender the other colour scheme.
 */
export const THEME_COOKIE = "louma_theme";
/** The key the choice used before it moved into a cookie; still read once so nothing is thrown away. */
const LEGACY_STORAGE_KEY = "louma-theme";
const COOKIE_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;
const COOKIE_PATTERN = new RegExp(`(?:^|;\\s*)${THEME_COOKIE}=([^;]*)`);

/** Anything that is not exactly `dark` is light: a forged or truncated value can only pick a colour. */
export function parseTheme(value: string | null | undefined): Theme {
  return value === "dark" ? "dark" : "light";
}

/** The choice this browser holds, as the server rendered it. */
export function readThemeCookie(): Theme {
  if (typeof document === "undefined") return "light";
  return parseTheme(COOKIE_PATTERN.exec(document.cookie)?.[1] ?? null);
}

/**
 * Writes the choice where the next server render will find it, and keeps the localStorage copy in
 * step: a cookie raises no cross-tab event, and the copy is what the sibling tabs read.
 */
function persistTheme(theme: Theme): void {
  if (typeof document !== "undefined") {
    const secure = window.location.protocol === "https:" ? "; secure" : "";
    document.cookie = `${THEME_COOKIE}=${theme}; path=/; max-age=${COOKIE_MAX_AGE_SECONDS}; samesite=lax${secure}`;
  }
  try {
    window.localStorage?.setItem(LEGACY_STORAGE_KEY, theme);
  } catch {
    // Storage is a progressive enhancement; the cookie above already carries the choice.
  }
}

/**
 * What this browser last chose, and whether the answer came from before the choice moved into a
 * cookie — in which case the caller writes it back as one, so the server renders it from then on.
 */
function readPersistedTheme(): { theme: Theme; migrated: boolean } {
  if (typeof document === "undefined") return { theme: "light", migrated: false };
  const fromCookie = COOKIE_PATTERN.exec(document.cookie);
  if (fromCookie) return { theme: parseTheme(fromCookie[1]), migrated: false };
  try {
    const stored = window.localStorage.getItem(LEGACY_STORAGE_KEY);
    if (stored === "dark" || stored === "light") return { theme: stored, migrated: true };
  } catch {
    // See persistTheme.
  }
  return { theme: "light", migrated: false };
}

/**
 * The one shared owner of the dashboard colour scheme.
 *
 * The state lives once at module level: every `useTheme()` consumer subscribes to it, so the Settings
 * switch and the account-menu switch can never disagree about the same choice. Nothing here writes
 * the document's attributes directly — the root shell renders them from this store — which is what
 * lets the server's HTML and the first client render be the same markup (see `useTheme`).
 */
let currentTheme: Theme = readPersistedTheme().theme;
const listeners = new Set<() => void>();
let storageHooked = false;

function notify(): void {
  for (const listener of [...listeners]) listener();
}

function setSharedTheme(next: Theme): void {
  if (next !== "light" && next !== "dark") return;
  if (currentTheme === next) return;
  currentTheme = next;
  persistTheme(next);
  notify();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): Theme {
  return currentTheme;
}

function ensureStorageSync(): void {
  if (storageHooked || typeof window === "undefined") return;
  storageHooked = true;
  // Another tab changing the same key converges this tab — and the cookie this writes is what the
  // next server render of either tab reads.
  window.addEventListener("storage", (event) => {
    if (event.key !== LEGACY_STORAGE_KEY) return;
    if (event.newValue === "dark" || event.newValue === "light") setSharedTheme(event.newValue);
  });
}

/**
 * Reads the colour scheme and switches it.
 *
 * `initialTheme` is the value the document was rendered with: the root shell reads it from the
 * request on the server and passes the same dehydrated value on the client, so the first client
 * render reproduces the server's markup exactly instead of re-reading storage and disagreeing with
 * it. The store itself is filled in from this browser's actual choice in a layout effect, before the
 * first paint — the one moment a browser that chose a theme before the choice moved into a cookie can
 * be migrated, at the cost of a flip no one sees because nothing has been painted yet.
 */
export function useTheme(initialTheme: Theme = "light") {
  const theme = useSyncExternalStore(subscribe, getSnapshot, () => initialTheme);
  const isDark = theme === "dark";

  useIsomorphicLayoutEffect(() => {
    ensureStorageSync();
    const persisted = readPersistedTheme();
    // A choice made before the move is written back as a cookie here, so from the next document load
    // the server renders it too.
    if (persisted.migrated) persistTheme(persisted.theme);
    if (persisted.theme === currentTheme) return;
    currentTheme = persisted.theme;
    notify();
  }, []);

  const setTheme = useCallback((next: Theme) => setSharedTheme(next), []);
  const toggle = useCallback(() => {
    setSharedTheme(currentTheme === "dark" ? "light" : "dark");
  }, []);

  return { theme, isDark, setTheme, toggle };
}
