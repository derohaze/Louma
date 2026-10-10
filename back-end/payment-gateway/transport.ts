import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { GatewayError, reject } from "./domain/money.js";
import { paymentView, publicView } from "./domain/views.js";
import { approval, approve, payment } from "./infrastructure/checkout.js";
import {
  application,
  authenticate,
  eligible,
  type Principal,
} from "./infrastructure/merchants.js";
import {
  applications,
  decodeLinkInput,
  link,
  recordUsage,
  resourceApplication,
  suspend,
  updateApplication,
  usage,
} from "./infrastructure/resources.js";
import { cancelSubscription } from "./infrastructure/billing.js";
import { confirm } from "./infrastructure/settlement.js";
import { compatible } from "./infrastructure/migrations.js";
import type { GatewayStore } from "./infrastructure/store.js";
import {
  checkout,
  createApplicationRequest,
  keySchema,
  parse,
  resourceRequest,
  UUID,
  uuidSchema,
  validateDomains,
} from "./service.js";
import { hostedCheckout, logo } from "./hosted.js";
export interface Limiter {
  allow(key: string, max: number): Promise<boolean>;
  ready(): Promise<boolean>;
}
export interface InternalRequest {
  ownerUserId: string;
  path: string;
  method: "GET" | "POST" | "PATCH";
  body?: unknown;
}
const alias = (kind: string) =>
  ({
    "payment-links": "links",
    "checkout-sessions": "checkouts",
    "webhook-deliveries": "deliveries",
  })[kind] ?? kind;
const proofSchema = z
  .object({
    kind: z.enum(["none", "password", "totp", "recovery_code"]),
    timeStep: z.number().int().min(0).max(2147483647).default(0),
    passwordChangedAt: z.coerce.date().nullable().default(null),
    twoFactorEnabledAt: z.coerce.date().nullable().default(null),
    credentialId: z.string().max(24).default(""),
    verifiedHashes: z.array(z.string().max(240)).max(16).default([]),
    remainingHashes: z.array(z.string().max(240)).max(16).default([]),
  })
  .strict();
