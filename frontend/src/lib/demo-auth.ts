/**
 * Demo-only authentication gate for the frontend-building phase.
 *
 * Any credentials open the dashboard: this store only remembers that the visitor "signed in"
 * (in localStorage) so the wallet shell can keep unauthenticated visitors on the login page.
 * There is no token, no session, and no credential here — swapping this for a real auth API
 * later means replacing `demoLogin`/`demoLogout`/`isAuthed` with real requests.
 */
const STORAGE_KEY = "louma-demo-auth-email";

const readStoredEmail = (): string | null => {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
};

/** True when the visitor already passed the demo login screen on this browser. */
export const isAuthed = (): boolean => readStoredEmail() !== null;

/** The email the visitor signed in with, if any. */
export const readAuthEmail = (): string | null => readStoredEmail();

/** Demo sign-in: accepts anything and remembers the email on this browser only. */
export const demoLogin = (email: string): void => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, email.trim());
  } catch {
    // Private mode or blocked storage: the gate simply asks again next visit.
  }
};

/** Demo sign-out: forgets the browser so the next visit lands on the login page. */
export const demoLogout = (): void => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to clean up.
  }
};
