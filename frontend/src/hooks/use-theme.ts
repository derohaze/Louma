import { useCallback, useEffect, useSyncExternalStore } from "react";

export type Theme = "light" | "dark";

const STORAGE_KEY = "louma-theme";

/** Read the stored theme without touching the DOM, so SSR stays safe. */
function readStoredTheme(): Theme {
  if (typeof window === "undefined") return "light";
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "dark" || stored === "light") return stored;
  } catch {
    // Private mode or blocked storage: fall through to the default.
  }
  return "light";
}

function applyTheme(theme: Theme): void {
  if (typeof document !== "undefined") {
    document.documentElement.classList.toggle("dark", theme === "dark");
  }
  try {
    window.localStorage?.setItem(STORAGE_KEY, theme);
  } catch {
    // Storage is a progressive enhancement; the class toggle above already applied.
  }
}

/**
 * The single shared owner of the dashboard color scheme.
 *
 * Previously every `useTheme()` call held its own `useState`, so the Settings switch and the
 * account-menu switch could disagree about the same `document.class` and the same storage key.
 * The state now lives once at module level: every consumer subscribes to it, so toggling from
 * anywhere updates everywhere. Toggling adds/removes the `.dark` class on <html> (see
 * styles.css `@custom-variant dark`), so every `dark:` Tailwind utility flips at once.
 */
let currentTheme: Theme = readStoredTheme();
const listeners = new Set<() => void>();
let storageHooked = false;

function setSharedTheme(next: Theme): void {
  if (next !== "light" && next !== "dark") return;
  if (currentTheme === next) return;
  currentTheme = next;
  applyTheme(next);
  for (const notify of [...listeners]) notify();
}

function subscribe(notify: () => void): () => void {
  listeners.add(notify);
  return () => {
    listeners.delete(notify);
  };
}

function getSnapshot(): Theme {
  return currentTheme;
}

function ensureStorageSync(): void {
  if (storageHooked || typeof window === "undefined") return;
  storageHooked = true;
  // Another tab changing the same key converges this tab instead of forking it.
  window.addEventListener("storage", (event) => {
    if (event.key !== STORAGE_KEY) return;
    if (event.newValue === "dark" || event.newValue === "light") setSharedTheme(event.newValue);
  });
}

export function useTheme() {
  const theme = useSyncExternalStore(subscribe, getSnapshot, () => "light" as Theme);
  const isDark = theme === "dark";

  useEffect(() => {
    ensureStorageSync();
    // Reconcile with whatever is stored now (a sibling tab may have written since load) and
    // make sure the DOM class matches the store on first mount.
    currentTheme = readStoredTheme();
    applyTheme(currentTheme);
    for (const notify of [...listeners]) notify();
  }, []);

  const setTheme = useCallback((next: Theme) => setSharedTheme(next), []);
  const toggle = useCallback(() => {
    setSharedTheme(currentTheme === "dark" ? "light" : "dark");
  }, []);

  return { theme, isDark, setTheme, toggle };
}
