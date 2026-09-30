import type { FastifyInstance, FastifyReply, FastifyRequest, RouteShorthandOptions } from "fastify";
import type { ServerResponse } from "node:http";
import { z } from "zod";
import type { AuthContext } from "../../app.js";
import * as auth from "../auth/service.js";
import * as security from "../security/service.js";
import * as wallets from "../wallets/service.js";
import * as transfers from "../transfers/service.js";
import * as mining from "../mining/service.js";
import * as deviceGuard from "../mining-device/service.js";
import {
  ensureNotificationWatcher,
  NOTIFICATION_HEARTBEAT_FRAME,
  NOTIFICATIONS_CHANGED_FRAME,
  notificationWatcherUnavailable,
  registerNotificationSubscriber,
  STREAM_HEARTBEAT_INTERVAL_MS,
  STREAM_MAX_LIFETIME_MS,
  STREAM_RETRY_MS,
} from "../security/notification-stream.js";
import {
  assertCsrfToken,
  CSRF_COOKIE,
  CSRF_HEADER,
  preauthCsrfToken,
  sessionCsrfToken,
} from "../security/csrf.js";
import { AppError, badRequest, forbidden, serviceUnavailable, unauthorized } from "../../shared/errors.js";
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

/**
 * Hands the page the token it has to echo on every request it makes before a session exists.
 *
 * This cookie is readable by design, and it is not a credential: after a reload the page has no
 * memory of any token, and it needs one for the refresh request that rebuilds its session. The value
 * is only ever accepted alongside the request that carries it, and it is keyed by the server, so a
 * value planted by a sibling origin is worth nothing.
 */
