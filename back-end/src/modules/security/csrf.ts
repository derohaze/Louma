import { createHmac, hkdfSync, timingSafeEqual } from "node:crypto";
import type { AppConfig } from "../../config/env.js";
import { forbidden } from "../../shared/errors.js";

/**
 * CSRF tokens.
 *
 * The API authenticates requests with a bearer access token, and a browser never attaches that
 * header to a request another site made — so the data endpoints already cannot be driven by a
 * cross-site form. What a cookie *can* do cross-site is start or rotate a session, and a request
 * that carries a cookie is exactly the shape CSRF exploits: `POST /auth/login`, `POST /auth/refresh`
 * and `POST /auth/2fa/verify` all read the refresh cookie, and a cross-site form can reach them
 * without ever seeing the response. Requiring a token that only a reader of this API can obtain is
 * what closes that, and it is defense in depth on top of `SameSite`, which is a browser setting a
 * deployment can weaken (or a proxy can strip) while the token check cannot be configured away.
 *
 * The tokens are derived rather than stored. A key is separated out of the application's existing
 * encryption key with HKDF, so this adds no secret to rotate and no collection to hold per-session
 * state, and the derivation is scoped: `preauth` for the endpoints that run before a session exists,
 * and `session:<id>` for everything a signed-in page may change. A token therefore cannot be moved
 * from one scope to another, and it stops being valid the moment its session does.
 */

/** The cookie the page reads to bootstrap its first request; readable by design, see routes.ts. */
export const CSRF_COOKIE = "louma_csrf";
/** The header every state-changing request has to carry. */
export const CSRF_HEADER = "x-csrf-token";
/** A derived token is 43 URL-safe characters; anything longer is not one of ours. */
const CSRF_TOKEN_MAX_LENGTH = 128;
/** Distinct from every other use of the application key: a CSRF token, never a cipher key. */
const KEY_INFO = "louma-csrf-v1";

function signingKey(config: AppConfig): Buffer {
  return Buffer.from(hkdfSync("sha256", config.encryptionKey, Buffer.alloc(0), KEY_INFO, 32));
}

function scopeToken(config: AppConfig, scope: string): string {
  return createHmac("sha256", signingKey(config)).update(scope).digest("base64url");
}

/** The token a request may carry before it has a session: registering, signing in, refreshing. */
export function preauthCsrfToken(config: AppConfig): string {
  return scopeToken(config, "preauth");
}

/** The token a signed-in page must echo on every state-changing request. */
export function sessionCsrfToken(config: AppConfig, sessionId: string): string {
  return scopeToken(config, `session:${sessionId}`);
}

/**
 * True for the methods that change state. A request that only reads is not a CSRF target: it cannot
 * be made to *do* anything, and the browser would have to hand the answer back to the other site,
 * which the API's CORS configuration refuses.
 */
export function isStateChangingMethod(method: string): boolean {
  return method !== "GET" && method !== "HEAD" && method !== "OPTIONS";
}

/**
 * Rejects a request whose token is missing, malformed, or not the one this scope expects.
 *
 * The value arrives from a header, so it can be absent or repeated by anything that is not our page;
 * `provided` is therefore `unknown` and only a single string is considered. The comparison is
 * constant-time so a rejected token cannot be narrowed down byte by byte.
 */
export function assertCsrfToken(input: { config: AppConfig; provided: unknown; expected: string }): void {
  const provided = input.provided;
  if (typeof provided !== "string" || provided.length === 0 || provided.length > CSRF_TOKEN_MAX_LENGTH) {
    throw forbidden("csrf_token_invalid", "Refresh the page and try again.");
  }
  const left = Buffer.from(provided);
  const right = Buffer.from(input.expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) {
    throw forbidden("csrf_token_invalid", "Refresh the page and try again.");
  }
}
