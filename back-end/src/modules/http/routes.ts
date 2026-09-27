import type { FastifyInstance, FastifyReply, FastifyRequest, RouteShorthandOptions } from "fastify";
import { z } from "zod";
import type { AuthContext } from "../../app.js";
import * as auth from "../auth/service.js";
import * as security from "../security/service.js";
import * as wallets from "../wallets/service.js";
import * as transfers from "../transfers/service.js";
import { badRequest, forbidden, serviceUnavailable, unauthorized } from "../../shared/errors.js";
import { recordSecurityEvent } from "../security/audit.js";
import { MAX_NOTE_LENGTH } from "../../shared/types.js";

const emailSchema = z.string().trim().email().max(254);
const passwordSchema = z.string().min(8).max(128).regex(/[A-Za-z]/).regex(/\d/);
const loginPasswordSchema = z.string().min(1).max(128);
const publicIdSchema = z.string().uuid();
const pageLimitSchema = z.coerce.number().int().min(1).max(50).optional();
const transferSchema = z.object({ recipientAddress: z.string().trim().min(1).max(128), amount: z.string().min(1).max(32), note: z.string().max(MAX_NOTE_LENGTH).optional() }).strict();
const registerSchema = z.object({ email: emailSchema, password: passwordSchema, displayName: z.string().trim().min(1).max(32) }).strict();
const loginSchema = z.object({ email: emailSchema, password: loginPasswordSchema }).strict();
const totpCodeSchema = z.string().trim().regex(/^\d{6}$/);
const authBody = (_schema: z.ZodType) => ({ body: { type: "object", additionalProperties: true } });

function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) throw badRequest("invalid_request", "The request data is invalid.");
  return result.data;
}

function cookies(app: FastifyInstance, reply: FastifyReply, refreshToken: string) {
  return reply.setCookie("louma_refresh", refreshToken, {
    httpOnly: true,
    secure: app.config.cookieSecure,
    sameSite: app.config.cookieSameSite,
    path: "/api/v1/auth",
    maxAge: Math.floor(30 * 24 * 60 * 60),
  } as never);
}

function clearRefreshCookie(app: FastifyInstance, reply: FastifyReply) {
  return reply.clearCookie("louma_refresh", { path: "/api/v1/auth", httpOnly: true, secure: app.config.cookieSecure, sameSite: app.config.cookieSameSite } as never);
}

function setAuthResponseCookie(app: FastifyInstance, reply: FastifyReply, refreshToken: string) {
  cookies(app, reply, refreshToken);
}

function getAuth(request: FastifyRequest): AuthContext {
  if (!request.auth) throw unauthorized();
  return request.auth;
}

async function requireAuth(request: FastifyRequest) {
  await request.server.authenticate(request);
}

const authenticated = { preHandler: requireAuth } satisfies RouteShorthandOptions;

