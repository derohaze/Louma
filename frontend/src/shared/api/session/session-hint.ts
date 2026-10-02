/**
 * Best-effort UX hint: whether this browser has ever held a session. The refresh cookie is
 * httpOnly so JS cannot read it, and a speculative `/me` + `refresh` probe on every public auth
 * page visit fires a failing request (401 logged out, 502 backend down) that the browser still
 * logs to the console even when caught. The hint lets those pages skip the probe when no session
 * can exist. It is never an auth decision — the server stays authoritative, and forcing or
 * clearing it only adds or skips one speculative request.
 */
const SESSION_HINT_KEY = "louma:has-session";

function writeSessionHint(): void {
  try {
    window.localStorage?.setItem(SESSION_HINT_KEY, "1");
  } catch {
    // A hint that cannot be stored only costs one speculative request; never break auth for it.
  }
}

export { writeSessionHint };

/**
 * Whether this browser has ever held a session. Read (not an auth decision) so a first-time visitor
 * who is not signed in can be sent to create an account while a returning visitor whose session
 * expired is sent to log in. The server stays authoritative either way.
 */
export function hasSessionHint(): boolean {
  try {
    return window.localStorage?.getItem(SESSION_HINT_KEY) === "1";
  } catch {
    return false;
  }
}

export function clearSessionHint(): void {
  try {
    window.localStorage?.removeItem(SESSION_HINT_KEY);
  } catch {
    // See writeSessionHint: storage failure must not affect the session.
  }
}
