import Fastify, {
  LogController,
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import { randomUUID } from "node:crypto";
import type { AppConfig } from "./config/env.js";
import type { Collections } from "./infrastructure/mongodb/collections.js";
import type { MongoClient } from "mongodb";
import type { RedisHandle } from "./infrastructure/redis/client.js";
import type { CacheContext } from "./infrastructure/redis/cache.js";
import { checkRateLimit } from "./infrastructure/redis/rate-limit.js";
import { AppError } from "./shared/errors.js";
import { registerCustomerRoutes } from "./modules/http/routes.js";
import { stopNotificationStream } from "./modules/security/notification-stream.js";
import { assertCsrfToken, CSRF_HEADER, isStateChangingMethod, sessionCsrfToken } from "./modules/security/csrf.js";
import { authenticateUser } from "./modules/auth/service.js";
import { createPrettyLogStream } from "./config/logger.js";

export interface AuthContext {
  userId: string;
  sessionId: string;
}

declare module "fastify" {
  interface FastifyRequest {
    auth: AuthContext | null;
  }
  interface FastifyReply {
    /** Rejection code for this response, so the single request log line can explain a 4xx/5xx. */
    errorCode?: string;
  }
  interface FastifyInstance {
    config: AppConfig;
    collections: Collections;
    mongoClient: MongoClient;
    /** Ephemeral infrastructure (cache/rate-limit/locks). Disabled handle when REDIS_URL is unset. */
    redis: RedisHandle;
    authenticate: (request: FastifyRequest) => Promise<AuthContext>;
  }
}

export interface BuildAppOptions {
  config: AppConfig;
  collections: Collections;
  mongoClient: MongoClient;
  redis: RedisHandle;
  logger?: boolean;
}

/** Cache contexts the routes hand to services. Undefined when Redis is disabled: services then read MongoDB directly. */
export function settingsCache(app: FastifyInstance): CacheContext | undefined {
  if (!app.redis.enabled) return undefined;
  return { redis: app.redis, ttlSeconds: app.config.redis.miningSettingsCacheTtlSeconds };
}

export function membershipCache(app: FastifyInstance): CacheContext | undefined {
  if (!app.redis.enabled) return undefined;
  return { redis: app.redis, ttlSeconds: app.config.redis.poolMembershipCacheTtlSeconds };
}

export function displayNameCache(app: FastifyInstance): CacheContext | undefined {
  if (!app.redis.enabled) return undefined;
  return { redis: app.redis, ttlSeconds: app.config.redis.displayNameCacheTtlSeconds };
}

/**
 * Distributed per-identity throttle for sensitive endpoints, layered over the global in-process
 * limiter. Answers 429 when the window is exhausted; fail-open when Redis is degraded (the
 * decision is `allowed` and the request proceeds), so a Redis outage never blocks legitimate
 * traffic. Returns true when the request may proceed.
 */
export async function enforceRateLimit(input: {
  app: FastifyInstance;
  reply: FastifyReply;
  scope: string;
  identity: string;
  limit: number;
  windowMs?: number;
  requestId: string;
}): Promise<boolean> {
  // Pure fail-open without Redis: a per-process local limiter cannot see the other processes'
  // traffic, so enforcing a cap here would throttle legitimate bursts (e.g. 24 concurrent
  // transfers) based on a partial count. The global in-process limiter still applies.
  if (!input.app.redis.enabled) return true;
  const decision = await checkRateLimit(input.app.redis, input.scope, input.identity, input.limit, input.windowMs ?? 60_000);
  if (decision.allowed) return true;
  input.app.log.warn({ scope: input.scope, requestId: input.requestId, retryAfterMs: decision.retryAfterMs }, "rate_limit_exceeded");
  await input.reply.code(429).send({
    error: { code: "rate_limited", message: "Too many requests. Try again later." },
    requestId: input.requestId,
  });
  return false;
}

/**
 * Status code of a rejection Fastify raised itself, when it is a client error.
 *
 * Fastify's own failures are Errors carrying `statusCode` — an unparseable JSON body and a payload
 * that failed the route schema are both 400. `@fastify/rate-limit` instead throws whatever
 * `errorResponseBuilder` returned, which is a plain object rather than an Error, so the property is
 * read defensively instead of through `instanceof`. A 5xx is never a client error and returns null.
 */
function clientErrorStatus(error: unknown): number | null {
  if (error === null || typeof error !== "object") return null;
  const statusCode = (error as { statusCode?: unknown }).statusCode;
  if (typeof statusCode !== "number" || !Number.isInteger(statusCode)) return null;
  return statusCode >= 400 && statusCode < 500 ? statusCode : null;
}

export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: options.logger === false ? false : {
      level: options.config.logLevel,
      redact: {
        // `transferPassword` travels with every transfer body: it is a spend credential and must
        // never survive into a request log line.
        paths: ["req.headers.authorization", "req.headers.cookie", "req.headers['set-cookie']", "req.headers['x-louma-signature']", "req.body.password", "req.body.currentPassword", "req.body.newPassword", "req.body.code", "req.body.twoFactorCode", "req.body.refreshToken", "req.body.transferPassword"],
        censor: "[Redacted]",
      },
      // Production keeps pino's JSON lines for the log collector; everywhere else a terminal gets
      // the readable rendering instead. See config/logger.ts.
      ...(options.config.environment === "production" ? {} : { stream: createPrettyLogStream() }),
    },
    // Replaces Fastify's built-in "incoming request" + "request completed" pair with the single
    // record logged from onResponse below, so one request produces exactly one line.
    logController: new LogController({ disableRequestLogging: true }),
    genReqId: () => randomUUID(),
    bodyLimit: 32 * 1024,
    requestTimeout: 30_000,
    // Off by default, and never "trust everything" when on: a client can prepend an address to
    // X-Forwarded-For, so only the configured proxies' headers may be believed (see TRUST_PROXY in
    // config/env.ts). Registration records and the rate limiter both read the resolved address.
    trustProxy: options.config.trustProxy,
  });

  app.decorate("config", options.config);
  app.decorate("collections", options.collections);
  app.decorate("mongoClient", options.mongoClient);
  app.decorate("redis", options.redis);
  app.decorateRequest("auth", null);
  app.decorate("authenticate", async (request: FastifyRequest) => {
    const authenticated = await authenticateUser({
      collections: app.collections,
      config: app.config,
      authorization: request.headers.authorization,
    });
    request.auth = authenticated;
    /**
     * Every state-changing request this session makes has to carry the token derived for that
     * session, so a request replayed by another site is refused even when the browser still holds a
     * usable cookie. It is checked here, where every authenticated route already passes, rather than
     * per route: a route added later is covered by having a session at all. Reads are exempt — they
     * change nothing and their answer is not readable by another origin. See modules/security/csrf.
     */
    if (isStateChangingMethod(request.method)) {
      assertCsrfToken({
        config: app.config,
        expected: sessionCsrfToken(app.config, authenticated.sessionId),
        provided: request.headers[CSRF_HEADER],
      });
    }
    return authenticated;
  });

  await app.register(helmet, { global: true, contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"], baseUri: ["'none'"], formAction: ["'self'"] } } });
  await app.register(cors, {
    origin: options.config.frontendOrigins,
    credentials: true,
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    // X-CSRF-Token must be listed: every state-changing request sends it (see
    // modules/security/csrf.ts), and a cross-origin page's preflight is refused
    // before the token check runs when the header is not allowlisted.
    allowedHeaders: ["Content-Type", "Authorization", "Idempotency-Key", "X-CSRF-Token"],
    exposedHeaders: ["x-request-id"],
    strictPreflight: true,
  });
  await app.register(cookie);
  await app.register(rateLimit, {
    global: true,
    max: options.config.rateLimitMax,
    timeWindow: options.config.rateLimitWindowMs,
    // The returned value is thrown as-is and handed to the error handler below, so it has to carry
    // the status code — without it a throttled client was answered with a 500 instead of a 429.
    errorResponseBuilder: () => ({ statusCode: 429, error: { code: "rate_limited", message: "Too many requests. Try again later." } }),
  });

  app.addHook("onRequest", async (request, reply) => {
    reply.header("x-request-id", request.id);
    reply.header("Cache-Control", "no-store");
  });

  // The single log line every request produces. `logController` above turns Fastify's built-in
  // "incoming request" + "request completed" pair off, so method, path, status and duration are
  // recorded here instead — once per request rather than twice, and always on completion.
  // A 5xx is logged at error level so it survives a raised log level; the error handler logs the
  // stack separately.
  app.addHook("onResponse", async (request, reply) => {
    const record = {
      req: request,
      res: reply,
      responseTime: reply.elapsedTime,
      ...(reply.errorCode === undefined ? {} : { errorCode: reply.errorCode }),
    };
    if (reply.statusCode >= 500) request.log.error(record, "request completed");
    else request.log.info(record, "request completed");
  });

  app.setErrorHandler((error, request, reply) => {
    // Every rejection leaves through here, so the response envelope, the status code, and the code
    // printed on the request log line can never drift apart.
    const reject = (statusCode: number, code: string, message: string) => {
      reply.errorCode = code;
      return reply.code(statusCode).send({ error: { code, message }, requestId: request.id });
    };

    if (error instanceof AppError) return reject(error.statusCode, error.code, error.message);

    const statusCode = clientErrorStatus(error);
    if (statusCode === 429) return reject(429, "rate_limited", "Too many requests. Try again later.");
    if (statusCode !== null) return reject(statusCode, "invalid_request", "The request data is invalid.");

    request.log.error({ err: error, requestId: request.id }, "request_failed");
    return reject(500, "internal_error", "The request could not be completed.");
  });

  /**
   * Realtime notification streams outlive every request timeout, so a closing server has to end them
   * explicitly. `preClose` is the hook that runs before the server stops accepting connections;
   * `stopNotificationStream` also releases the change-stream cursor it opened.
   */
  app.addHook("preClose", async () => {
    await stopNotificationStream();
  });

  // Liveness: the process is alive. No dependency checks — a load balancer must not drain a
  // process that is running but waiting on a dependency.
  app.get("/health", async () => ({ status: "ok" }));
  /**
   * Readiness: the process can serve traffic safely. MongoDB gates (a process that cannot reach
   * the source of truth must not take traffic); Redis is reported but never gates — financial
   * correctness does not depend on it, and every consumer degrades to MongoDB or local state.
   */
  app.get("/ready", async (_request, reply) => {
    let mongo: { ok: boolean; latencyMs: number | null };
    try {
      const started = Date.now();
      await options.mongoClient.db(options.config.mongoDatabase).command({ ping: 1 });
      mongo = { ok: true, latencyMs: Date.now() - started };
    } catch {
      mongo = { ok: false, latencyMs: null };
    }
    const redis = await options.redis.describe();
    const counters = options.redis.counters;
    const body = {
      status: mongo.ok ? "ready" : "not_ready",
      mongo,
      redis: { ...redis, hits: counters.hits, misses: counters.misses, errors: counters.errors, reconnects: counters.reconnects },
    };
    return reply.code(mongo.ok ? 200 : 503).send(body);
  });
  await registerCustomerRoutes(app);
  return app;
}
