import { readSessionCsrfToken, setSessionCsrfToken } from "@/shared/api/session/session";

/**
 * The CSRF token this page holds for the signed-in session.
 *
 * The API refuses a state-changing request that does not carry the token derived for the scope it
 * belongs to, so this lives in memory exactly like the access token: the server mints it with every
 * response that starts or rotates a session, and a rejected page simply asks for a new one.
 */
export const CSRF_HEADER = "X-CSRF-Token";
const CSRF_COOKIE = "louma_csrf";
/** One in-flight request for the pre-session token, so a burst of requests asks for it once. */
let preauthRequest: Promise<string | null> | null = null;
/**
 * True once the API answered the bootstrap with 404: a backend from before the CSRF release has no
 * `/auth/csrf`, and it also expects no token, so requests go headerless instead of failing the
 * bootstrap on every call. Reset on a CSRF rejection in case the backend changed under this tab.
 */
let preauthUnsupported = false;

/** Which token a request must carry: the session's, the pre-session one, or none for a read. */
export type CsrfScope = "session" | "preauth" | "none";

export function readCsrfCookie(): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${CSRF_COOKIE}=([^;]+)`));
  return match?.[1] ?? null;
}

export function isPreauthUnsupported(): boolean {
  return preauthUnsupported;
}

export function markPreauthUnsupported(): void {
  preauthUnsupported = true;
}

export function readPreauthRequest(): Promise<string | null> | null {
  return preauthRequest;
}

export function writePreauthRequest(request: Promise<string | null> | null): void {
  preauthRequest = request;
}

export function readMemorySessionCsrfToken(): string | null {
  return readSessionCsrfToken();
}

/** Drops a possibly stale pre-session token (for example after the server's keys rotated). */
export function forgetPreauthCsrfToken(): void {
  preauthRequest = null;
  preauthUnsupported = false;
  try {
    if (typeof document !== "undefined") document.cookie = `${CSRF_COOKIE}=; Max-Age=0; path=/`;
  } catch {
    // Clearing the cache is best-effort; the retry below re-bootstraps either way.
  }
}

/** Records the token minted with a new or rotated session, replacing whatever the tab held. */
export function acceptSessionCsrfToken(token: string | null): void {
  setSessionCsrfToken(token);
}
