import { ApiError } from "@/shared/api/client/types";
import {
  readAccessToken,
  writeAccessToken,
  readRefreshPromise,
  writeRefreshPromise,
  setSessionCsrfToken,
} from "@/shared/api/session/session";
import { clearSessionHint, writeSessionHint } from "@/shared/api/session/session-hint";
import {
  CSRF_HEADER,
  forgetPreauthCsrfToken,
  isPreauthUnsupported,
  markPreauthUnsupported,
  readCsrfCookie,
  readMemorySessionCsrfToken,
  readPreauthRequest,
  writePreauthRequest,
  type CsrfScope,
} from "@/shared/api/session/csrf";

interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  idempotencyKey?: string;
  auth?: boolean;
  /**
   * Which CSRF token this request carries. Read requests need none; anything else defaults to the
   * session's, and the endpoints that run before a session exists ask for the pre-session one.
   */
  csrf?: CsrfScope;
}

async function decodeResponse<T>(response: Response): Promise<T> {
  if (response.status === 204) return undefined as T;
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error =
      payload && typeof payload === "object" && "error" in payload
        ? (payload as { error?: { code?: unknown; message?: unknown } }).error
        : undefined;
    throw new ApiError(
      typeof error?.message === "string" ? error.message : "The request could not be completed.",
      response.status,
      typeof error?.code === "string" ? error.code : "request_failed",
    );
  }
  return payload as T;
}

async function send<T>(path: string, options: RequestOptions, bearer: string | null): Promise<T> {
  const method = options.method ?? "GET";
  const headers = new Headers();
  if (options.body !== undefined) headers.set("Content-Type", "application/json");
  if (options.idempotencyKey) headers.set("Idempotency-Key", options.idempotencyKey);
  if (bearer) headers.set("Authorization", `Bearer ${bearer}`);
  const csrf = options.csrf ?? (method === "GET" ? "none" : "session");
  if (csrf !== "none") {
    const token = await csrfTokenFor(csrf);
    // Null only against a pre-CSRF backend, which expects no header at all.
    if (token) headers.set(CSRF_HEADER, token);
  }
  const response = await fetch(path, {
    method,
    headers,
    credentials: "include",
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
  });
  return decodeResponse<T>(response);
}

/**
 * The token for the requests that run before a session exists: signing in, refreshing.
 *
 * A browser that has visited before already holds it in the cookie the API set, which is what lets a
 * reload put a token on its very first request without an extra round trip; a first visit asks for
 * one. The cookie is readable by design — this page has to send the value back — and it is not a
 * credential on its own: the API only accepts it alongside a request that carries it.
 */
async function preauthCsrfToken(): Promise<string | null> {
  const fromCookie = readCsrfCookie();
  if (fromCookie) return fromCookie;
  // A backend from before the CSRF release has no bootstrap endpoint and expects no header: going
  // headerless keeps the new page working against it instead of failing every mutation at bootstrap.
  if (isPreauthUnsupported()) return null;
  if (!readPreauthRequest()) {
    writePreauthRequest(
      send<{ csrfToken: string }>(
        "/api/v1/auth/csrf",
        { method: "GET", auth: false, csrf: "none" },
        null,
      )
        .then((response) => response.csrfToken)
        .catch((error: unknown) => {
          if (error instanceof ApiError && error.status === 404) {
            markPreauthUnsupported();
            return null;
          }
          throw error;
        })
        .finally(() => {
          writePreauthRequest(null);
        }),
    );
  }
  return readPreauthRequest();
}

/**
 * The token for one request. A session scope without one falls back to the pre-session token so the
 * request still proves where it came from and the API answers with a refusal the page can act on,
 * rather than the request failing before it is sent. Null when the backend predates CSRF entirely.
 */
async function csrfTokenFor(scope: Exclude<CsrfScope, "none">): Promise<string | null> {
  if (scope === "preauth") return preauthCsrfToken();
  return readMemorySessionCsrfToken() ?? (await preauthCsrfToken());
}

