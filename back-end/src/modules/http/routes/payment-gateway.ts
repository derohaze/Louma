import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { settingsCache } from "../../../app.js";
import { hasGatewayDeveloperAccess } from "../../../infrastructure/mongodb/gateway-developer-repository.js";
import { AppError, badRequest, conflict, forbidden, notFound } from "../../../shared/errors.js";
import { publicIdSchema } from "../schemas.js";
import { authenticated, getAuth, parseBody } from "../http-helpers.js";
import { gatewayRequest } from "../../payment-gateway/client.js";
import type { GatewayMode } from "../../payment-gateway/config.js";
import { findPrimaryWallet } from "../../wallets/service.js";
import { proveTransferCredential } from "../../security/service.js";
import { recordSecurityEvent } from "../../security/audit.js";
import { assertTransferAuthorizationAttemptsRemain } from "../../transfers/intent.js";
import { settleMiningForOwner } from "../../mining/service.js";
import { gatewayInternalRequest } from "../../../../payment-gateway/transport.js";
import { GatewayError } from "../../../../payment-gateway/domain/money.js";

const modeSchema = z.enum(["test", "live"]);
const amountSchema = z.string().regex(/^(?:0|[1-9]\d{0,11})(?:\.\d{1,4})?$/).max(17);
const urlSchema = z.string().url().max(2048);
const scopes = ["checkout:create", "payments:read", "refunds:create", "subscriptions:manage", "products:manage", "webhooks:manage", "credentials:manage"] as const;
const checkoutBody = z.object({ subtotal: amountSchema, tax: amountSchema.optional(), currency: z.literal("LMA"), description: z.string().min(1).max(240), success_url: urlSchema.optional(), cancel_url: urlSchema.optional(), price_id: publicIdSchema.optional() }).strict();
const resourceSchemas = {
  credentials: z.object({ scopes: z.array(z.enum(scopes)).min(1).max(scopes.length), expires_at: z.string().datetime().optional() }).strict(),
  checkouts: checkoutBody,
  links: checkoutBody,
  products: z.object({ name: z.string().min(1).max(120), description: z.string().max(240).optional() }).strict(),
  prices: z.object({ product_id: publicIdSchema, amount: amountSchema, currency: z.literal("LMA"), interval: z.enum(["one_time", "monthly", "yearly"]) }).strict(),
  refunds: z.object({ payment_id: publicIdSchema, amount: amountSchema.optional(), reason: z.string().max(240).optional() }).strict(),
  webhooks: z.object({ url: urlSchema, events: z.array(z.string().min(1).max(80)).min(1).max(16) }).strict(),
};
const resources = ["credentials", "checkouts", "payments", "links", "products", "prices", "subscriptions", "invoices", "refunds", "webhooks", "deliveries", "usage"] as const;

function requestKey(request: FastifyRequest): string {
  const key = request.headers["idempotency-key"];
  if (typeof key !== "string" || !/^[\x21-\x7e]{8,128}$/.test(key)) throw badRequest("idempotency_key_required", "A valid Idempotency-Key is required.");
  return key;
}

async function gatewayCall(app: FastifyInstance, request: FastifyRequest, mode: GatewayMode, path: string, method: "GET" | "POST" | "PATCH", body?: unknown) {
  if (app.gateway) {
    if (app.gateway.config.environment !== mode) throw new AppError(503, "payment_gateway_disabled", "Payments are unavailable in this environment.");
    if (method === "POST" && /^\/checkout\/[^/]+\/confirm$/.test(path) && !await app.gatewayLimiter!.allow(`payer:${getAuth(request).userId}`, 20)) {
      throw new AppError(429, "rate_limit_exceeded", "Too many payment attempts. Try again later.");
    }
    try { return await gatewayInternalRequest(app.gateway, { ownerUserId: getAuth(request).userId, path: `/internal/v1${path}`, method, ...(body === undefined ? {} : { body }) }); }
    catch (error) { if (error instanceof GatewayError) throw new AppError(error.statusCode, error.code, error.code.replaceAll("_", " ")); throw error; }
  }
  return gatewayRequest<Record<string, unknown>>({ connection: app.config.paymentGateway[mode], ownerUserId: getAuth(request).userId, path: `/internal/v1${path}`, method, ...(body === undefined ? {} : { body }) });
}

