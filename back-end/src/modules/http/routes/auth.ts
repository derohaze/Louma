import type { FastifyInstance } from "fastify";
import { z } from "zod";
import * as auth from "../../auth/service.js";
import { preauthCsrfToken, sessionCsrfToken } from "../../security/csrf.js";
import { serviceUnavailable, unauthorized } from "../../../shared/errors.js";
import {
  authBody,
  loginPasswordSchema,
  loginSchema,
  passwordSchema,
  publicIdSchema,
  registerSchema,
} from "../schemas.js";
import {
  authenticated,
  clientIp,
  csrfProtected,
  clearRefreshCookie,
  getAuth,
  parseBody,
  setAuthResponseCookie,
  setCsrfCookie,
} from "../http-helpers.js";
import { enforceRateLimit } from "../../../app.js";

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Issues the token the page needs before it can make its first state-changing request.
   *
   * The token is derived from the server's own key, so this endpoint hands out no secret a forged
   * request could reuse: it exists so a browser that has just loaded the app — and therefore holds
   * no token yet — can obtain one without the page having to invent it.
   */
  app.get(
    "/api/v1/auth/csrf",
    { config: { rateLimit: { max: 60, timeWindow: 60_000 } } },
    async (_request, reply) => {
      const token = preauthCsrfToken(app.config);
      setCsrfCookie(app, reply, token);
      return { csrfToken: token };
    },
  );

  app.post(
    "/api/v1/auth/register",
    {
      ...csrfProtected(app),
      config: { rateLimit: { max: 5, timeWindow: 60_000 } },
      schema: authBody(registerSchema),
    },
    async (request, reply) => {
      const body = parseBody(registerSchema, request.body);
      // The real client IP (see clientIp): the socket address here is a shared edge/proxy address.
      // It is stored with the account immediately and enriched afterwards, because a lookup service
      // is not part of registering: it may only add fields, and never delay or fail the request.
      const ipAddress = clientIp(request).slice(0, 45);
      const session = await auth.register({
        collections: app.collections,
        mongoClient: app.mongoClient,
        config: app.config,
        ...body,
        requestId: request.id,
        userAgent: request.headers["user-agent"],
        ipAddress,
      });
      void auth
        .captureSignupLocation({
          collections: app.collections,
          config: app.config,
          ownerUserId: session.user.id,
          ipAddress,
        })
        .then((location) => {
          if (location)
            request.log.info(
              { userId: session.user.id, ip: location.ipAddress, country: location.country, city: location.city },
              "signup_location_captured",
            );
        })
        .catch((error: unknown) => {
          request.log.warn({ err: error, userId: session.user.id }, "signup_location_lookup_failed");
        });
      setAuthResponseCookie(app, reply, session.refreshToken);
      return reply.code(201).send({
        user: session.user,
        wallet: session.wallet,
        accessToken: session.accessToken,
        accessTokenTtlSeconds: session.accessTokenTtlSeconds,
        sessionId: session.sessionId,
        csrfToken: sessionCsrfToken(app.config, session.sessionId),
      });
    },
  );

  app.post(
    "/api/v1/auth/login",
    {
      ...csrfProtected(app),
      config: { rateLimit: { max: 5, timeWindow: 60_000 } },
      schema: authBody(loginSchema),
    },
    async (request, reply) => {
      const body = parseBody(loginSchema, request.body);
      // Distributed login throttle per IP, fail-open: a Redis outage never locks real users out.
      const loginOk = await enforceRateLimit({ app, reply, scope: "login", identity: clientIp(request), limit: app.config.redis.loginMaxPerMinute, requestId: request.id });
      if (!loginOk) return reply;
      const session = await auth.login({
        collections: app.collections,
        config: app.config,
        ...body,
        requestId: request.id,
        userAgent: request.headers["user-agent"],
      });
      setAuthResponseCookie(app, reply, session.refreshToken);
      return {
        user: session.user,
        accessToken: session.accessToken,
        accessTokenTtlSeconds: session.accessTokenTtlSeconds,
        sessionId: session.sessionId,
        csrfToken: sessionCsrfToken(app.config, session.sessionId),
        requiresTwoFactor: session.accessToken === null,
      };
    },
  );

  app.post(
    "/api/v1/auth/2fa/verify",
    {
      ...csrfProtected(app),
      config: { rateLimit: { max: 8, timeWindow: 60_000 } },
      schema: {
        body: {
          type: "object",
          required: ["sessionId", "code"],
          additionalProperties: false,
          properties: {
            sessionId: { type: "string", format: "uuid" },
            code: { type: "string", minLength: 6, maxLength: 64 },
          },
        },
      },
    },
    async (request, reply) => {
      const body = parseBody(
        z.object({ sessionId: publicIdSchema, code: z.string().min(6).max(64) }).strict(),
        request.body,
      );
      const refreshToken = request.cookies["louma_refresh"];
      if (!refreshToken) throw unauthorized();
      const session = await auth.completeTwoFactor({
        collections: app.collections,
        mongoClient: app.mongoClient,
        config: app.config,
        ...body,
        refreshToken,
        requestId: request.id,
      });
      setAuthResponseCookie(app, reply, session.refreshToken);
      return {
        user: session.user,
        accessToken: session.accessToken,
        accessTokenTtlSeconds: session.accessTokenTtlSeconds,
        sessionId: session.sessionId,
        csrfToken: sessionCsrfToken(app.config, session.sessionId),
        requiresTwoFactor: false,
      };
    },
  );

  app.post(
    "/api/v1/auth/refresh",
    {
      ...csrfProtected(app),
      config: { rateLimit: { max: 20, timeWindow: 60_000 } },
    },
    async (request, reply) => {
      const refreshToken = request.cookies["louma_refresh"];
      if (!refreshToken) throw unauthorized();
      const session = await auth.refreshSession({
        collections: app.collections,
        config: app.config,
        refreshToken,
        requestId: request.id,
      });
      setAuthResponseCookie(app, reply, session.refreshToken);
      return {
        user: session.user,
        accessToken: session.accessToken,
        accessTokenTtlSeconds: session.accessTokenTtlSeconds,
        sessionId: session.sessionId,
        csrfToken: sessionCsrfToken(app.config, session.sessionId),
      };
    },
  );

  app.post("/api/v1/auth/logout", authenticated, async (request, reply) => {
    const current = getAuth(request);
    await auth.revokeCurrentSession({
      collections: app.collections,
      ownerUserId: current.userId,
      sessionId: current.sessionId,
      requestId: request.id,
    });
    clearRefreshCookie(app, reply);
    return reply.code(204).send();
  });

  app.post(
    "/api/v1/auth/forgot-password",
    {
      ...csrfProtected(app),
      config: { rateLimit: { max: 5, timeWindow: 60_000 } },
      schema: {
        body: {
          type: "object",
          required: ["email"],
          additionalProperties: false,
          properties: { email: { type: "string", maxLength: 254, format: "email" } },
        },
      },
    },
    async () => {
      throw serviceUnavailable(
        "password_reset_unavailable",
        "Password reset is unavailable until a verified email delivery provider is configured.",
      );
    },
  );

  app.post(
    "/api/v1/auth/reset-password",
    {
      ...csrfProtected(app),
      config: { rateLimit: { max: 5, timeWindow: 60_000 } },
      schema: { body: { type: "object", additionalProperties: false } },
    },
    async () => {
      throw serviceUnavailable(
        "password_reset_unavailable",
        "Password reset is unavailable until a verified email delivery provider is configured.",
      );
    },
  );

  app.post(
    "/api/v1/auth/password",
    {
      ...authenticated,
      config: { rateLimit: { max: 5, timeWindow: 60_000 } },
      schema: {
        body: {
          type: "object",
          required: ["currentPassword", "newPassword"],
          additionalProperties: false,
          properties: {
            currentPassword: { type: "string", minLength: 1, maxLength: 128 },
            newPassword: { type: "string", minLength: 8, maxLength: 128 },
          },
        },
      },
    },
    async (request) => {
      const body = parseBody(
        z.object({ currentPassword: loginPasswordSchema, newPassword: passwordSchema }).strict(),
        request.body,
      );
      const current = getAuth(request);
      return auth.changePassword({
        collections: app.collections,
        ownerUserId: current.userId,
        sessionId: current.sessionId,
        currentPassword: body.currentPassword,
        newPassword: body.newPassword,
        requestId: request.id,
      });
    },
  );
}
