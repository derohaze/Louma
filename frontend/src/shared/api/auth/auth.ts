import { acceptAccessToken, clearAccessToken } from "@/shared/api/session/session";
import { acceptSessionCsrfToken } from "@/shared/api/session/csrf";
import { clearSessionHint } from "@/shared/api/session/session-hint";
import { api } from "@/shared/api/client/transport";
import type { ApiUser } from "@/shared/api/client/types";

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