async function requireDeveloper(app: FastifyInstance, request: FastifyRequest): Promise<void> {
  const allowed = await hasGatewayDeveloperAccess({ mongoClient: app.mongoClient, database: app.config.mongoDatabase, ownerUserId: getAuth(request).userId });
  if (!allowed) throw forbidden("developer_access_required", "Developer access must be granted before using payments management.");
}

async function approveCheckout(app: FastifyInstance, request: FastifyRequest, paymentId: string) {
  const body = parseBody(z.object({ mode: modeSchema, intent_hash: z.string().regex(/^[a-f0-9]{64}$/), transferPassword: z.string().max(128).optional(), twoFactorCode: z.string().max(64).optional(), recurring_consent: z.boolean().optional(), policy_version: z.string().max(40).optional() }).strict(), request.body);
  const key = requestKey(request);
  const current = getAuth(request);
  const checkout = await gatewayCall(app, request, body.mode, `/checkout/${paymentId}`, "GET");
  if (checkout["intent_hash"] !== body.intent_hash) throw conflict("payment_intent_changed", "The payment details changed. Review them again.");
  if (checkout["status"] === "succeeded") return gatewayCall(app, request, body.mode, `/checkout/${paymentId}/confirm`, "POST", { approval_id: "", intent_hash: body.intent_hash, idempotency_key: key });
  const wallet = await findPrimaryWallet(app.collections, current.userId);
  if (!wallet) throw notFound();
  if (wallet.status !== "active") throw forbidden("wallet_frozen", "This wallet is frozen and cannot pay.");
  try {
    const prior = await gatewayCall(app, request, body.mode, `/approvals?payment_id=${paymentId}&idempotency_key=${encodeURIComponent(key)}`, "GET");
    if (typeof prior["id"] !== "string") throw conflict("invalid_payment_approval", "The payment approval was not issued.");
    if (prior["owner_user_id"] !== current.userId || prior["session_id"] !== current.sessionId || prior["wallet_id"] !== wallet.publicId || prior["intent_hash"] !== body.intent_hash || prior["recurring_consent"] !== (body.recurring_consent ?? false) || prior["policy_version"] !== (body.policy_version ?? "")) {
      throw conflict("payment_approval_changed", "The payment authorization changed. Review the payment and use a new request key.");
    }
    const expiresAt = typeof prior["expires_at"] === "string" ? Date.parse(prior["expires_at"]) : NaN;
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) throw conflict("payment_approval_expired", "The payment authorization expired. Review the payment and use a new request key.");
    return gatewayCall(app, request, body.mode, `/checkout/${paymentId}/confirm`, "POST", { approval_id: prior["id"], intent_hash: body.intent_hash, idempotency_key: key });
  } catch (failure) {
    if (!(failure instanceof AppError) || failure.statusCode !== 404) throw failure;
  }
  await assertTransferAuthorizationAttemptsRemain({ collections: app.collections, ownerUserId: current.userId });
  let proof;
  try {
    proof = await proveTransferCredential({ collections: app.collections, config: app.config, ownerUserId: current.userId, password: body.transferPassword, twoFactorCode: body.twoFactorCode });
  } catch (failure) {
    await recordSecurityEvent({ collections: app.collections, ownerUserId: current.userId, sessionId: current.sessionId, eventType: "transfer_rejected", outcome: "failure", correlationId: request.id, metadata: { reason: failure instanceof Error && "code" in failure ? String(failure.code) : "invalid_transfer_authorization", operation: "payment" } });
    throw failure;
  }
  if (body.mode === "live") await settleMiningForOwner({ collections: app.collections, mongoClient: app.mongoClient, config: app.config, ownerUserId: current.userId, correlationId: request.id, cache: settingsCache(app) });
  const approval = await gatewayCall(app, request, body.mode, "/approvals", "POST", {
    payment_id: paymentId, owner_user_id: current.userId, wallet_id: wallet.publicId, session_id: current.sessionId,
    intent_hash: body.intent_hash, proof: body.mode === "test" ? { kind: "none", passwordChangedAt: null, twoFactorEnabledAt: null } : { ...proof, ...(proof.kind === "recovery_code" ? { credentialId: proof.credentialId.toHexString() } : {}) },
    recurring_consent: body.recurring_consent ?? false, policy_version: body.policy_version ?? "", idempotency_key: key,
  });
  if (typeof approval["id"] !== "string") throw conflict("invalid_payment_approval", "The payment approval was not issued.");
  return gatewayCall(app, request, body.mode, `/checkout/${paymentId}/confirm`, "POST", { approval_id: approval["id"], intent_hash: body.intent_hash, idempotency_key: key });
}

