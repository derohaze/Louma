import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { CheckoutInput, Endpoint, Payment } from "./domain/models.js";
import {
  calculateFee,
  formatMoney,
  MAX_AMOUNT,
  parseMoney,
  reject,
} from "./domain/money.js";
import { paymentView, publicView } from "./domain/views.js";
import { price, saveCheckout } from "./infrastructure/checkout.js";
import {
  createApplication,
  createCredential,
  rotateCredential,
  type Principal,
} from "./infrastructure/merchants.js";
import { cancelSubscription } from "./infrastructure/billing.js";
import { refundRequest } from "./infrastructure/refunds.js";
import {
  changeResource,
  collection,
  expireCheckout,
  insertResource,
  listResources,
  publicResource,
  resource,
} from "./infrastructure/resources.js";
import { createEndpoint, retryDelivery } from "./infrastructure/webhooks.js";
import type { GatewayStore } from "./infrastructure/store.js";
import { encrypt, hash, returnUrl, secret, webhookUrl } from "./security.js";
export const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const KEY = /^[A-Za-z0-9:_-]{1,128}$/;
export const scopes = [
  "checkout:create",
  "payments:read",
  "refunds:create",
  "subscriptions:manage",
  "products:manage",
  "webhooks:manage",
  "credentials:manage",
] as const;
export const events = [
  "payment.succeeded",
  "payment.failed",
  "payment.refunded",
  "checkout.session.completed",
  "invoice.paid",
  "invoice.payment_failed",
  "subscription.created",
  "subscription.renewed",
  "subscription.past_due",
  "subscription.canceled",
  "subscription.cancellation_scheduled",
] as const;
export const uuidSchema = z.string().regex(UUID);
export const keySchema = z.string().regex(KEY);
const text = (max: number) =>
  z.string().refine((value) => Buffer.byteLength(value) <= max);
const amountSchema = z.string().max(17);
export function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) return reject("invalid_json");
  return result.data;
}
export const checkoutSchema = z
  .object({
    subtotal: amountSchema.default(""),
    tax: amountSchema.default(""),
    currency: z.literal("LMA"),
    description: text(240).default(""),
    success_url: text(2048).default(""),
    cancel_url: text(2048).default(""),
    price_id: z.union([uuidSchema, z.literal("")]).default(""),
    metadata: z
      .record(text(40), text(240))
      .refine((value) => Object.keys(value).length <= 16)
      .default({}),
  })
  .strict();