function setCsrfCookie(app: FastifyInstance, reply: FastifyReply, token: string) {
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

function getAuth(request: FastifyRequest): AuthContext {
  if (!request.auth) throw unauthorized();
  return request.auth;
}

async function requireAuth(request: FastifyRequest) {
  await request.server.authenticate(request);
}

/**
 * Writes one Server-Sent Events frame, coalescing while the socket is behind.
 *
 * Every notification frame carries the same meaning — "your notifications page changed" — so a
 * client that cannot keep up does not need the backlog: while a write is still draining, further
 * frames are dropped rather than queued. That is this endpoint's backpressure story, and it is why
 * a slow reader costs a bounded amount of memory instead of an unbounded buffer.
 *
 * Dropping the frames themselves is safe; forgetting that one arrived is not. A dropped change hint
 * would leave that reader with no reason to re-read its page until the next reconnect, so one is
 * remembered and written as soon as the socket drains. Heartbeats are not remembered: they carry no
 * information, and a buffer that filled up will carry the next one anyway.
 */
function createNotificationStreamWriter(raw: ServerResponse) {
  let draining = false;
  let closed = false;
  let changePending = false;

  const write = (frame: string): void => {
    if (closed) return;
    if (raw.write(frame) === false) {
      draining = true;
      raw.once("drain", () => {
        draining = false;
        if (!changePending) return;
        changePending = false;
        write(NOTIFICATIONS_CHANGED_FRAME);
      });
    }
  };

  return {
    send: (frame: string) => {
      if (closed) return;
      if (draining) {
        if (frame === NOTIFICATIONS_CHANGED_FRAME) changePending = true;
        return;
      }
      write(frame);
    },
    end: () => {
      if (closed) return;
      closed = true;
      changePending = false;
      raw.end();
    },
  };
}

const authenticated = { preHandler: requireAuth } satisfies RouteShorthandOptions;

/**
 * Guards the endpoints that start or rotate a session with the pre-session CSRF token.
 *
 * These are the requests a browser can make with nothing but a cookie — registering, signing in,
 * completing a second factor, refreshing — which is precisely the shape CSRF exploits: another site
 * can post to them without ever being able to read the answer or the token this API hands out.
 */
const csrfProtected = (app: FastifyInstance) => ({
  preHandler: async (request: FastifyRequest) => {
    assertCsrfToken({
      config: app.config,
      expected: preauthCsrfToken(app.config),
      provided: request.headers[CSRF_HEADER],
    });
  },
});

export async function registerCustomerRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Issues the token the page needs before it can make its first state-changing request.
   *
   * The token is derived from the server's own key, so this endpoint hands out no secret a forged
   * request could reuse: it exists so a browser that has just loaded the app — and therefore holds
   * no token yet — can obtain one without the page having to invent it.
   */
  app.get("/api/v1/auth/csrf", { config: { rateLimit: { max: 60, timeWindow: 60_000 } } }, async (_request, reply) => {
    const token = preauthCsrfToken(app.config);
    setCsrfCookie(app, reply, token);
    return { csrfToken: token };
  });

  app.post("/api/v1/auth/register", { ...csrfProtected(app), config: { rateLimit: { max: 5, timeWindow: 60_000 } }, schema: authBody(registerSchema) }, async (request, reply) => {
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
    return reply.code(201).send({ user: session.user, wallet: session.wallet, accessToken: session.accessToken, accessTokenTtlSeconds: session.accessTokenTtlSeconds, sessionId: session.sessionId, csrfToken: sessionCsrfToken(app.config, session.sessionId) });
  });

  app.post("/api/v1/auth/login", { ...csrfProtected(app), config: { rateLimit: { max: 5, timeWindow: 60_000 } }, schema: authBody(loginSchema) }, async (request, reply) => {
    const body = parseBody(loginSchema, request.body);
    const session = await auth.login({ collections: app.collections, config: app.config, ...body, requestId: request.id, userAgent: request.headers["user-agent"] });
    setAuthResponseCookie(app, reply, session.refreshToken);
    return { user: session.user, accessToken: session.accessToken, accessTokenTtlSeconds: session.accessTokenTtlSeconds, sessionId: session.sessionId, csrfToken: sessionCsrfToken(app.config, session.sessionId), requiresTwoFactor: session.accessToken === null };
  });

  app.post("/api/v1/auth/2fa/verify", { ...csrfProtected(app), config: { rateLimit: { max: 8, timeWindow: 60_000 } }, schema: { body: { type: "object", required: ["sessionId", "code"], additionalProperties: false, properties: { sessionId: { type: "string", format: "uuid" }, code: { type: "string", minLength: 6, maxLength: 64 } } } } }, async (request, reply) => {
    const body = parseBody(z.object({ sessionId: publicIdSchema, code: z.string().min(6).max(64) }).strict(), request.body);
    const refreshToken = request.cookies["louma_refresh"];
    if (!refreshToken)    throw unauthorized();
    const session = await auth.completeTwoFactor({ collections: app.collections, mongoClient: app.mongoClient, config: app.config, ...body, refreshToken, requestId: request.id });
    setAuthResponseCookie(app, reply, session.refreshToken);
    return { user: session.user, accessToken: session.accessToken, accessTokenTtlSeconds: session.accessTokenTtlSeconds, sessionId: session.sessionId, csrfToken: sessionCsrfToken(app.config, session.sessionId), requiresTwoFactor: false };
  });

  app.post("/api/v1/auth/refresh", { ...csrfProtected(app), config: { rateLimit: { max: 20, timeWindow: 60_000 } } }, async (request, reply) => {
    const refreshToken = request.cookies["louma_refresh"];
    if (!refreshToken) throw unauthorized();
    const session = await auth.refreshSession({ collections: app.collections, config: app.config, refreshToken, requestId: request.id });
    setAuthResponseCookie(app, reply, session.refreshToken);
    return { user: session.user, accessToken: session.accessToken, accessTokenTtlSeconds: session.accessTokenTtlSeconds, sessionId: session.sessionId, csrfToken: sessionCsrfToken(app.config, session.sessionId) };
  });

  app.post("/api/v1/auth/logout", authenticated, async (request, reply) => {
    const current = getAuth(request);
    await auth.revokeCurrentSession({ collections: app.collections, ownerUserId: current.userId, sessionId: current.sessionId, requestId: request.id });
    clearRefreshCookie(app, reply);
    return reply.code(204).send();
  });

  app.post("/api/v1/auth/forgot-password", { ...csrfProtected(app), config: { rateLimit: { max: 5, timeWindow: 60_000 } }, schema: { body: { type: "object", required: ["email"], additionalProperties: false, properties: { email: { type: "string", maxLength: 254, format: "email" } } } } }, async (_request, _reply) => {
    throw serviceUnavailable("password_reset_unavailable", "Password reset is unavailable until a verified email delivery provider is configured.");
  });

  app.post("/api/v1/auth/reset-password", { ...csrfProtected(app), config: { rateLimit: { max: 5, timeWindow: 60_000 } }, schema: { body: { type: "object", additionalProperties: false } } }, async () => {
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
    const result = await transfers.createTransfer({ collections: app.collections, mongoClient: app.mongoClient, config: app.config, ownerUserId: current.userId, ...body, idempotencyKey: Array.isArray(request.headers["idempotency-key"]) ? request.headers["idempotency-key"][0] : request.headers["idempotency-key"], transferPassword: body.transferPassword, requestId: request.id });
    return reply.code(result.replayed ? 200 : 201).send({ transaction: result, transfer: result });
  });

  /**
   * Mining is a persisted cycle plus a clock, so these endpoints read and settle state; they never
   * accept a rate, a window, or an elapsed time from the caller. `start` and `settle` are the only
   * writes, and both are safe to repeat: `start` while a cycle runs is refused, and a settle with
   * nothing new to post writes nothing.
   */
  app.get("/api/v1/mining/state", { ...authenticated, config: { rateLimit: { max: 240, timeWindow: 60_000 } } }, async (request) =>
    mining.getMiningState({ collections: app.collections, config: app.config, ownerUserId: getAuth(request).userId }),
  );

  app.post("/api/v1/mining/start", { ...authenticated, config: { rateLimit: { max: 10, timeWindow: 60_000 } }, schema: authBody(z.object({ device: z.unknown().optional() }).loose()) }, async (request) => {
    // Device evidence is optional: old clients and existing tests keep working, and the
    // per-account unique index still applies. When present it is sanitized server-side and
    // enforced through the LMDG lease — the server stays authoritative, never the client.
    const body = (request.body ?? {}) as { device?: unknown };
    const current = getAuth(request);
    return mining.startMining({
      collections: app.collections,
      mongoClient: app.mongoClient,
      config: app.config,
      ownerUserId: current.userId,
      correlationId: request.id,
      ...(body.device === undefined ? {} : { device: { evidenceRaw: body.device, ip: request.ip.slice(0, 45) } }),
    });
  });

  /**
   * LMDG device endpoints. None of them exposes another account, an IP, a fingerprint, or a risk
   * score — only this account's own lease state and its own challenge nonces.
   */
  app.post("/api/v1/mining/device/challenge", { ...authenticated, config: { rateLimit: { max: 20, timeWindow: 3_600_000 } } }, async (request) => {
    const current = getAuth(request);
    const body = parseBody(
      z.object({ deviceKeyHash: z.string().max(128).optional(), device: z.unknown().optional() }).strict(),
      request.body ?? {},
    );
    // The origin header is the value the browser itself attached to this request: binding the
    // challenge to it is what stops a proof minted on (or claimed for) another origin.
    const originHeader = request.headers["origin"];
    const origin = Array.isArray(originHeader) ? originHeader[0] : originHeader;
    // The device binding is resolved server-side from the evidence — never taken from the body. The
    // challenge payload commits to the server-owned identity the evidence describes, so a proof
    // minted for one enrollment cannot be spent on another.
    const binding = body.device === undefined
      ? null
      : await deviceGuard.resolveDeviceBinding({ collections: app.collections, config: app.config, evidenceRaw: body.device });
    return deviceGuard.issueChallenge({
      collections: app.collections,
      config: app.config,
      ownerUserId: current.userId,
      deviceKeyHash: body.deviceKeyHash ?? null,
      binding,
      origin: origin ?? null,
      correlationId: request.id,
    });
  });

  app.post("/api/v1/mining/device/prove", { ...authenticated, config: { rateLimit: { max: 30, timeWindow: 3_600_000 } } }, async (request) => {
    const current = getAuth(request);
    const body = parseBody(
      z.object({
        nonce: z.string().min(16).max(128),
        signature: z.string().min(16).max(2048),
        publicKeyJwk: z.record(z.string(), z.unknown()),
        device: z.unknown().optional(),
      }).strict(),
      request.body,
    );
    // The proof binds the origin the request actually arrived on: a signed payload replayed from a
    // different origin (or a forged signature claiming another) fails the canonical comparison.
    const originHeader = request.headers["origin"];
    const origin = Array.isArray(originHeader) ? originHeader[0] : originHeader;
    // Recomputed here, independently of the challenge request: the proof is only valid for the same
    // server-resolved enrollment the handshake was issued for.
    const binding = body.device === undefined
      ? null
      : await deviceGuard.resolveDeviceBinding({ collections: app.collections, config: app.config, evidenceRaw: body.device });
    return deviceGuard.verifyProof({
      collections: app.collections,
      config: app.config,
      ownerUserId: current.userId,
      nonce: body.nonce,
      signature: body.signature,
      publicKeyJwk: body.publicKeyJwk,
      binding,
      origin: origin ?? null,
      correlationId: request.id,
    });
  });

  app.get("/api/v1/mining/device/status", authenticated, async (request) =>
    deviceGuard.getDeviceStatus({ collections: app.collections, ownerUserId: getAuth(request).userId }),
  );

  app.post("/api/v1/mining/settle", { ...authenticated, config: { rateLimit: { max: 30, timeWindow: 60_000 } } }, async (request) =>
    mining.settleMining({ collections: app.collections, mongoClient: app.mongoClient, config: app.config, ownerUserId: getAuth(request).userId, correlationId: request.id }),
  );

  app.get("/api/v1/mining/history", authenticated, async (request) => {
    const query = parseBody(z.object({ cursor: z.string().uuid().optional(), limit: pageLimitSchema }).strict(), request.query);
    return mining.listMiningHistory({ collections: app.collections, config: app.config, ownerUserId: getAuth(request).userId, cursor: query.cursor, limit: query.limit });
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

  // Every second-factor change asks for the account password as well as the proof that change needs.
  // A session alone must not be able to bind an authenticator (a stolen one could add a factor the
  // owner does not hold), and a code alone must not be able to weaken the factor it proves.
  app.post("/api/v1/security/2fa/enable", { ...authenticated, config: { rateLimit: { max: 5, timeWindow: 60_000 } } }, async (request) => {
    const body = parseBody(z.object({ password: loginPasswordSchema }).strict(), request.body);
    return security.beginTwoFactorSetup({ collections: app.collections, config: app.config, ownerUserId: getAuth(request).userId, ...body });
  });
  app.post("/api/v1/security/2fa/confirm", authenticated, async (request) => {
    const body = parseBody(z.object({ code: totpCodeSchema }).strict(), request.body);
    return security.confirmTwoFactorSetup({ collections: app.collections, config: app.config, ownerUserId: getAuth(request).userId, ...body, requestId: request.id });
  });
  app.post("/api/v1/security/2fa/disable", authenticated, async (request) => {
    const body = parseBody(z.object({ password: loginPasswordSchema, code: z.string().min(6).max(64) }).strict(), request.body);
    return security.disableTwoFactor({ collections: app.collections, config: app.config, ownerUserId: getAuth(request).userId, ...body, requestId: request.id });
  });
  app.post("/api/v1/security/2fa/recovery-codes", authenticated, async (request) => {
    const body = parseBody(z.object({ password: loginPasswordSchema, code: z.string().min(6).max(64) }).strict(), request.body);
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
    return security.setTransferPassword({ collections: app.collections, mongoClient: app.mongoClient, ownerUserId: getAuth(request).userId, currentPassword: body.currentPassword, newPassword: body.newPassword, requestId: request.id });
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

  /**
   * The realtime notification channel: Server-Sent Events, one connection per open tab.
   *
   * The frames are only a signal, never data — a change makes the client re-read
   * `GET /api/v1/notifications`, so this endpoint needs no read path of its own and no projection
   * that could drift from the page the bell renders.
   *
   * The connection is authorized once, at open. It is deliberately short-lived for that reason (see
   * STREAM_MAX_LIFETIME_MS): the client reconnects with a token that has to still be valid, so a
   * revoked session stops receiving hints within one rotation instead of holding a stream open until
   * the tab is closed.
   */
  app.get("/api/v1/notifications/stream", authenticated, async (request, reply) => {
    const current = getAuth(request);

    // A stream that could never speak would strand the client on a connection it believes in, so a
    // change stream that cannot be established is refused instead: the client then refreshes on its
    // own slower cadence until the API can serve realtime again.
    //
    // This runs before the connection is registered, because a watcher that cannot start ends every
    // stream that is already open: a writer this route has not committed to yet must not be one of
    // them, or its response would be closed before the SSE headers were written and the client would
    // get a broken 200 instead of the 503 it falls back on.
    ensureNotificationWatcher({ collections: app.collections, log: request.log });
    if (notificationWatcherUnavailable()) {
      throw serviceUnavailable("realtime_unavailable", "Realtime notifications are temporarily unavailable.");
    }

    const writer = createNotificationStreamWriter(reply.raw);
    // Registered before the hijack so the caps can still be answered with the API's error envelope.
    const registered = registerNotificationSubscriber({ ownerUserId: current.userId, subscriber: writer });
    if ("rejection" in registered) {
      if (registered.rejection === "per_account_limit") {
        throw new AppError(429, "stream_limit", "Too many notification streams are already open for this account. Close a Louma tab and try again.");
      }
      throw serviceUnavailable("stream_capacity", "Realtime notifications are at capacity. Try again shortly.");
    }

    reply.hijack();
    const raw = reply.raw;
    // The reply is hijacked, so the headers the global hooks set never reach the client and the CORS
    // plugin never runs: both are repeated here. The origin is echoed only when it is one this API
    // already trusts, because credentials travel on this request.
    const origin = request.headers.origin;
    raw.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store, no-transform",
      connection: "keep-alive",
      "x-request-id": request.id,
      // Tells a buffering reverse proxy to pass frames through instead of holding them.
      "x-accel-buffering": "no",
      ...(origin && app.config.frontendOrigins.includes(origin)
        ? { "access-control-allow-origin": origin, "access-control-allow-credentials": "true", vary: "Origin" }
        : {}),
    });
    writer.send(`retry: ${STREAM_RETRY_MS}\n\n`);

    const heartbeat = setInterval(
      () => writer.send(NOTIFICATION_HEARTBEAT_FRAME),
      STREAM_HEARTBEAT_INTERVAL_MS,
    );
    const rotation = setTimeout(() => writer.end(), STREAM_MAX_LIFETIME_MS);
    // Neither timer may keep the process alive on its own.
    heartbeat.unref();
    rotation.unref();

    const openedAt = Date.now();
    raw.on("close", () => {
      clearInterval(heartbeat);
      clearTimeout(rotation);
      registered.unsubscribe();
      request.log.debug({ userId: current.userId, durationMs: Date.now() - openedAt }, "notification_stream_closed");
    });
    // A hijacked socket reports write failures here; without a listener an unhandled 'error' event
    // would take the process down.
    raw.on("error", () => raw.destroy());

    request.log.debug({ userId: current.userId }, "notification_stream_opened");
    return undefined;
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