/** Called only after the host authenticates a session and enforces CSRF. No internal HTTP route exists. */
export async function gatewayInternalRequest(
  store: GatewayStore,
  input: InternalRequest,
): Promise<Record<string, unknown>> {
  if (!UUID.test(input.ownerUserId)) reject("invalid_internal_auth", 401);
  const result = await dispatch(store, input);
  return JSON.parse(JSON.stringify(result)) as Record<string, unknown>;
}
async function dispatch(
  store: GatewayStore,
  input: InternalRequest,
): Promise<Record<string, unknown>> {
  const url = new URL(input.path, "http://internal.invalid"),
    owner = input.ownerUserId,
    method = input.method;
  if (!url.pathname.startsWith("/internal/v1/")) reject("not_found", 404);
  const parts = url.pathname.slice("/internal/v1/".length).split("/"),
    kind = parts[0] ?? "",
    id = parts[1] ?? "";
  const body = input.body ?? {};
  if (kind === "checkout" && UUID.test(id)) {
    if (method === "GET" && parts.length === 2) {
      const p = await payment(store, "", id);
      if (p.status === "succeeded" && p.payerUserId !== owner)
        reject("not_found", 404);
      return paymentView(p);
    }
    if (method === "POST" && parts.length === 3 && parts[2] === "confirm") {
      const parsed = parse(
        z
          .object({
            approval_id: z.union([uuidSchema, z.literal("")]),
            intent_hash: z.string().regex(/^[a-f\d]{64}$/),
            idempotency_key: keySchema,
          })
          .strict(),
        body,
      );
      return paymentView(
        await confirm(store, owner, id, parsed.approval_id, parsed.intent_hash),
      );
    }
  }
  if (kind === "approvals" && parts.length === 1) {
    if (method === "GET") {
      const a = await approval(
        store,
        owner,
        parse(uuidSchema, url.searchParams.get("payment_id")),
        parse(keySchema, url.searchParams.get("idempotency_key")),
      );
      return {
        id: a.publicId,
        expires_at: a.expiresAt,
        session_id: a.sessionId,
        owner_user_id: a.ownerUserId,
        wallet_id: a.walletId,
        intent_hash: a.intentHash,
        recurring_consent: a.recurringConsent,
        policy_version: a.policyVersion,
      };
    }
    if (method === "POST") {
      const a = parse(
        z
          .object({
            payment_id: uuidSchema,
            owner_user_id: uuidSchema,
            wallet_id: uuidSchema,
            session_id: uuidSchema,
            intent_hash: z.string().regex(/^[a-f\d]{64}$/),
            idempotency_key: keySchema,
            proof: proofSchema,
            recurring_consent: z.boolean().default(false),
            policy_version: z.string().max(40).default(""),
          })
          .strict(),
        body,
      );
      if (a.owner_user_id !== owner) reject("invalid_approval");
      const result = await approve(store, {
        paymentId: a.payment_id,
        ownerUserId: owner,
        walletId: a.wallet_id,
        sessionId: a.session_id,
        intentHash: a.intent_hash,
        idempotencyKey: a.idempotency_key,
        proof: a.proof,
        recurringConsent: a.recurring_consent,
        policyVersion: a.policy_version,
      });
      return {
        id: result.publicId,
        approval_id: result.publicId,
        expires_at: result.expiresAt,
      };
    }
  }
  if (
    kind === "customer-subscriptions" &&
    parts.length === 3 &&
    parts[2] === "cancel" &&
    method === "POST"
  ) {
    await cancelSubscription(store, {
      applicationId: "",
      ownerUserId: owner,
      id: parse(uuidSchema, id),
      atPeriodEnd: false,
    });
    return { status: "canceled" };
  }
  await eligible(store, owner);
  const envelope = parse(z.record(z.string(), z.unknown()), body);
  const key =
    typeof envelope["idempotency_key"] === "string"
      ? envelope["idempotency_key"]
      : "";
  const payload = { ...envelope };
  delete payload["idempotency_key"];
  if (kind !== "applications" && parts.length === 3 && method === "POST") {
    const app = await resourceApplication(store, owner, alias(kind), id);
    if (app.status !== "active") reject("application_suspended", 403);
    return resourceRequest(
      store,
      { app, credential: { publicId: "" }, internal: true },
      alias(kind),
      id,
      parts[2]!,
      method,
      key,
      "",
      payload,
    );
  }
  if (kind !== "applications") return reject("not_found", 404);
  if (parts.length === 1) {
    if (method === "GET")
      return applications(store, owner, url.searchParams.get("cursor") ?? "");
    if (method === "POST") return createApplicationRequest(store, owner, body);
  }
  const app = await application(store, owner, parse(uuidSchema, id));
  if (parts.length === 2) {
    if (method === "GET") return publicView("Application", app);
    if (method === "PATCH") {
      const changes = parse(
        z
          .object({
            status: z.enum(["disabled", "suspended"]).optional(),
            name: z.string().min(1).max(120).optional(),
            receiving_wallet_id: uuidSchema.optional(),
            domains: z.array(z.string().max(240)).max(16).optional(),
          })
          .strict(),
        body,
      );
      if (changes.status) {
        if (
          changes.name !== undefined ||
          changes.receiving_wallet_id !== undefined ||
          changes.domains !== undefined
        )
          reject("invalid_application");
        await suspend(store, owner, id);
        return publicView("Application", { ...app, status: "suspended" });
      }
      const domains = changes.domains ?? app.domains;
      validateDomains(domains, store.config.environment === "test");
      return publicView(
        "Application",
        await updateApplication(
          store,
          app,
          changes.name ?? app.name,
          changes.receiving_wallet_id ?? app.walletId,
          domains,
        ),
      );
    }
  }
  if (app.status !== "active") reject("application_suspended", 403);
  if (parts.length < 3 || parts.length > 5) reject("not_found", 404);
  const resourceKind = alias(parts[2]!);
  if (resourceKind === "usage") {
    if (method !== "GET" || parts.length !== 3)
      reject("method_not_allowed", 405);
    return usage(store, id);
  }
  return resourceRequest(
    store,
    { app, credential: { publicId: "" }, internal: true },
    resourceKind,
    parts[3] ?? "",
    parts[4] ?? "",
    method,
    key,
    url.searchParams.get("cursor") ?? "",
    payload,
  );
}
export async function registerGatewayRoutes(
  app: FastifyInstance,
  store: GatewayStore,
  limiter: Limiter,
): Promise<void> {
  await app.register(async (scope) => {
    let inflight = 0;
    const admitted = new Set<string>();
    scope.addHook("onRequest", async (request, reply) => {
      if (inflight >= 128) reject("server_busy", 503);
      inflight++;
      admitted.add(request.id);
      reply.header("Referrer-Policy", "no-referrer");
      reply.header(
        "Content-Security-Policy",
        "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; frame-ancestors 'none'; form-action 'self'",
      );
      if (
        ["/healthz", "/readyz", "/assets/louma-logo.png"].includes(
          request.url.split("?")[0] ?? "",
        )
      )
        return;
      if (!(await limiter.allow("ip:" + request.ip, 300))) {
        reply.header("Retry-After", "60");
        reject("rate_limit_exceeded", 429);
      }
    });
    const release = async (request: { id: string }) => {
      if (admitted.delete(request.id)) inflight--;
    };
    scope.addHook("onResponse", release);
    scope.addHook("onRequestAbort", release);
    scope.addHook("onTimeout", release);
    scope.setErrorHandler((error, request, reply) => {
      const known = error instanceof GatewayError;
      const status = known
        ? error.statusCode
        : typeof (
              error as {
                statusCode?: number;
              }
            ).statusCode === "number"
          ? (
              error as {
                statusCode: number;
              }
            ).statusCode
          : 500;
      const code = known
        ? error.code
        : status < 500
          ? "invalid_request"
          : "internal_error";
      if (status >= 500)
        request.log.error(
          { requestId: request.id, code },
          "gateway_request_failed",
        );
      return reply
        .code(status)
        .send({
          error: {
            code,
            message: code.replaceAll("_", " "),
            request_id: request.id,
          },
        });
    });
    scope.get("/healthz", { config: { rateLimit: false } }, async () => ({
      status: "ok",
    }));
    scope.get("/readyz", { config: { rateLimit: false } }, async () => {
      await compatible(store);
      if (!(await limiter.ready())) reject("redis_unavailable", 503);
      return { status: "ready" };
    });
    scope.get("/assets/louma-logo.png", async (_request, reply) =>
      reply.type("image/png").send(logo),
    );
    scope.get<{
      Params: {
        id: string;
      };
      Querystring: {
        lang?: string;
      };
    }>("/checkout/:id", async (request, reply) =>
      reply
        .type("text/html; charset=utf-8")
        .send(
          hostedCheckout(
            await payment(store, "", parse(uuidSchema, request.params.id)),
            store.config,
            request.query.lang === "ar",
          ),
        ),
    );
    scope.get<{
      Params: {
        id: string;
      };
    }>("/pay/:id", async (request, reply) => {
      const target = await link(store, parse(uuidSchema, request.params.id));
      const p = await checkout(
        store,
        { app: target.app, credential: { publicId: "" } },
        decodeLinkInput(
          target.link.input as unknown as Record<string, unknown>,
        ),
        "link:" + request.id,
      );
      return reply.code(303).redirect("/checkout/" + p.publicId);
    });
    scope.route<{
      Params: {
        "*": string;
      };
      Querystring: {
        cursor?: string;
      };
    }>({
      method: ["GET", "POST", "PATCH"],
      url: "/v1/*",
      bodyLimit: 64 * 1024,
      config: { rateLimit: false },
      handler: async (request, reply) => {
        const parts = request.params["*"].split("/");
        if (parts.length > 3) reject("not_found", 404);
        const kind = alias(parts[0] ?? "");
        let needed = "payments:read";
        if (["checkouts", "links"].includes(kind) && request.method !== "GET")
          needed = "checkout:create";
        else if (kind === "refunds" && request.method !== "GET")
          needed = "refunds:create";
        else if (kind === "subscriptions") needed = "subscriptions:manage";
        else if (["products", "prices"].includes(kind))
          needed = "products:manage";
        else if (["webhooks", "deliveries"].includes(kind))
          needed = "webhooks:manage";
        else if (kind === "credentials") needed = "credentials:manage";
        const auth = request.headers.authorization;
        if (!auth?.startsWith("Bearer ")) reject("invalid_api_key", 401);
        const principal: Principal = await authenticate(
          store,
          auth.slice(7),
          needed,
        );
        let failed = true;
        try {
          if (store.config.merchantPaused)
            reject("merchant_access_paused", 503);
          const max = request.method === "GET" ? store.config.rateLimit : 30;
          for (const key of [
            "merchant:" + principal.app.ownerUserId,
            "application:" + principal.app.publicId,
            "credential:" + principal.credential.publicId + ":" + kind,
          ])
            if (!(await limiter.allow(key, max))) {
              reply.header("Retry-After", "60");
              reject("rate_limit_exceeded", 429);
            }
          reply
            .header("RateLimit-Limit", String(max))
            .header("RateLimit-Reset", "60");
          const result = await resourceRequest(
            store,
            principal,
            kind,
            parts[1] ?? "",
            parts[2] ?? "",
            request.method,
            typeof request.headers["idempotency-key"] === "string"
              ? request.headers["idempotency-key"]
              : "",
            request.query.cursor ?? "",
            request.body ?? {},
          );
          failed = false;
          return result;
        } finally {
          try {
            await recordUsage(store, principal.app.publicId, failed);
          } catch {
            request.log.warn(
              { applicationId: principal.app.publicId },
              "gateway_usage_unavailable",
            );
          }
        }
      },
    });
  });
}