/** Go encoding/json escapes these characters; field order is supplied by the original struct contract. */
export function fingerprint(value: unknown): string {
  return hash(goJSON(value));
}
function goJSON(value: unknown): string {
  return JSON.stringify(value).replace(
    /[<>&\u2028\u2029]/g,
    (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}
function checkoutFingerprint(input: CheckoutInput): string {
  // Keep struct fields in declaration order, and map keys in Go's UTF-8 order.
  // Rebuilding an object would make JSON.stringify reorder integer-like keys.
  const metadata = Object.entries(input.metadata)
    .sort(([a], [b]) => Buffer.compare(Buffer.from(a), Buffer.from(b)))
    .map(([key, value]) => `${goJSON(key)}:${goJSON(value)}`)
    .join(",");
  return hash(
    `{${Object.entries(input)
      .map(
        ([key, value]) =>
          `${goJSON(key)}:${key === "metadata" ? `{${metadata}}` : goJSON(value)}`,
      )
      .join(",")}}`,
  );
}
export function validateDomains(domains: string[], test: boolean): void {
  if (domains.length > 16) reject("invalid_domains");
  for (const host of domains) {
    let url: URL;
    try {
      url = new URL("https://" + host);
    } catch {
      return reject("invalid_domains");
    }
    if (
      (url.host !== host && host !== url.hostname + ":443") ||
      url.pathname !== "/" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      /[\s\\]/.test(host) ||
      Buffer.byteLength(host) > 240 ||
      (!test && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
    )
      reject("invalid_domains");
  }
}
export async function prepareCheckout(
  store: GatewayStore,
  p: Principal,
  input: CheckoutInput,
  key: string,
): Promise<Payment> {
  if (store.config.creationPaused || store.config.merchantPaused)
    reject("payment_creation_paused", 503);
  if (p.app.status !== "active") reject("payments_disabled", 403);
  if (!KEY.test(key)) reject("invalid_checkout");
  const selected = input.price_id
    ? await price(store, p.app.publicId, input.price_id)
    : null;
  const normalized = {
    subtotal: selected ? formatMoney(selected.amountMinor) : input.subtotal,
    tax: input.tax || "0",
    currency: input.currency,
    description: input.description,
    success_url: input.success_url,
    cancel_url: input.cancel_url,
    price_id: input.price_id,
    metadata: input.metadata,
  };
  const subtotal = parseMoney(normalized.subtotal),
    tax = parseMoney(normalized.tax);
  if (subtotal < 1 || tax > MAX_AMOUNT - subtotal) reject("invalid_amount");
  const fee = calculateFee(subtotal + tax, store.config.fee);
  if (selected?.interval && tax !== 0)
    reject("recurring_tax_requires_fixed_price");
  returnUrl(
    input.success_url,
    p.app.domains,
    store.config.environment === "test",
  );
  returnUrl(
    input.cancel_url,
    p.app.domains,
    store.config.environment === "test",
  );
  const payment: Payment = {
    publicId: randomUUID(),
    applicationId: p.app.publicId,
    credentialId: p.credential.publicId,
    receivingWalletId: p.app.walletId,
    merchantName: p.app.name,
    subtotalMinor: subtotal,
    taxMinor: tax,
    totalMinor: subtotal + tax,
    feeMinor: fee,
    netMinor: subtotal + tax - fee,
    feePolicy: store.config.fee,
    description: input.description,
    status: "requires_action",
    idempotencyKey: key,
    requestFingerprint: checkoutFingerprint(normalized),
    intentHash: "",
    payerUserId: "",
    payerWalletId: "",
    transactionId: "",
    refundedMinor: 0,
    priceId: input.price_id,
    interval: selected?.interval ?? "",
    subscriptionId: "",
    invoiceId: "",
    successUrl: input.success_url,
    cancelUrl: input.cancel_url,
    metadata: normalized.metadata,
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 1800000),
  };
  payment.intentHash = fingerprint({
    ID: payment.publicId,
    App: payment.applicationId,
    Wallet: payment.receivingWalletId,
    Price: payment.priceId,
    Interval: payment.interval,
    Subtotal: payment.subtotalMinor,
    Tax: payment.taxMinor,
    Fee: payment.feeMinor,
    Policy: {
      version: payment.feePolicy.version,
      basis_points: payment.feePolicy.basisPoints,
    },
  });
  return payment;
}
export async function checkout(
  store: GatewayStore,
  p: Principal,
  body: unknown,
  key: string,
): Promise<Payment> {
  return saveCheckout(
    store,
    p,
    await prepareCheckout(store, p, parse(checkoutSchema, body), key),
  );
}
export async function createApplicationRequest(
  store: GatewayStore,
  owner: string,
  body: unknown,
) {
  const input = parse(
    z
      .object({
        name: text(120).refine((value) => value.length > 0),
        wallet_id: uuidSchema.optional(),
        receiving_wallet_id: uuidSchema.optional(),
        domains: z.array(text(240)).max(16).default([]),
        idempotency_key: keySchema,
      })
      .strict(),
    body,
  );
  const wallet = input.wallet_id ?? input.receiving_wallet_id;
  if (!wallet) reject("invalid_application");
  validateDomains(input.domains, store.config.environment === "test");
  return publicView(
    "Application",
    await createApplication(store, {
      ownerUserId: owner,
      name: input.name,
      walletId: wallet,
      domains: input.domains,
      idempotencyKey: input.idempotency_key,
      requestFingerprint: fingerprint({
        Name: input.name,
        Wallet: wallet,
        Domains: input.domains,
      }),
    }),
  );
}
export async function resourceRequest(
  store: GatewayStore,
  p: Principal,
  kind: string,
  id: string,
  action: string,
  method: string,
  key: string,
  cursor: string,
  body: unknown,
): Promise<Record<string, unknown>> {
  collection(kind);
  if (id && !UUID.test(id)) reject("not_found", 404);
  if (cursor && !UUID.test(cursor)) reject("invalid_cursor");
  if (method === "GET") {
    if (action) reject("method_not_allowed", 405);
    return id
      ? resource(store, p.app.publicId, kind, id)
      : listResources(store, kind, p.app.publicId, cursor);
  }
  if (store.config.merchantPaused) reject("merchant_access_paused", 503);
  if (id) {
    if (method === "POST" && action === "retry" && kind === "deliveries") {
      parse(z.object({}).strict(), body);
      await retryDelivery(store, p.app.publicId, id);
    } else if (
      method === "POST" &&
      action === "rotate" &&
      kind === "credentials"
    ) {
      parse(z.object({}).strict(), body);
      const result = await rotateCredential(store, p, id);
      return {
        id: result.id,
        credential: publicView("Credential", result.credential),
        api_key: result.api_key,
      };
    } else if (
      method === "POST" &&
      action === "rotate" &&
      kind === "webhooks"
    ) {
      parse(z.object({}).strict(), body);
      const signing = secret();
      await changeResource(store, p.app.publicId, kind, id, {
        encryptedSecret: encrypt(store.config.encryptionKey, signing),
      });
      return { id, signing_secret: signing };
    } else if (
      method === "POST" &&
      action === "cancel" &&
      kind === "subscriptions"
    ) {
      const input = parse(
        z.object({ at_period_end: z.boolean().default(false) }).strict(),
        body,
      );
      await cancelSubscription(store, {
        applicationId: p.app.publicId,
        ownerUserId: "",
        id,
        atPeriodEnd: input.at_period_end,
      });
    } else if (
      method === "POST" &&
      action === "expire" &&
      kind === "checkouts"
    ) {
      parse(z.object({}).strict(), body);
      await expireCheckout(store, p.app.publicId, id);
    } else if (
      method === "POST" &&
      ((action === "disable" && ["links", "webhooks"].includes(kind)) ||
        (action === "revoke" && kind === "credentials"))
    ) {
      parse(z.object({}).strict(), body);
      await changeResource(store, p.app.publicId, kind, id, {
        status: action === "revoke" ? "revoked" : "disabled",
      });
    } else if (
      method === "PATCH" &&
      ["links", "products", "webhooks"].includes(kind) &&
      !action
    ) {
      const input = parse(
        z.object({ status: z.enum(["disabled", "archived"]) }).strict(),
        body,
      );
      if (input.status !== (kind === "products" ? "archived" : "disabled"))
        reject("invalid_transition");
      await changeResource(store, p.app.publicId, kind, id, {
        status: input.status,
      });
    } else return reject("not_found", 404);
    return resource(store, p.app.publicId, kind, id);
  }
  if (method !== "POST") return reject("method_not_allowed", 405);
  const publicId = randomUUID(),
    applicationId = p.app.publicId,
    createdAt = new Date();
  if (kind === "checkouts" || kind === "subscriptions") {
    const input = parse(checkoutSchema, body);
    if (kind === "subscriptions") {
      if (!input.price_id) reject("price_required");
      if (!(await price(store, applicationId, input.price_id)).interval)
        reject("recurring_price_required");
    }
    const pmt = await checkout(store, p, input, key);
    return {
      ...paymentView(pmt),
      checkout_url: `${store.config.publicUrl}/checkout/${pmt.publicId}`,
    };
  }
  if (kind === "credentials") {
    const input = parse(
      z
        .object({
          scopes: z.array(z.enum(scopes)).min(1).max(8),
          expires_at: z.string().datetime().nullable().optional(),
        })
        .strict(),
      body,
    );
    const expires = input.expires_at ? new Date(input.expires_at) : null;
    if (expires && expires <= createdAt) reject("invalid_credential");
    const result = await createCredential(store, p, input.scopes, expires);
    return {
      id: result.id,
      credential: publicView("Credential", result.credential),
      api_key: result.api_key,
    };
  }
  if (kind === "products") {
    const input = parse(
      z
        .object({
          name: text(120).refine((v) => v.length > 0),
          description: text(240).default(""),
        })
        .strict(),
      body,
    );
    const row = {
      publicId,
      applicationId,
      ...input,
      status: "active",
      createdAt,
    };
    await insertResource(store, kind, row);
    return publicResource(kind, row, store);
  }
  if (kind === "prices") {
    const input = parse(
      z
        .object({
          product_id: uuidSchema,
          amount: amountSchema,
          currency: z.literal("LMA"),
          interval: z
            .enum(["", "one_time", "month", "monthly", "year", "yearly"])
            .default(""),
        })
        .strict(),
      body,
    );
    const amount = parseMoney(input.amount);
    if (amount < 1) reject("invalid_price");
    await resource(store, applicationId, "products", input.product_id);
    const row = {
      publicId,
      applicationId,
      productId: input.product_id,
      amountMinor: amount,
      interval: ["month", "monthly"].includes(input.interval)
        ? "month"
        : ["year", "yearly"].includes(input.interval)
          ? "year"
          : "",
      version: 1,
      status: "active",
      createdAt,
    };
    await insertResource(store, kind, row);
    return publicResource(kind, row, store);
  }
  if (kind === "refunds") {
    const input = parse(
      z
        .object({
          payment_id: uuidSchema,
          amount: amountSchema.default(""),
          reason: text(240).default(""),
        })
        .strict(),
      body,
    );
    if (!KEY.test(key)) reject("invalid_refund");
    return publicView(
      "Refund",
      await refundRequest(
        store,
        p,
        input.payment_id,
        input.amount,
        key,
        input.reason,
      ),
    );
  }
  if (kind === "links") {
    const input = parse(checkoutSchema, body);
    await prepareCheckout(store, p, input, "link-validation:" + publicId);
    const { success_url, cancel_url, price_id, ...rest } = input;
    const row = {
      publicId,
      applicationId,
      input: {
        ...rest,
        successurl: success_url,
        cancelurl: cancel_url,
        priceid: price_id,
      },
      status: "active",
      createdAt,
    };
    await insertResource(store, kind, row);
    return publicResource(kind, row, store);
  }
  if (kind === "webhooks") {
    const input = parse(
      z
        .object({
          url: text(2048),
          events: z.array(z.enum(events)).min(1).max(16),
        })
        .strict(),
      body,
    );
    webhookUrl(input.url);
    const signing = secret();
    const endpoint: Endpoint = {
      publicId,
      applicationId,
      url: input.url,
      events: input.events,
      encryptedSecret: encrypt(store.config.encryptionKey, signing),
      status: "active",
      createdAt,
    };
    await createEndpoint(store, p, endpoint);
    return {
      id: publicId,
      endpoint: publicView("Endpoint", endpoint),
      signing_secret: signing,
    };
  }
  return reject("not_found", 404);
}
