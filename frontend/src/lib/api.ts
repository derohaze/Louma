import { clearWalletSnapshot } from "@/lib/wallet-cache";

export interface ApiUser {
  id: string;
  email: string;
  displayName: string;
  country: string | null;
  emailVerifiedAt: string | null;
  createdAt: string;
}

export interface ApiWallet {
  id: string;
  address: string;
  status: "active" | "frozen";
  balance: string;
  currency: "LMA";
  createdAt: string;
  customAddressChangedAt: string | null;
  customAddress: string | null;
}

/**
 * One mining cycle as the API reports it. It carries the persisted window and rate plus the live
 * accrual the server computed, and it carries the rate as exact integers as well so the page can
 * advance the counter between responses without the server ever being out of the loop.
 */
export interface ApiMiningSession {
  id: string;
  poolId: string | null;
  status: "active" | "completed" | "settled";
  cycleNumber: number;
  startedAt: string;
  endsAt: string;
  durationSeconds: number;
  rate: string;
  rateUnit: "LMA/hour";
  rateUnits: number;
  rateScale: number;
  serverNow: string;
  elapsedSeconds: number;
  remainingSeconds: number;
  accruedMinor: number;
  accrued: string;
  settledMinor: number;
  settled: string;
  totalAccruedMinor: number;
  totalAccrued: string;
  progress: number;
  canSettle: boolean;
  lastSettledAt: string | null;
}

export interface ApiMiningState {
  status: "idle" | "active" | "completed" | "settled";
  serverNow: string;
  enabled: boolean;
  canStart: boolean;
  cycleDurationSeconds: number;
  session: ApiMiningSession | null;
  /** Pool the account mines in; null until it joins one (start is refused then). */
  poolId: string | null;
  /** True when the account must join a pool before Start is accepted. */
  poolRequired: boolean;
}

export interface ApiMiningPool {
  id: string;
  name: string;
  riskLevel: "low" | "medium";
  baseHashrate: number;
  activeMiners: number;
  maxMembers: number;
  full: boolean;
  effectivePower: number;
  mySharePercent: number;
  rewardRangeText: string;
  description: string;
  joined: boolean;
}

export interface ApiMiningPoolsState {
  pools: ApiMiningPool[];
  poolId: string | null;
}

export interface ApiTransaction {
  id: string;
  transferId: string;
  direction: "sent" | "received";
  counterpartyAddress: string;
  amount: string;
  fee: string;
  netAmount: string;
  balanceAfter?: string;
  currency: "LMA";
  status: "completed";
  type: "transfer";
  note: string;
  correlationId: string;
  createdAt: string;
  completedAt: string;
}

/**
 * What the staged transfer form needs before it can offer an amount: the resolved recipient, and —
 * once an amount is offered — the tax, the balance, and what the balance becomes, all computed by
 * the same backend arithmetic the transfer itself uses.
 */
export interface ApiTransferPreview {
  recipient: { address: string; displayName: string | null };
  quote: {
    amount: string;
    fee: string;
    netAmount: string;
    balance: string;
    balanceAfter: string;
    sufficient: boolean;
  } | null;
  /**
   * The server's approval of exactly this intent. The transfer consumes it, and the page only
   * carries it: the recipient, amount and fee the transfer executes are the ones inside it, not
   * whatever the form holds by the time the request is sent.
   */
  authorization: {
    id: string;
    expiresAt: string;
    intent: { recipientAddress: string; amount: string; fee: string; netAmount: string; currency: string };
  } | null;
}

export interface ApiSecurityOverview {
  wallet: { status: "active" | "frozen" };
  twoFactor: { enabled: boolean; enabledAt: string | null; recoveryCodesRemaining: number };
  transferPassword: { enabled: boolean; changedAt: string | null };
  activeSessions: number;
  events: { id: string; type: string; outcome: "success" | "failure"; createdAt: string }[];
}