export async function registerPaymentGatewayRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/v1/developer/access", authenticated, async (request) => {
    const mode = app.config.environment === "production" ? "live" : "test";
    return {
      eligible: await hasGatewayDeveloperAccess({ mongoClient: app.mongoClient, database: app.config.mongoDatabase, ownerUserId: getAuth(request).userId }),
      mode,
      available: app.gateway ? app.gateway.config.environment === mode : app.config.paymentGateway[mode] !== null,
      gateway_url: app.gateway?.config.publicUrl ?? null,
    };
  });
  app.get("/api/v1/developer/applications", authenticated, async (request) => {
    await requireDeveloper(app, request);
    const query = parseBody(z.object({ mode: modeSchema, cursor: publicIdSchema.optional(), limit: z.coerce.number().int().min(1).max(100).optional() }).strict(), request.query);
    const search = new URLSearchParams();
    if (query.cursor) search.set("cursor", query.cursor);
    if (query.limit) search.set("limit", String(query.limit));
    return gatewayCall(app, request, query.mode, `/applications${search.size ? `?${search}` : ""}`, "GET");
  });
  app.post("/api/v1/developer/applications", authenticated, async (request, reply) => {
    await requireDeveloper(app, request);
    const body = parseBody(z.object({ mode: modeSchema, name: z.string().min(1).max(120), wallet_id: publicIdSchema, domains: z.array(z.string().min(1).max(253)).max(16) }).strict(), request.body);
    const wallet = await app.collections.wallets.findOne({ publicId: body.wallet_id, ownerUserId: getAuth(request).userId, status: "active" });
    if (!wallet) throw forbidden("receiving_wallet_forbidden", "Select an active wallet that you own.");
    const { mode, ...application } = body;
    return reply.code(201).send(await gatewayCall(app, request, mode, "/applications", "POST", { ...application, idempotency_key: requestKey(request) }));
  });
  app.patch("/api/v1/developer/applications/:id", authenticated, async (request) => {
    await requireDeveloper(app, request);
    const { id } = parseBody(z.object({ id: publicIdSchema }), request.params);
    const body = parseBody(z.object({ mode: modeSchema, status: z.enum(["active", "disabled"]).optional(), name: z.string().min(1).max(120).optional(), domains: z.array(z.string().min(1).max(253)).max(16).optional(), wallet_id: publicIdSchema.optional(), image_url: z.string().max(2048).optional() }).strict(), request.body);
    const { mode, wallet_id, ...changes } = body;
    if (wallet_id && !await app.collections.wallets.findOne({ publicId: wallet_id, ownerUserId: getAuth(request).userId, status: "active" })) throw forbidden("receiving_wallet_forbidden", "Select an active wallet that you own.");
    return gatewayCall(app, request, mode, `/applications/${id}`, "PATCH", { ...changes, ...(wallet_id ? { receiving_wallet_id: wallet_id } : {}) });
  });
  for (const resource of resources) {
    app.get(`/api/v1/developer/applications/:id/${resource}`, authenticated, async (request) => {
      await requireDeveloper(app, request);
      const { id } = parseBody(z.object({ id: publicIdSchema }), request.params);
      const query = parseBody(z.object({ mode: modeSchema, cursor: publicIdSchema.optional(), limit: z.coerce.number().int().min(1).max(100).optional() }).strict(), request.query);
      const search = new URLSearchParams();
      if (query.cursor) search.set("cursor", query.cursor);
      if (query.limit) search.set("limit", String(query.limit));
      return gatewayCall(app, request, query.mode, `/applications/${id}/${resource}${search.size ? `?${search}` : ""}`, "GET");
    });
  }
  for (const [resource, schema] of Object.entries(resourceSchemas)) {
    app.post(`/api/v1/developer/applications/:id/${resource}`, authenticated, async (request, reply) => {
      await requireDeveloper(app, request);
      const { id } = parseBody(z.object({ id: publicIdSchema }), request.params);
      const envelope = parseBody(z.object({ mode: modeSchema, payload: schema }).strict(), request.body);
      return reply.code(201).send(await gatewayCall(app, request, envelope.mode, `/applications/${id}/${resource}`, "POST", { ...envelope.payload, idempotency_key: requestKey(request) }));
    });
  }
  for (const [resource, action] of [["credentials", "revoke"], ["subscriptions", "cancel"], ["links", "disable"], ["webhooks", "disable"], ["deliveries", "retry"]] as const) {
    app.post(`/api/v1/developer/${resource}/:id/${action}`, authenticated, async (request) => {
      await requireDeveloper(app, request);
      const { id } = parseBody(z.object({ id: publicIdSchema }), request.params);
      const body = parseBody(z.object({ mode: modeSchema, at_period_end: z.boolean().optional() }).strict(), request.body);
      return gatewayCall(app, request, body.mode, `/${resource}/${id}/${action}`, "POST", { ...(body.at_period_end === undefined ? {} : { at_period_end: body.at_period_end }), idempotency_key: requestKey(request) });
    });
  }
  app.get("/api/v1/payments/checkout/:id", authenticated, async (request) => {
    const { id } = parseBody(z.object({ id: publicIdSchema }), request.params);
    const { mode } = parseBody(z.object({ mode: modeSchema }).strict(), request.query);
    const checkout = await gatewayCall(app, request, mode, `/checkout/${id}`, "GET");
    const wallet = await findPrimaryWallet(app.collections, getAuth(request).userId);
    let storeImage = "";
    try {
      const store = await gatewayCall(app, request, mode, `/applications/${checkout["application_id"]}`, "GET");
      if (typeof store["image_url"] === "string") storeImage = store["image_url"];
    } catch {
      storeImage = "";
    }
    const merchant = { ...(checkout["merchant"] as Record<string, unknown>), ...(storeImage ? { image: storeImage } : {}) };
    return { ...checkout, merchant, payer_wallet: wallet ? { id: wallet.publicId, address: wallet.address, status: wallet.status } : null };
  });
  app.post("/api/v1/payments/checkout/:id/confirm", { ...authenticated, config: { rateLimit: { max: 20, timeWindow: 60_000 } } }, async (request) => {
    const { id } = parseBody(z.object({ id: publicIdSchema }), request.params);
    return approveCheckout(app, request, id);
  });
  app.post("/api/v1/payments/subscriptions/:id/cancel", authenticated, async (request) => {
    const { id } = parseBody(z.object({ id: publicIdSchema }), request.params);
    const { mode } = parseBody(z.object({ mode: modeSchema }).strict(), request.body);
    return gatewayCall(app, request, mode, `/customer-subscriptions/${id}/cancel`, "POST", { idempotency_key: requestKey(request) });
  });
}
