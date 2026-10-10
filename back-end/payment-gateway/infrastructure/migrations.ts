import { MongoServerError, type Document } from "mongodb";
import { gatewaySchemas } from "./schema-contract.js";
import type { GatewayStore } from "./store.js";
export async function checkFinancialContract(
  store: GatewayStore,
): Promise<void> {
  const row = await store.db
    .listCollections({ name: "transactions" }, { nameOnly: false })
    .next();
  const options = row?.options;
  const validator = options?.["validator"] as
    | {
        $jsonSchema?: {
          properties?: {
            type?: {
              enum?: string[];
            };
          };
        };
      }
    | undefined;
  const types = validator?.$jsonSchema?.properties?.type?.enum ?? [];
  if (
    ["transfer", "mining", "merchant_payment", "merchant_refund"].some(
      (type) => !types.includes(type),
    ) ||
    (options?.["validationLevel"] && options["validationLevel"] !== "strict") ||
    (options?.["validationAction"] && options["validationAction"] !== "error")
  ) {
    throw new Error(
      "Install the compatible Node financial schema before enabling gateway",
    );
  }
}
export async function compatible(store: GatewayStore): Promise<void> {
  if (
    !(await store.db
      .collection<{
        _id: string;
        financialContract: string;
      }>("gateway_schema")
      .findOne({ _id: "v1", financialContract: "merchant-v1" }))
  )
    throw new Error("Gateway migration is required");
  await checkFinancialContract(store);
  const hello = await store.db.command({ hello: 1 });
  if (!hello["setName"] && hello["msg"] !== "isdbgrid")
    throw new Error("Gateway requires MongoDB transactions");
}
export async function migrate(store: GatewayStore): Promise<void> {
  await checkFinancialContract(store);
  for (const [name, shape] of Object.entries(gatewaySchemas)) {
    let validator: Document = { $jsonSchema: { bsonType: "object", ...shape } };
    if (name === "gateway_payments")
      validator = {
        $and: [
          validator,
          {
            $expr: {
              $and: [
                {
                  $eq: [
                    "$totalMinor",
                    { $add: ["$subtotalMinor", "$taxMinor"] },
                  ],
                },
                { $eq: ["$totalMinor", { $add: ["$feeMinor", "$netMinor"] }] },
                { $gt: ["$netMinor", 0] },
                { $lte: ["$refundedMinor", "$totalMinor"] },
              ],
            },
          },
        ],
      };
    try {
      await store.db.createCollection(name, {
        validator,
        validationLevel: "strict",
        validationAction: "error",
      });
    } catch (error) {
      if (!(error instanceof MongoServerError) || error.code !== 48)
        throw error;
      await store.db.command({
        collMod: name,
        validator,
        validationLevel: "strict",
        validationAction: "error",
      });
    }
    await store.c(name).createIndex({ publicId: 1 }, { unique: true });
    await store.c(name).createIndex({ applicationId: 1, publicId: 1 });
  }
  await store
    .c("gateway_applications")
    .createIndex(
      { ownerUserId: 1, idempotencyKey: 1 },
      {
        unique: true,
        partialFilterExpression: { idempotencyKey: { $type: "string" } },
      },
    );
  const indexes: [string, Record<string, 1>, boolean][] = [
    ["gateway_credentials", { hash: 1 }, true],
    ["gateway_applications", { ownerUserId: 1, publicId: 1 }, false],
    ["gateway_payments", { applicationId: 1, idempotencyKey: 1 }, true],
    [
      "gateway_approvals",
      { paymentId: 1, ownerUserId: 1, idempotencyKey: 1 },
      true,
    ],
    ["gateway_invoices", { subscriptionId: 1, cycle: 1 }, true],
    ["gateway_invoices", { status: 1, dueAt: 1, leaseUntil: 1 }, false],
    ["gateway_subscriptions", { status: 1, dueAt: 1 }, false],
    ["gateway_refunds", { applicationId: 1, idempotencyKey: 1 }, true],
    ["gateway_deliveries", { eventId: 1, endpointId: 1 }, true],
    ["gateway_deliveries", { status: 1, dueAt: 1, leaseUntil: 1 }, false],
    ["gateway_events", { expanded: 1, publicId: 1 }, false],
  ];
  for (const [name, keys, unique] of indexes)
    await store.c(name).createIndex(keys, { unique });
  await store
    .c("gateway_nonces")
    .createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  await store
    .c("transactions")
    .createIndex(
      { type: 1, operationId: 1 },
      {
        name: "transactions_merchant_operation_unique",
        unique: true,
        partialFilterExpression: {
          type: { $in: ["merchant_payment", "merchant_refund"] },
        },
      },
    );
  await store.db
    .collection<{
      _id: string;
      financialContract: string;
    }>("gateway_schema")
    .updateOne(
      { _id: "v1" },
      { $set: { financialContract: "merchant-v1" } },
      { upsert: true },
    );
}