export interface ApiSession {
  id: string;
  device: string;
  userAgent: string | null;
  current: boolean;
  createdAt: string;
  lastActiveAt: string;
  expiresAt: string;
}

export interface ApiNotification {
  id: string;
  kind: string;
  title: string;
  body: string;
  readAt: string | null;
  createdAt: string;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

let accessToken: string | null = null;
let refreshInFlight: Promise<string> | null = null;

/**
 * The CSRF token this page holds for the signed-in session.
 *
 * The API refuses a state-changing request that does not carry the token derived for the scope it
 * belongs to, so this lives in memory exactly like the access token: the server mints it with every
 * response that starts or rotates a session, and a rejected page simply asks for a new one.
 */
const CSRF_HEADER = "X-CSRF-Token";
const CSRF_COOKIE = "louma_csrf";
let sessionCsrfToken: string | null = null;
/** One in-flight request for the pre-session token, so a burst of requests asks for it once. */
let preauthRequest: Promise<string | null> | null = null;
/**
 * True once the API answered the bootstrap with 404: a backend from before the CSRF release has no
 * `/auth/csrf`, and it also expects no token, so requests go headerless instead of failing the
 * bootstrap on every call. Reset on a CSRF rejection in case the backend changed under this tab.
 */
let preauthUnsupported = false;

/** Which token a request must carry: the session's, the pre-session one, or none for a read. */
type CsrfScope = "session" | "preauth" | "none";

function readCsrfCookie(): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${CSRF_COOKIE}=([^;]+)`));
  return match?.[1] ?? null;
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
  if (preauthUnsupported) return null;
  if (!preauthRequest) {
    preauthRequest = send<{ csrfToken: string }>(
      "/api/v1/auth/csrf",
      { method: "GET", auth: false, csrf: "none" },
      null,
    )
      .then((response) => response.csrfToken)
      .catch((error: unknown) => {
        if (error instanceof ApiError && error.status === 404) {
          preauthUnsupported = true;
          return null;
        }
        throw error;
      })
      .finally(() => {
        preauthRequest = null;
      });
  }
  return preauthRequest;
}

/**
 * The token for one request. A session scope without one falls back to the pre-session token so the
 * request still proves where it came from and the API answers with a refusal the page can act on,
 * rather than the request failing before it is sent. Null when the backend predates CSRF entirely.
 */
async function csrfTokenFor(scope: Exclude<CsrfScope, "none">): Promise<string | null> {
  if (scope === "preauth") return preauthCsrfToken();
  return sessionCsrfToken ?? (await preauthCsrfToken());
}

/** Drops a possibly stale pre-session token (for example after the server's keys rotated). */
function forgetPreauthCsrfToken(): void {
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
  sessionCsrfToken = token;
}

/**
 * Best-effort UX hint: whether this browser has ever held a session. The refresh cookie is
 * httpOnly so JS cannot read it, and a speculative `/me` + `refresh` probe on every public auth
 * page visit fires a failing request (401 logged out, 502 backend down) that the browser still
 * logs to the console even when caught. The hint lets those pages skip the probe when no session
 * can exist. It is never an auth decision — the server stays authoritative, and forcing or
 * clearing it only adds or skips one speculative request.
 */
const SESSION_HINT_KEY = "louma:has-session";

function readSessionHint(): boolean {
  try {
    if (typeof window === "undefined" || !window.localStorage) return true;
    return window.localStorage.getItem(SESSION_HINT_KEY) === "1";
  } catch {
    return true;
  }
}

function writeSessionHint(): void {
  try {
    window.localStorage?.setItem(SESSION_HINT_KEY, "1");
  } catch {
    // A hint that cannot be stored only costs one speculative request; never break auth for it.
  }
}

export function hasSessionHint(): boolean {
  return readSessionHint();
}

export function clearSessionHint(): void {
  try {
    window.localStorage?.removeItem(SESSION_HINT_KEY);
  } catch {
    // See writeSessionHint: storage failure must not affect the session.
  }
}

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

async function refreshAccessToken(): Promise<string> {
  if (!refreshInFlight) {
    // The refresh runs before any session token exists in memory — after a reload this page holds
    // none — so it authenticates itself with the pre-session token.
    refreshInFlight = send<{ accessToken: string; csrfToken: string }>(
      "/api/v1/auth/refresh",
      { method: "POST", auth: false, csrf: "preauth" },
      null,
    )
      .then(({ accessToken: token, csrfToken }) => {
        accessToken = token;
        sessionCsrfToken = csrfToken;
        writeSessionHint();
        return token;
      })
      .catch((error: unknown) => {
        accessToken = null;
        // Only an authoritative rejection proves the session is gone: a transport or server
        // fault must keep the hint so a later visit still probes once the backend recovers.
        if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
          clearSessionHint();
        }
        throw error;
      })
      .finally(() => {
        refreshInFlight = null;
      });
  }
  return refreshInFlight;
}

/**
 * Opens the realtime notification stream.
 *
 * It authenticates exactly like every other call — the bearer header plus the refresh cookie — and
 * never puts a token in the query string, where it would end up in access logs, proxies, and browser
 * history. That rules out `EventSource`, which cannot send headers, so the connection is a plain
 * `fetch` whose body is read as a stream; the reconnect loop that `EventSource` would have provided
 * lives in `lib/notification-stream.ts`.
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

  let token = accessToken;
  if (!token) token = await refreshAccessToken();
  const response = await request(token);
  if (response.status !== 401) return response;
  accessToken = null;
  return request(await refreshAccessToken());
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
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
        sessionCsrfToken = null;
        forgetPreauthCsrfToken();
        return send<T>(path, options, null);
      }
      throw error;
    }
  }
  let token = accessToken;
  if (!token) token = await refreshAccessToken();
  try {
    return await send<T>(path, options, token);
  } catch (error) {
    if (error instanceof ApiError && error.status === 403 && error.code === "csrf_token_invalid") {
      // The session token this tab holds is stale (rollout crossing, key rotation, or a newer
      // session from another tab). Refresh mints the current session's token — re-bootstrapping
      // the pre-session token first when needed — and the request is retried once with it.
      sessionCsrfToken = null;
      forgetPreauthCsrfToken();
      accessToken = null;
      token = await refreshAccessToken();
      return send<T>(path, options, token);
    }
    if (!(error instanceof ApiError) || error.status !== 401) throw error;
    accessToken = null;
    token = await refreshAccessToken();
    return send<T>(path, options, token);
  }
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

export async function login(input: { email: string; password: string }) {
  const response = await api.post<{
    user: ApiUser;
    accessToken: string | null;
    sessionId: string;
    csrfToken: string;
    requiresTwoFactor: boolean;
  }>("/api/v1/auth/login", input, { auth: false, csrf: "preauth" });
  acceptAccessToken(response.accessToken);
  acceptSessionCsrfToken(response.csrfToken);
  return response;
}

export async function register(input: { email: string; password: string; displayName: string }) {
  const response = await api.post<{
    user: ApiUser;
    wallet: { id: string; address: string };
    accessToken: string;
    sessionId: string;
    csrfToken: string;
  }>("/api/v1/auth/register", input, { auth: false, csrf: "preauth" });
  acceptAccessToken(response.accessToken);
  acceptSessionCsrfToken(response.csrfToken);
  return response;
}

export async function completeTwoFactor(input: { sessionId: string; code: string }) {
  const response = await api.post<{ accessToken: string; user: ApiUser; csrfToken: string }>(
    "/api/v1/auth/2fa/verify",
    input,
    { auth: false, csrf: "preauth" },
  );
  acceptAccessToken(response.accessToken);
  acceptSessionCsrfToken(response.csrfToken);
  return response;
}

export async function logout(): Promise<void> {
  try {
    await api.post<void>("/api/v1/auth/logout");
  } finally {
    clearAccessToken();
    clearSessionHint();
  }
}
