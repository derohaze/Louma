import { randomUUID } from "node:crypto";
import type { Delivery, Endpoint, Event } from "../domain/models.js";
import { reject } from "../domain/money.js";
import { guardApplication, type Principal } from "./merchants.js";
import { changed, duplicate, type GatewayStore } from "./store.js";
const ZERO = new Date("0001-01-01T00:00:00.000Z");
export async function createEndpoint(
  store: GatewayStore,
  principal: Principal,
  endpoint: Endpoint,
): Promise<void> {
  await store.transaction(async (session) => {
    await guardApplication(store, principal, session);
    if (
      (await store
        .c("gateway_webhooks")
        .countDocuments(
          { applicationId: principal.app.publicId, status: "active" },
          { session, limit: 16 },
        )) >= 16
    )
      reject("webhook_endpoint_limit", 409);
    await store.c("gateway_webhooks").insertOne(endpoint, { session });
  });
}
export async function expandEvents(
  store: GatewayStore,
  now: Date,
  stopping: () => boolean = () => false,
): Promise<void> {
  if (stopping()) return;
  const events = await store
    .c("gateway_events")
    .find({ expanded: false })
    .limit(50)
    .toArray();
  for (const row of events) {
    if (stopping()) return;
    try {
      await store.transaction(async (session) => {
        const current = await store.find<Event>(
          "gateway_events",
          { publicId: row["publicId"], expanded: false },
          session,
        );
        if (!current) return;
        const endpoints = await store
          .c("gateway_webhooks")
          .find(
            {
              applicationId: current.applicationId,
              status: "active",
              events: current.type,
            },
            { session },
          )
          .limit(17)
          .toArray();
        if (endpoints.length > 16) reject("webhook_endpoint_limit", 409);
        for (const endpoint of endpoints)
          await store.c("gateway_deliveries").insertOne(
            {
              publicId: randomUUID(),
              applicationId: current.applicationId,
              eventId: current.publicId,
              endpointId: endpoint["publicId"],
              status: "pending",
              attempts: 0,
              dueAt: now,
              createdAt: now,
              leaseUntil: ZERO,
              fence: 0,
              lastStatus: 0,
            },
            { session },
          );
        await store
          .c("gateway_events")
          .updateOne(
            { publicId: current.publicId, expanded: false },
            { $set: { expanded: true } },
            { session },
          );
      });
    } catch (error) {
      if (!duplicate(error)) throw error;
    }
  }
}
export async function claimDelivery(
  store: GatewayStore,
  now: Date,
): Promise<Delivery | null> {
  return (await store.c("gateway_deliveries").findOneAndUpdate(
    { status: "pending", dueAt: { $lte: now }, leaseUntil: { $lte: now } },
    {
      $set: { leaseUntil: new Date(now.getTime() + 30000) },
      $inc: { fence: 1 },
    },
    { sort: { dueAt: 1 }, returnDocument: "after" },
  )) as Delivery | null;
}
export async function deliveryPayload(
  store: GatewayStore,
  d: Delivery,
): Promise<{
  endpoint: Endpoint;
  body: string;
}> {
  const endpoint = await store.require<Endpoint>("gateway_webhooks", {
    publicId: d.endpointId,
    applicationId: d.applicationId,
    status: "active",
  });
  const event = await store.require<Event>("gateway_events", {
    publicId: d.eventId,
    applicationId: d.applicationId,
  });
  return {
    endpoint,
    body: JSON.stringify({
      id: event.publicId,
      type: event.type,
      api_version: "v1",
      environment: store.config.environment,
      created_at: event.createdAt,
      data: { id: event.resourceId },
    }),
  };
}
export async function finishDelivery(
  store: GatewayStore,
  d: Delivery,
  status: number,
  now: Date,
): Promise<void> {
  const attempts = d.attempts + 1,
    state =
      status >= 200 && status < 300
        ? "succeeded"
        : attempts >= 8 || now.getTime() - d.createdAt.getTime() >= 48 * 3600000
          ? "failed"
          : "pending";
  changed(
    await store.c("gateway_deliveries").updateOne(
      { publicId: d.publicId, fence: d.fence, status: "pending" },
      {
        $set: {
          status: state,
          attempts,
          lastStatus: status,
          dueAt: new Date(
            now.getTime() +
              (30 * 2 ** Math.min(attempts, 8) +
                (d.publicId.charCodeAt(0) % 30)) *
                1000,
          ),
          leaseUntil: ZERO,
        },
      },
    ),
    "delivery_claim_lost",
  );
}
export async function retryDelivery(
  store: GatewayStore,
  app: string,
  id: string,
): Promise<void> {
  changed(
    await store.c("gateway_deliveries").updateOne(
      { publicId: id, applicationId: app, status: "failed" },
      {
        $set: {
          status: "pending",
          attempts: 0,
          dueAt: new Date(),
          createdAt: new Date(),
          leaseUntil: ZERO,
        },
        $inc: { fence: 1 },
      },
    ),
    "delivery_not_retryable",
  );
}
