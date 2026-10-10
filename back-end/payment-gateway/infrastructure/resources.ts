import type { Document } from "mongodb";
import type { Application, Link, Payment } from "../domain/models.js";
import { reject } from "../domain/money.js";
import { paymentView, publicView } from "../domain/views.js";
import { application, guardManagement } from "./merchants.js";
import { event, guardReceiver } from "./settlement.js";
import { changed, moneyDocument, type GatewayStore } from "./store.js";
const resources: Record<string, [string, string]> = {
  credentials: ["gateway_credentials", "Credential"],
  checkouts: ["gateway_payments", "Payment"],
  payments: ["gateway_payments", "Payment"],
  links: ["gateway_links", "Link"],
  products: ["gateway_products", "Product"],
  prices: ["gateway_prices", "Price"],
  subscriptions: ["gateway_subscriptions", "Subscription"],
  invoices: ["gateway_invoices", "Invoice"],
  refunds: ["gateway_refunds", "Refund"],
  webhooks: ["gateway_webhooks", "Endpoint"],
  deliveries: ["gateway_deliveries", "Delivery"],
};
export function collection(kind: string): string {
  return resources[kind]?.[0] ?? reject("not_found", 404);
}
export function publicResource(
  kind: string,
  row: object,
  store: GatewayStore,
): Record<string, unknown> {
  const type = resources[kind]?.[1] ?? reject("not_found", 404);
  const view =
    type === "Payment" ? paymentView(row as Payment) : publicView(type, row);
  if (kind === "checkouts")
    view["checkout_url"] = `${store.config.publicUrl}/checkout/${view["id"]}`;
  if (kind === "links") {
    view["input"] = decodeLinkInput(
      (row as Link).input as unknown as Record<string, unknown>,
    );
    delete view["checkout"];
    view["url"] = `${store.config.publicUrl}/pay/${view["id"]}`;
  }
  return view;
}
export function decodeLinkInput(
  raw: Record<string, unknown>,
): Record<string, unknown> {
  return {
    subtotal: raw["subtotal"] ?? "",
    tax: raw["tax"] ?? "",
    currency: raw["currency"] ?? "",
    description: raw["description"] ?? "",
    success_url: raw["successurl"] ?? raw["success_url"] ?? "",
    cancel_url: raw["cancelurl"] ?? raw["cancel_url"] ?? "",
    price_id: raw["priceid"] ?? raw["price_id"] ?? "",
    metadata: raw["metadata"] ?? {},
  };
}
export async function resource(
  store: GatewayStore,
  app: string,
  kind: string,
  id: string,
) {
  return publicResource(
    kind,
    await store.require(collection(kind), { publicId: id, applicationId: app }),
    store,
  );
}
export async function listResources(
  store: GatewayStore,
  kind: string,
  app: string,
  cursor: string,
) {
  const rows = await store
    .c(collection(kind))
    .find({
      applicationId: app,
      ...(cursor ? { publicId: { $gt: cursor } } : {}),
    })
    .sort({ publicId: 1 })
    .limit(51)
    .toArray();
  return {
    data: rows.slice(0, 50).map((row) => publicResource(kind, row, store)),
    next_cursor: rows.length > 50 ? rows[49]?.["publicId"] : "",
  };
}
export async function insertResource(
  store: GatewayStore,
  kind: string,
  row: object,
): Promise<void> {
  await store.c(collection(kind)).insertOne(moneyDocument(row));
}
export async function changeResource(
  store: GatewayStore,
  app: string,
  kind: string,
  id: string,
  fields: Document,
): Promise<void> {
  if (
    (
      await store
        .c(collection(kind))
        .updateOne(
          { publicId: id, applicationId: app },
          { $set: fields, $inc: { version: 1 } },
        )
    ).matchedCount !== 1
  )
    reject("not_found", 404);
}
export async function applications(
  store: GatewayStore,
  owner: string,
  cursor = "",
) {
  const rows = await store
    .c("gateway_applications")
    .find({
      ownerUserId: owner,
      ...(cursor ? { publicId: { $gt: cursor } } : {}),
    })
    .sort({ publicId: 1 })
    .limit(51)
    .toArray();
  return {
    data: rows.slice(0, 50).map((row) => publicView("Application", row)),
    next_cursor: rows.length > 50 ? rows[49]?.["publicId"] : "",
  };
}
export async function resourceApplication(
  store: GatewayStore,
  owner: string,
  kind: string,
  id: string,
): Promise<Application> {
  const row = await store.require<{
    applicationId: string;
  }>(collection(kind), { publicId: id });
  return application(store, owner, row.applicationId);
}
export async function updateApplication(
  store: GatewayStore,
  app: Application,
  name: string,
  wallet: string,
  domains: string[],
  imageUrl?: string,
): Promise<Application> {
  await store.transaction(async (session) => {
    await guardManagement(
      store,
      { app, credential: { publicId: "" }, internal: true },
      session,
    );
    await guardReceiver(store, wallet, app.ownerUserId, session);
    await store
      .c("gateway_applications")
      .updateOne(
        { publicId: app.publicId, ownerUserId: app.ownerUserId },
        {
          $set: { name, walletId: wallet, domains, imageUrl: imageUrl ?? "" },
          $inc: { version: 1 },
        },
        { session },
      );
  });
  return application(store, app.ownerUserId, app.publicId);
}
export async function setApplicationStatus(
  store: GatewayStore,
  owner: string,
  id: string,
  status: "active" | "disabled" | "suspended",
): Promise<void> {
  if (
    (
      await store
        .c("gateway_applications")
        .updateOne(
          { publicId: id, ownerUserId: owner },
          { $set: { status }, $inc: { version: 1 } },
        )
    ).matchedCount !== 1
  )
    reject("not_found", 404);
}
/** Kept for existing callers that fully suspend an application. */
export async function suspend(
  store: GatewayStore,
  owner: string,
  id: string,
): Promise<void> {
  return setApplicationStatus(store, owner, id, "suspended");
}
export async function recordUsage(
  store: GatewayStore,
  app: string,
  failed: boolean,
): Promise<void> {
  await store.db
    .collection<{
      _id: string;
      requests: number;
      errors: number;
    }>("gateway_usage")
    .updateOne(
      { _id: app },
      { $inc: { requests: 1, ...(failed ? { errors: 1 } : {}) } },
      { upsert: true, timeoutMS: 200 },
    );
}
export async function usage(store: GatewayStore, app: string) {
  const row = await store.db
    .collection<{
      _id: string;
      requests: number;
      errors: number;
    }>("gateway_usage")
    .findOne({ _id: app });
  return {
    requests: row?.requests ?? 0,
    errors: row?.errors ?? 0,
    rate_limit_per_minute: store.config.rateLimit,
    environment: store.config.environment,
  };
}
export async function expireCheckout(
  store: GatewayStore,
  app: string,
  id: string,
): Promise<void> {
  await store.transaction(async (session) => {
    changed(
      await store
        .c("gateway_payments")
        .updateOne(
          { publicId: id, applicationId: app, status: "requires_action" },
          { $set: { status: "canceled" } },
          { session },
        ),
      "invalid_transition",
    );
    await event(store, app, "payment.failed", id, session);
  });
}
export async function link(
  store: GatewayStore,
  id: string,
): Promise<{
  link: Link;
  app: Application;
}> {
  const row = await store.require<Link>("gateway_links", {
    publicId: id,
    status: "active",
  });
  return {
    link: row,
    app: await store.require<Application>("gateway_applications", {
      publicId: row.applicationId,
      status: "active",
    }),
  };
}
