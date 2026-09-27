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

interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  idempotencyKey?: string;
  auth?: boolean;
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
  const headers = new Headers();
  if (options.body !== undefined) headers.set("Content-Type", "application/json");
  if (options.idempotencyKey) headers.set("Idempotency-Key", options.idempotencyKey);
  if (bearer) headers.set("Authorization", `Bearer ${bearer}`);
  const response = await fetch(path, {
    method: options.method ?? "GET",
    headers,
    credentials: "include",
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
  });
  return decodeResponse<T>(response);
}

async function refreshAccessToken(): Promise<string> {
  if (!refreshInFlight) {
    refreshInFlight = send<{ accessToken: string }>(
      "/api/v1/auth/refresh",
      { method: "POST", auth: false },
      null,
    )
      .then(({ accessToken: token }) => {
        accessToken = token;
        return token;
      })
      .catch((error: unknown) => {
        accessToken = null;
        throw error;
      })
      .finally(() => {
        refreshInFlight = null;
      });
  }
  return refreshInFlight;
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  if (options.auth === false) return send<T>(path, options, null);
  let token = accessToken;
  if (!token) token = await refreshAccessToken();
  try {
    return await send<T>(path, options, token);
  } catch (error) {
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
  clearWalletSnapshot();
}

export function clearAccessToken(): void {
  accessToken = null;
}

export const api = {
  get: <T>(path: string) => apiRequest<T>(path),
  post: <T>(
    path: string,
    body?: unknown,
    options: Pick<RequestOptions, "auth" | "idempotencyKey"> = {},
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
    requiresTwoFactor: boolean;
  }>("/api/v1/auth/login", input, { auth: false });
  acceptAccessToken(response.accessToken);
  return response;
}

export async function register(input: { email: string; password: string; displayName: string }) {
  const response = await api.post<{
    user: ApiUser;
    wallet: { id: string; address: string };
    accessToken: string;
    sessionId: string;
  }>("/api/v1/auth/register", input, { auth: false });
  acceptAccessToken(response.accessToken);
  return response;
}

export async function completeTwoFactor(input: { sessionId: string; code: string }) {
  const response = await api.post<{ accessToken: string; user: ApiUser }>(
    "/api/v1/auth/2fa/verify",
    input,
    { auth: false },
  );
  acceptAccessToken(response.accessToken);
  return response;
}

export async function logout(): Promise<void> {
  try {
    await api.post<void>("/api/v1/auth/logout");
  } finally {
    clearAccessToken();
  }
}