async function refreshAccessToken(): Promise<string> {
  if (!readRefreshPromise()) {
    // The refresh runs before any session token exists in memory — after a reload this page holds
    // none — so it authenticates itself with the pre-session token.
    writeRefreshPromise(
      send<{ accessToken: string; csrfToken: string }>(
        "/api/v1/auth/refresh",
        { method: "POST", auth: false, csrf: "preauth" },
        null,
      )
        .then(({ accessToken: token, csrfToken }) => {
          writeAccessToken(token);
          setSessionCsrfToken(csrfToken);
          writeSessionHint();
          return token;
        })
        .catch((error: unknown) => {
          writeAccessToken(null);
          // Only an authoritative rejection proves the session is gone: a transport or server
          // fault must keep the hint so a later visit still probes once the backend recovers.
          if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
            clearSessionHint();
          }
          throw error;
        })
        .finally(() => {
          writeRefreshPromise(null);
        }),
    );
  }
  return readRefreshPromise() as Promise<string>;
}

/**
 * Opens the realtime notification stream.
 *
 * It authenticates exactly like every other call — the bearer header plus the refresh cookie — and
 * never puts a token in the query string, where it would end up in access logs, proxies, and browser
 * history. That rules out `EventSource`, which cannot send headers, so the connection is a plain
 * `fetch` whose body is read as a stream; the reconnect loop that `EventSource` would have provided
 * lives in `notification-stream.ts`.
 *
 * The access token is refreshed once here, like any other request: the stream is authorized at open
 * only, so an expired token must be replaced rather than surfaced as a broken connection.
 */
export async function openNotificationStream(signal: AbortSignal): Promise<Response> {
  const request = (bearer: string) =>
    fetch("/api/v1/notifications/stream", {
      method: "GET",
      headers: { Accept: "text/event-stream", Authorization: `Bearer ${bearer}` },
      credentials: "include",
      signal,
    });

  let token = readAccessToken();
  if (!token) token = await refreshAccessToken();
  const response = await request(token);
  if (response.status !== 401) return response;
  writeAccessToken(null);
  return request(await refreshAccessToken());
}

async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  if (options.auth === false) {
    try {
      return await send<T>(path, options, null);
    } catch (error) {
      // A tab that crossed the CSRF rollout (or a key rotation) holds a stale cached token while
      // the server moved on. Re-bootstrap once and retry rather than failing until a manual reload.
      if (
        error instanceof ApiError &&
        error.status === 403 &&
        error.code === "csrf_token_invalid"
      ) {
        setSessionCsrfToken(null);
        forgetPreauthCsrfToken();
        return send<T>(path, options, null);
      }
      throw error;
    }
  }
  let token = readAccessToken();
  if (!token) token = await refreshAccessToken();
  try {
    return await send<T>(path, options, token);
  } catch (error) {
    if (error instanceof ApiError && error.status === 403 && error.code === "csrf_token_invalid") {
      // The session token this tab holds is stale (rollout crossing, key rotation, or a newer
      // session from another tab). Refresh mints the current session's token — re-bootstrapping
      // the pre-session token first when needed — and the request is retried once with it.
      setSessionCsrfToken(null);
      forgetPreauthCsrfToken();
      writeAccessToken(null);
      token = await refreshAccessToken();
      return send<T>(path, options, token);
    }
    if (!(error instanceof ApiError) || error.status !== 401) throw error;
    writeAccessToken(null);
    token = await refreshAccessToken();
    return send<T>(path, options, token);
  }
}

export const api = {
  get: <T>(path: string) => apiRequest<T>(path),
  post: <T>(
    path: string,
    body?: unknown,
    options: Pick<RequestOptions, "auth" | "idempotencyKey" | "csrf"> = {},
  ) => apiRequest<T>(path, { method: "POST", ...(body === undefined ? {} : { body }), ...options }),
  patch: <T>(path: string, body: unknown) => apiRequest<T>(path, { method: "PATCH", body }),
  delete: <T>(path: string) => apiRequest<T>(path, { method: "DELETE" }),
};

export function messageForError(error: unknown): string {
  return error instanceof Error ? error.message : "The request could not be completed. Try again.";
}
