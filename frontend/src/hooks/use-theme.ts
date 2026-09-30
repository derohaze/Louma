import { useCallback, useEffect, useState } from "react";

export type Theme = "light" | "dark";

const STORAGE_KEY = "louma-theme";

/** Read the stored theme without touching the DOM, so SSR stays safe. */
function initialTheme(): Theme {
  if (typeof window === "undefined") return "light";
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "dark" || stored === "light") return stored;
  } catch {
    // Private mode or blocked storage: fall through to the default.
  }
  return "light";
}

/**
 * Single owner of the dashboard color scheme. Toggling adds/removes the
 * `.dark` class on <html> (see styles.css `@custom-variant dark`), so every
 * `dark:` Tailwind utility flips at once. The choice persists in localStorage.
 */
export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(initialTheme);
  const isDark = theme === "dark";

  useEffect(() => {
    document.documentElement.classList.toggle("dark", isDark);
    try {
      window.localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // Storage is a progressive enhancement; the class toggle above already applied.
    }
  }, [theme, isDark]);

  const setTheme = useCallback((next: Theme) => setThemeState(next), []);
  const toggle = useCallback(() => {
    setThemeState((prev) => (prev === "dark" ? "light" : "dark"));
  }, []);

  return { theme, isDark, setTheme, toggle };
}