export async function registerCustomerRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/v1/auth/register", { config: { rateLimit: { max: 5, timeWindow: 60_000 } }, schema: authBody(registerSchema) }, async (request, reply) => {
    const body = parseBody(registerSchema, request.body);
    // `request.ip` is the socket address, or the forwarded one when TRUST_PROXY is on. It is stored
    // with the account immediately and enriched afterwards, because a lookup service is not part of
    // registering: it may only add fields, and never delay or fail the request.
    const ipAddress = request.ip.slice(0, 45);
    const session = await auth.register({ collections: app.collections, mongoClient: app.mongoClient, config: app.config, ...body, requestId: request.id, userAgent: request.headers["user-agent"], ipAddress });
    void auth
      .captureSignupLocation({ collections: app.collections, config: app.config, ownerUserId: session.user.id, ipAddress })
      .then((location) => {
        if (location) request.log.info({ userId: session.user.id, ip: location.ipAddress, country: location.country, city: location.city }, "signup_location_captured");
      })
      .catch((error: unknown) => {
        request.log.warn({ err: error, userId: session.user.id }, "signup_location_lookup_failed");
      });
    setAuthResponseCookie(app, reply, session.refreshToken);
    return reply.code(201).send({ user: session.user, wallet: session.wallet, accessToken: session.accessToken, accessTokenTtlSeconds: session.accessTokenTtlSeconds, sessionId: session.sessionId });
  });

  app.post("/api/v1/auth/login", { config: { rateLimit: { max: 5, timeWindow: 60_000 } }, schema: authBody(loginSchema) }, async (request, reply) => {
    const body = parseBody(loginSchema, request.body);
    const session = await auth.login({ collections: app.collections, config: app.config, ...body, requestId: request.id, userAgent: request.headers["user-agent"] });
    setAuthResponseCookie(app, reply, session.refreshToken);
    return { user: session.user, accessToken: session.accessToken, accessTokenTtlSeconds: session.accessTokenTtlSeconds, sessionId: session.sessionId, requiresTwoFactor: session.accessToken === null };
  });

  app.post("/api/v1/auth/2fa/verify", { config: { rateLimit: { max: 8, timeWindow: 60_000 } }, schema: { body: { type: "object", required: ["sessionId", "code"], additionalProperties: false, properties: { sessionId: { type: "string", format: "uuid" }, code: { type: "string", minLength: 6, maxLength: 64 } } } } }, async (request, reply) => {
    const body = parseBody(z.object({ sessionId: publicIdSchema, code: z.string().min(6).max(64) }).strict(), request.body);
    const refreshToken = request.cookies["louma_refresh"];
    if (!refreshToken)    throw unauthorized();
    const session = await auth.completeTwoFactor({ collections: app.collections, mongoClient: app.mongoClient, config: app.config, ...body, refreshToken, requestId: request.id });
    setAuthResponseCookie(app, reply, session.refreshToken);
    return { user: session.user, accessToken: session.accessToken, accessTokenTtlSeconds: session.accessTokenTtlSeconds, sessionId: session.sessionId, requiresTwoFactor: false };
  });

  app.post("/api/v1/auth/refresh", { config: { rateLimit: { max: 20, timeWindow: 60_000 } } }, async (request, reply) => {
    const refreshToken = request.cookies["louma_refresh"];
    if (!refreshToken) throw unauthorized();
    const session = await auth.refreshSession({ collections: app.collections, config: app.config, refreshToken, requestId: request.id });
    setAuthResponseCookie(app, reply, session.refreshToken);
    return { user: session.user, accessToken: session.accessToken, accessTokenTtlSeconds: session.accessTokenTtlSeconds, sessionId: session.sessionId };
  });

  app.post("/api/v1/auth/logout", authenticated, async (request, reply) => {
    const current = getAuth(request);
    await auth.revokeCurrentSession({ collections: app.collections, ownerUserId: current.userId, sessionId: current.sessionId, requestId: request.id });
    clearRefreshCookie(app, reply);
    return reply.code(204).send();
  });

  app.post("/api/v1/auth/forgot-password", { config: { rateLimit: { max: 5, timeWindow: 60_000 } }, schema: { body: { type: "object", required: ["email"], additionalProperties: false, properties: { email: { type: "string", maxLength: 254, format: "email" } } } } }, async (_request, _reply) => {
    throw serviceUnavailable("password_reset_unavailable", "Password reset is unavailable until a verified email delivery provider is configured.");
  });

  app.post("/api/v1/auth/reset-password", { config: { rateLimit: { max: 5, timeWindow: 60_000 } }, schema: { body: { type: "object", additionalProperties: false } } }, async () => {
    throw serviceUnavailable("password_reset_unavailable", "Password reset is unavailable until a verified email delivery provider is configured.");
  });

  app.get("/api/v1/me", authenticated, async (request) => auth.getCurrentUser({ collections: app.collections, ownerUserId: getAuth(request).userId }));
  app.patch("/api/v1/me", authenticated, async (request) => {
    const body = parseBody(z.object({ displayName: z.string().trim().min(1).max(32).optional(), country: z.string().regex(/^[A-Z]{2}$/).nullable().optional() }).strict().refine((value) => value.displayName !== undefined || value.country !== undefined), request.body);
    return { user: await auth.updateProfile({ collections: app.collections, ownerUserId: getAuth(request).userId, ...body, requestId: request.id }) };
  });

  app.get("/api/v1/wallet", authenticated, async (request) => ({ wallet: await wallets.getWallet({ collections: app.collections, ownerUserId: getAuth(request).userId }) }));

  app.post("/api/v1/transfers", { ...authenticated, config: { rateLimit: { max: 30, timeWindow: 60_000 } }, schema: { headers: { type: "object", properties: { "idempotency-key": { type: "string", minLength: 8, maxLength: 128 } } }, body: { type: "object", required: ["recipientAddress", "amount"], additionalProperties: false, properties: { recipientAddress: { type: "string", minLength: 1, maxLength: 128 }, amount: { type: "string", minLength: 1, maxLength: 32 }, note: { type: "string", maxLength: MAX_NOTE_LENGTH }, transferPassword: { type: "string", minLength: 1, maxLength: 128 } } } } }, async (request, reply) => {
    const current = getAuth(request);
    const body = parseBody(transferSchema.extend({ transferPassword: z.string().max(128).optional() }).strict(), request.body);
    const result = await transfers.createTransfer({ collections: app.collections, mongoClient: app.mongoClient, ownerUserId: current.userId, ...body, idempotencyKey: Array.isArray(request.headers["idempotency-key"]) ? request.headers["idempotency-key"][0] : request.headers["idempotency-key"], transferPassword: body.transferPassword, requestId: request.id });
    return reply.code(result.replayed ? 200 : 201).send({ transaction: result, transfer: result });
  });

  app.get("/api/v1/transfers/:id", authenticated, async (request) => {
    const params = parseBody(z.object({ id: publicIdSchema }).strict(), request.params);
    return { transfer: await transfers.getTransaction({ collections: app.collections, ownerUserId: getAuth(request).userId, transactionId: params.id }) };
  });

  app.get("/api/v1/transactions", authenticated, async (request) => {
    const query = parseBody(z.object({ cursor: z.string().uuid().optional(), limit: pageLimitSchema, direction: z.enum(["sent", "received", "all"]).optional() }).strict(), request.query);
    return transfers.listTransactions({ collections: app.collections, ownerUserId: getAuth(request).userId, cursor: query.cursor, limit: query.limit, direction: query.direction });
  });

  app.get("/api/v1/transactions/:id", authenticated, async (request) => {
    const params = parseBody(z.object({ id: publicIdSchema }).strict(), request.params);
    return { transaction: await transfers.getTransaction({ collections: app.collections, ownerUserId: getAuth(request).userId, transactionId: params.id }) };
  });

  app.get("/api/v1/security", authenticated, async (request) => security.getSecurityOverview({ collections: app.collections, config: app.config, ownerUserId: getAuth(request).userId }));

  // Enrolment is started from the authenticated session alone; the setup only counts once the new
  // authenticator confirms it with a code (see /2fa/confirm), so no password is collected here.
  app.post("/api/v1/security/2fa/enable", { ...authenticated, config: { rateLimit: { max: 5, timeWindow: 60_000 } } }, async (request) => security.beginTwoFactorSetup({ collections: app.collections, config: app.config, ownerUserId: getAuth(request).userId }));
  app.post("/api/v1/security/2fa/confirm", authenticated, async (request) => {
    const body = parseBody(z.object({ code: totpCodeSchema }).strict(), request.body);
    return security.confirmTwoFactorSetup({ collections: app.collections, config: app.config, ownerUserId: getAuth(request).userId, ...body, requestId: request.id });
  });
  // Both take one authenticator or recovery code and no password: the code is the proof that the
  // person asking to weaken the account still holds the second factor.
  app.post("/api/v1/security/2fa/disable", authenticated, async (request) => {
    const body = parseBody(z.object({ code: z.string().min(6).max(64) }).strict(), request.body);
    return security.disableTwoFactor({ collections: app.collections, config: app.config, ownerUserId: getAuth(request).userId, ...body, requestId: request.id });
  });
  app.post("/api/v1/security/2fa/recovery-codes", authenticated, async (request) => {
    const body = parseBody(z.object({ code: z.string().min(6).max(64) }).strict(), request.body);
    return security.regenerateRecoveryCodes({ collections: app.collections, config: app.config, ownerUserId: getAuth(request).userId, ...body, requestId: request.id });
  });
  app.post("/api/v1/security/freeze", authenticated, async (request) => wallets.setWalletFrozen({ collections: app.collections, ownerUserId: getAuth(request).userId, frozen: true, requestId: request.id }));
  app.post("/api/v1/security/unfreeze", authenticated, async (request) => {
    const body = parseBody(z.object({ password: loginPasswordSchema, code: z.string().min(6).max(64).optional() }).strict(), request.body);
    const current = getAuth(request);
    await security.verifySensitiveAction({ collections: app.collections, config: app.config, ownerUserId: current.userId, password: body.password, code: body.code, requestId: request.id, action: "wallet_unfreeze_authorized" });
    return wallets.setWalletFrozen({ collections: app.collections, ownerUserId: current.userId, frozen: false, requestId: request.id });
  });
  app.post("/api/v1/security/transfer-password", authenticated, async (request) => {
    const body = parseBody(z.object({ currentPassword: z.string().max(128).optional(), newPassword: passwordSchema }).strict(), request.body);
    return security.setTransferPassword({ collections: app.collections, ownerUserId: getAuth(request).userId, currentPassword: body.currentPassword, newPassword: body.newPassword, requestId: request.id });
  });

  app.get("/api/v1/sessions", authenticated, async (request) => ({ sessions: await auth.listSessions({ collections: app.collections, ownerUserId: getAuth(request).userId, currentSessionId: getAuth(request).sessionId }) }));
  app.delete("/api/v1/sessions/:id", authenticated, async (request, reply) => {
    const params = parseBody(z.object({ id: publicIdSchema }).strict(), request.params);
    const current = getAuth(request);
    await auth.revokeSession({ collections: app.collections, ownerUserId: current.userId, sessionId: params.id, currentSessionId: current.sessionId, requestId: request.id });
    return reply.code(204).send();
  });

  app.patch("/api/v1/wallet/custom-address", authenticated, async (request) => {
    const body = parseBody(z.object({ address: z.string().min(4).max(25) }).strict(), request.body);
    return { wallet: await wallets.setCustomAddress({ collections: app.collections, ownerUserId: getAuth(request).userId, handle: body.address, requestId: request.id }) };
  });

  app.get("/api/v1/notifications", authenticated, async (request) => {
    const query = parseBody(z.object({ cursor: z.string().max(32).optional(), limit: pageLimitSchema }).strict(), request.query);
    return security.listNotifications({ collections: app.collections, ownerUserId: getAuth(request).userId, cursor: query.cursor, limit: query.limit ?? 20 });
  });

  // An empty body marks every unread notification, which is what the bell does when it is opened.
  app.post("/api/v1/notifications/read", authenticated, async (request) => {
    const body = parseBody(z.object({ ids: z.array(z.string().regex(/^[0-9a-f]{24}$/i)).min(1).max(50).optional() }).strict(), request.body ?? {});
    return security.markNotificationsRead({ collections: app.collections, ownerUserId: getAuth(request).userId, ids: body.ids });
  });

  app.post("/api/v1/auth/password", { ...authenticated, config: { rateLimit: { max: 5, timeWindow: 60_000 } }, schema: { body: { type: "object", required: ["currentPassword", "newPassword"], additionalProperties: false, properties: { currentPassword: { type: "string", minLength: 1, maxLength: 128 }, newPassword: { type: "string", minLength: 8, maxLength: 128 } } } } }, async (request) => {
    const body = parseBody(z.object({ currentPassword: loginPasswordSchema, newPassword: passwordSchema }).strict(), request.body);
    const current = getAuth(request);
    const user = await app.collections.users.findOne({ publicId: current.userId });
    if (!user || !(await (await import("argon2")).verify(user.passwordHash, body.currentPassword).catch(() => false))) throw forbidden("invalid_credentials", "The current password is incorrect.");
    const updated = await app.collections.users.updateOne({ _id: user._id, passwordHash: user.passwordHash }, { $set: { passwordHash: await (await import("argon2")).hash(body.newPassword, { type: (await import("argon2")).argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 }), updatedAt: new Date() } });
    if (updated.modifiedCount !== 1) throw badRequest("password_change_conflict", "The password changed. Sign in again and retry.");
    // Every other session goes, a half-finished two-factor challenge included: that challenge was
    // started with the old password, and completing it afterwards would hand back a session the
    // password change was meant to end.
    await app.collections.sessions.updateMany({ ownerUserId: current.userId, status: { $in: ["active", "pending_two_factor"] }, publicId: { $ne: current.sessionId } }, { $set: { status: "revoked", refreshTokenHash: null, previousRefreshTokenHash: null, revokedAt: new Date() } });
    await recordSecurityEvent({ collections: app.collections, ownerUserId: current.userId, sessionId: current.sessionId, eventType: "password_changed", outcome: "success", correlationId: request.id });
    return { changed: true };
  });
}
