import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  RouteShorthandOptions,
} from "fastify";
import type { z } from "zod";
import type { AuthContext } from "../../app.js";
import {
  assertCsrfToken,
  CSRF_COOKIE,
  CSRF_HEADER,
  preauthCsrfToken,
} from "../security/csrf.js";
import { badRequest, unauthorized } from "../../shared/errors.js";

export function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) throw badRequest("invalid_request", "The request data is invalid.");
  return result.data;
}

function setRefreshCookie(app: FastifyInstance, reply: FastifyReply, refreshToken: string) {
  return reply.setCookie("louma_refresh", refreshToken, {
    httpOnly: true,
    secure: app.config.cookieSecure,
    sameSite: app.config.cookieSameSite,
    path: "/api/v1/auth",
    maxAge: Math.floor(30 * 24 * 60 * 60),
  } as never);
}

export function clearRefreshCookie(app: FastifyInstance, reply: FastifyReply) {
  return reply.clearCookie("louma_refresh", {
    path: "/api/v1/auth",
    httpOnly: true,
    secure: app.config.cookieSecure,
    sameSite: app.config.cookieSameSite,
  } as never);
}

export function setAuthResponseCookie(
  app: FastifyInstance,
  reply: FastifyReply,
  refreshToken: string,
) {
  setRefreshCookie(app, reply, refreshToken);
}

/**
 * Hands the page the token it has to echo on every request it makes before a session exists.
 *
 * This cookie is readable by design, and it is not a credential: after a reload the page has no
 * memory of any token, and it needs one for the refresh request that rebuilds its session. The value
 * is only ever accepted alongside the request that carries it, and it is keyed by the server, so a
 * value planted by a sibling origin is worth nothing.
 */
export function setCsrfCookie(app: FastifyInstance, reply: FastifyReply, token: string) {
  // Path `/` (not `/api/v1`): the page reads this cookie from `document.cookie` on routes such as
  // `/login` and `/`, where a narrower path would hide it and force another `/auth/csrf` round trip
  // on every page load. Readable by design (see above); it is only ever accepted alongside a request
  // that carries it back, so wider visibility grants no capability.
  return reply.setCookie(CSRF_COOKIE, token, {
    httpOnly: false,
    secure: app.config.cookieSecure,
    sameSite: app.config.cookieSameSite,
    path: "/",
    maxAge: Math.floor(30 * 24 * 60 * 60),
  } as never);
}

export function getAuth(request: FastifyRequest): AuthContext {
  if (!request.auth) throw unauthorized();
  return request.auth;
}

async function requireAuth(request: FastifyRequest) {
  await request.server.authenticate(request);
}

export const authenticated = { preHandler: requireAuth } satisfies RouteShorthandOptions;

/**
 * Guards the endpoints that start or rotate a session with the pre-session CSRF token.
 *
 * These are the requests a browser can make with nothing but a cookie — registering, signing in,
 * completing a second factor, refreshing — which is precisely the shape CSRF exploits: another site
 * can post to them without ever being able to read the answer or the token this API hands out.
 */
export const csrfProtected = (app: FastifyInstance) => ({
  preHandler: async (request: FastifyRequest) => {
    assertCsrfToken({
      config: app.config,
      expected: preauthCsrfToken(app.config),
      provided: request.headers[CSRF_HEADER],
    });
  },
});
