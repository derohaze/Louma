import Fastify, {
  LogController,
  type FastifyInstance,
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
import { AppError } from "./shared/errors.js";
import { registerCustomerRoutes } from "./modules/http/routes.js";
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
    authenticate: (request: FastifyRequest) => Promise<AuthContext>;
  }
}

export interface BuildAppOptions {
  config: AppConfig;
  collections: Collections;
  mongoClient: MongoClient;
  logger?: boolean;
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
        paths: ["req.headers.authorization", "req.headers.cookie", "req.headers['set-cookie']", "req.body.password", "req.body.currentPassword", "req.body.newPassword", "req.body.code", "req.body.refreshToken", "req.body.transferPassword"],
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
    // Off by default: believing X-Forwarded-For without a proxy in front lets a client choose the
    // address the API knows it by (registration records and the rate limiter both read it).
    trustProxy: options.config.trustProxy,
  });

  app.decorate("config", options.config);
  app.decorate("collections", options.collections);
  app.decorate("mongoClient", options.mongoClient);
  app.decorateRequest("auth", null);
  app.decorate("authenticate", async (request: FastifyRequest) => {
    const authenticated = await authenticateUser({
      collections: app.collections,
      config: app.config,
      authorization: request.headers.authorization,
    });
    request.auth = authenticated;
    return authenticated;
  });

  await app.register(helmet, { global: true, contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"], baseUri: ["'none'"], formAction: ["'self'"] } } });
  await app.register(cors, {
    origin: options.config.frontendOrigins,
    credentials: true,
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "Idempotency-Key"],
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

  app.get("/health", async () => ({ status: "ok" }));
  await registerCustomerRoutes(app);
  return app;
}
