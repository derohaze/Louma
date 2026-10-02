import { clearWalletSnapshot } from "@/shared/lib/wallet";
import { writeSessionHint } from "@/shared/api/session/session-hint";

/**
 * In-memory session state. The access token and the session CSRF token live here (never in
 * storage) so a reload always rebuilds them from the refresh cookie via the API.
 */
let accessToken: string | null = null;
let sessionCsrfToken: string | null = null;
let refreshInFlight: Promise<string> | null = null;

export function readAccessToken(): string | null {
  return accessToken;
}

export function writeAccessToken(token: string | null): void {
  accessToken = token;
}

export function readSessionCsrfToken(): string | null {
  return sessionCsrfToken;
}

export function setSessionCsrfToken(token: string | null): void {
  sessionCsrfToken = token;
}

export function readRefreshPromise(): Promise<string> | null {
  return refreshInFlight;
}

export function writeRefreshPromise(promise: Promise<string> | null): void {
  refreshInFlight = promise;
}

/**
 * Called only when a session starts (sign-in, sign-up, second factor). A new session must not see
 * the wallet snapshot the previous one left in the tab, so that cache is dropped here.
 */
export function acceptAccessToken(token: string | null): void {
  accessToken = token;
  // A new session gets a new CSRF token with its first response; the previous session's must not be
  // carried into it.
  sessionCsrfToken = null;
  if (token) writeSessionHint();
  clearWalletSnapshot();
}

export function clearAccessToken(): void {
  accessToken = null;
  sessionCsrfToken = null;
}
