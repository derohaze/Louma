import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { checkout, checkoutSchema, prepareCheckout } from "../service.js";
import { schedule } from "../infrastructure/billing.js";
import { expandEvents } from "../infrastructure/webhooks.js";
import { tick } from "../worker.js";
import type { GatewayStore } from "../infrastructure/store.js";
import type { Principal } from "../infrastructure/merchants.js";

test("replaying a Go checkout preserves numeric and UTF-8 metadata key order", async () => {
  const body = {
    subtotal: "50",
    currency: "LMA",
    metadata: {
      "9": "nine",
      "10": "ten",
      "\u{10000}": "astral",
      "\ue000": "<>&",
    },
  };
  // encoding/json output from the original CheckoutInput struct and map[string]string.
  const goJSON =
    '{"subtotal":"50","tax":"0","currency":"LMA","description":"","success_url":"","cancel_url":"","price_id":"","metadata":{"10":"ten","9":"nine","\ue000":"\\u003c\\u003e\\u0026","\u{10000}":"astral"}}';
  const principal = {
    app: {
      publicId: "merchant",
      walletId: "wallet",
      name: "Shop",
      domains: [],
      status: "active",
    },
    credential: { publicId: "key" },
  } as unknown as Principal;
  const store = {
    config: { environment: "test", fee: { version: "v1", basisPoints: 100 } },
  } as GatewayStore;
  const prior = await prepareCheckout(
    store,
    principal,
    checkoutSchema.parse(body),
    "order-42",
  );
  prior.requestFingerprint = createHash("sha256").update(goJSON).digest("hex");
  store.find = async () => prior as never;
  store.transaction = async () => {
    throw new Error("Replay must not write a new payment");
  };
  const replay = await checkout(store, principal, body, "order-42");
  assert.equal(replay.publicId, prior.publicId);
  await assert.rejects(
    checkout(store, principal, { ...body, subtotal: "100" }, "order-42"),
    /idempotency_key_reused/,
  );
  await assert.rejects(
    checkout(
      store,
      principal,
      { ...body, metadata: { ...body.metadata, "9": "changed" } },
      "order-42",
    ),
    /idempotency_key_reused/,
  );
});

for (const batch of [schedule, expandEvents]) {
  test(`${batch.name} finishes the current transaction and stops before the next`, async () => {
    let stopped = false,
      transactions = 0;
    const cursor = {
      sort: () => cursor,
      limit: () => cursor,
      toArray: async () => Array.from({ length: 50 }, () => ({})),
    };
    const store = {
      c: () => ({ find: () => cursor }),
      transaction: async () => {
        transactions++;
        stopped = true;
      },
    } as unknown as GatewayStore;
    await batch(store, new Date(), () => stopped);
    assert.equal(transactions, 1);
  });
  test(`${batch.name} does no database work when already stopping`, async () => {
    const store = {
      c: () => {
        throw new Error("Unexpected database query");
      },
    } as unknown as GatewayStore;
    await batch(store, new Date(), () => true);
  });
}

test("a stopped tick does not start scheduling", async () => {
  const store = {
    config: {},
    c: () => {
      throw new Error("Unexpected database query");
    },
  } as unknown as GatewayStore;
  await tick(store, { warn() {}, error() {} }, () => true);
});
