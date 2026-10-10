import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { MongoClient } from "mongodb";
import { loadGatewayConfig } from "../config.js";
import { GatewayStore } from "../infrastructure/store.js";
import { migrate } from "../infrastructure/migrations.js";
import {
  createApplication,
  type Principal,
} from "../infrastructure/merchants.js";
import { checkout, resourceRequest } from "../service.js";
import { approve, payment } from "../infrastructure/checkout.js";
import { confirm } from "../infrastructure/settlement.js";
import { refundRequest } from "../infrastructure/refunds.js";
import {
  claimInvoice,
  renew,
  schedule,
  cancelSubscription,
} from "../infrastructure/billing.js";
import {
  claimDelivery,
  expandEvents,
  finishDelivery,
  retryDelivery,
} from "../infrastructure/webhooks.js";
import { getCollections } from "../../src/infrastructure/mongodb/collections.js";
import { reconcileLedger } from "../../src/modules/ledger/reconciliation.js";
import type { Payment } from "../domain/models.js";
const uri = process.env["GATEWAY_TEST_MONGODB_URI"];
interface Identity {
  userId: string;
  sessionId: string;
  walletId: string;
}
test(
  "real gateway transactions, recovery, invoice leases and webhooks preserve financial invariants",
  { skip: !uri, timeout: 120000 },
  async (suite) => {
    assert.ok(
      uri &&
        /^mongodb:\/\/(?:127\.0\.0\.1|localhost|\[::1\]):\d+\/(?:\?[^#]*)?$/.test(
          uri,
        ),
    );
    const database = "louma_gateway_test_" + randomUUID(),
      client = new MongoClient(uri),
      db = client.db(database);
    await client.connect();
    try {
      const seeded = await promisify(execFile)(
        process.execPath,
        [
          "--import",
          "tsx",
          fileURLToPath(new URL("./setup-financial.mjs", import.meta.url)),
          "setup",
          uri,
          database,
        ],
        { windowsHide: true },
      );
      const identities = JSON.parse(seeded.stdout) as Record<
        "payer" | "payer2" | "merchant" | "otherMerchant",
        Identity
      >;
      const config = loadGatewayConfig({
        GATEWAY_ENABLED: "true",
        GATEWAY_ENVIRONMENT: "test",
        MONGODB_DATABASE: database,
        GATEWAY_SERVICE_KEY: randomBytes(32).toString("hex"),
        GATEWAY_API_KEY_PEPPER: randomBytes(32).toString("hex"),
        GATEWAY_ENCRYPTION_KEY: randomBytes(32).toString("hex"),
      })!;
      const store = new GatewayStore(client, db, config);
      await migrate(store);
      await migrate(store);
      const app = await createApplication(store, {
        ownerUserId: identities.merchant.userId,
        walletId: identities.merchant.walletId,
        name: "Financial tests",
        domains: [],
        idempotencyKey: randomUUID(),
        requestFingerprint: "fixture",
      });
      const principal: Principal = {
        app,
        credential: { publicId: "" },
        internal: true,
      };
      const make = async (amount = "1.0000", priceId = "") =>
        checkout(
          store,
          principal,
          {
            subtotal: amount,
            currency: "LMA",
            description: "Integration payment",
            price_id: priceId,
          },
          randomUUID(),
        );
      const authorize = async (p: Payment, who = identities.payer) =>
        approve(store, {
          paymentId: p.publicId,
          ownerUserId: who.userId,
          walletId: who.walletId,
          sessionId: who.sessionId,
          intentHash: p.intentHash,
          idempotencyKey: randomUUID(),
          proof: {
            kind: "none",
            timeStep: 0,
            passwordChangedAt: null,
            twoFactorEnabledAt: null,
            credentialId: "",
            verifiedHashes: [],
            remainingHashes: [],
          },
          recurringConsent: !!p.interval,
          policyVersion: p.interval ? "2026-10-08" : "",
        });
      const pay = async (p: Payment) => {
        const a = await authorize(p);
        return confirm(
          store,
          identities.payer.userId,
          p.publicId,
          a.publicId,
          p.intentHash,
        );
      };
      await suite.test(
        "Go-created numeric metadata replays from MongoDB without a second checkout",
        async () => {
          const key = randomUUID();
          const body = {
            subtotal: "50.0000",
            currency: "LMA",
            metadata: { "9": "nine", "10": "ten" },
          };
          const existing = await checkout(store, principal, body, key);
          const goJSON =
            '{"subtotal":"50.0000","tax":"0","currency":"LMA","description":"","success_url":"","cancel_url":"","price_id":"","metadata":{"10":"ten","9":"nine"}}';
          await db
            .collection("gateway_payments")
            .updateOne(
              { publicId: existing.publicId },
              {
                $set: {
                  requestFingerprint: createHash("sha256")
                    .update(goJSON)
                    .digest("hex"),
                },
              },
            );
          assert.equal(
            (await checkout(store, principal, body, key)).publicId,
            existing.publicId,
          );
          assert.equal(
            await db
              .collection("gateway_payments")
              .countDocuments({
                applicationId: app.publicId,
                idempotencyKey: key,
              }),
            1,
          );
          await assert.rejects(
            checkout(store, principal, { ...body, subtotal: "100.0000" }, key),
            { code: "idempotency_key_reused" },
          );
        },
      );
      await suite.test(
        "insufficient funds leave balances, approval and journal unchanged",
        async () => {
          const before = await db
            .collection("ledger_accounts")
            .find({
              walletId: {
                $in: [identities.payer.walletId, identities.merchant.walletId],
              },
            })
            .sort({ publicId: 1 })
            .toArray();
          const p = await make("1000.0000"),
            a = await authorize(p);
          await assert.rejects(
            confirm(
              store,
              identities.payer.userId,
              p.publicId,
              a.publicId,
              p.intentHash,
            ),
            { code: "insufficient_funds" },
          );
          const after = await db
            .collection("ledger_accounts")
            .find({
              walletId: {
                $in: [identities.payer.walletId, identities.merchant.walletId],
              },
            })
            .sort({ publicId: 1 })
            .toArray();
          assert.deepEqual(after, before);
          assert.equal(
            (
              await db
                .collection("gateway_approvals")
                .findOne({ publicId: a.publicId })
            )?.["consumed"],
            false,
          );
          assert.equal(
            await db
              .collection("transactions")
              .countDocuments({ paymentId: p.publicId }),
            0,
          );
          assert.equal(
            (await payment(store, "", p.publicId)).status,
            "requires_action",
          );
        },
      );
      await suite.test(
        "simultaneous confirmations, replay and partial refunds never duplicate a journal",
        async () => {
          const p = await make("10.0000"),
            a = await authorize(p);
          const results = await Promise.allSettled(
            Array.from({ length: 8 }, () =>
              confirm(
                store,
                identities.payer.userId,
                p.publicId,
                a.publicId,
                p.intentHash,
              ),
            ),
          );
          assert.ok(results.some((r) => r.status === "fulfilled"));
          const paid = await confirm(
            store,
            identities.payer.userId,
            p.publicId,
            a.publicId,
            p.intentHash,
          );
          assert.equal(paid.status, "succeeded");
          assert.equal(
            await db.collection("transactions").countDocuments({
              type: "merchant_payment",
              paymentId: p.publicId,
            }),
            1,
          );
          const key = randomUUID();
          const refunds = await Promise.allSettled(
            Array.from({ length: 5 }, () =>
              refundRequest(store, principal, p.publicId, "1", key, "reason"),
            ),
          );
          assert.ok(refunds.some((r) => r.status === "fulfilled"));
          const r = await refundRequest(
            store,
            principal,
            p.publicId,
            "1",
            key,
            "reason",
          );
          assert.equal(r.status, "succeeded");
          assert.equal(
            await db.collection("transactions").countDocuments({
              type: "merchant_refund",
              operationId: r.publicId,
            }),
            1,
          );
          assert.equal(
            (await payment(store, "", p.publicId)).refundedMinor,
            10000,
          );
          await assert.rejects(
            () =>
              refundRequest(store, principal, p.publicId, "2", key, "reason"),
            { code: "idempotency_key_reused" },
          );
          await assert.rejects(
            () =>
              refundRequest(
                store,
                principal,
                p.publicId,
                "10",
                randomUUID(),
                "",
              ),
            { code: "refund_limit_exceeded" },
          );
        },
      );
      await suite.test(
        "frozen payer and expired approval roll back every balance and consumed flag",
        async () => {
          const p = await make(),
            a = await authorize(p);
          await db
            .collection("wallets")
            .updateOne(
              { publicId: identities.payer.walletId },
              { $set: { status: "frozen" } },
            );
          await assert.rejects(
            () =>
              confirm(
                store,
                identities.payer.userId,
                p.publicId,
                a.publicId,
                p.intentHash,
              ),
            { code: "wallet_frozen_or_unowned" },
          );
          assert.equal(
            (
              await db
                .collection("gateway_approvals")
                .findOne({ publicId: a.publicId })
            )?.["consumed"],
            false,
          );
          assert.equal(
            await db
              .collection("transactions")
              .countDocuments({ paymentId: p.publicId }),
            0,
          );
          await db
            .collection("wallets")
            .updateOne(
              { publicId: identities.payer.walletId },
              { $set: { status: "active" } },
            );
          await db
            .collection("gateway_approvals")
            .updateOne(
              { publicId: a.publicId },
              { $set: { expiresAt: new Date(0) } },
            );
          await assert.rejects(
            () =>
              confirm(
                store,
                identities.payer.userId,
                p.publicId,
                a.publicId,
                p.intentHash,
              ),
            { code: "approval_expired_or_used" },
          );
        },
      );
      await suite.test(
        "live authorization rejects revoked sessions and changed credentials",
        async () => {
          const p = await make(),
            a = await authorize(p);
          config.environment = "live";
          await db
            .collection("sessions")
            .updateOne(
              { publicId: a.sessionId },
              { $set: { status: "revoked" } },
            );
          await assert.rejects(
            () =>
              confirm(
                store,
                a.ownerUserId,
                p.publicId,
                a.publicId,
                p.intentHash,
              ),
            { code: "session_revoked" },
          );
          await db
            .collection("sessions")
            .updateOne(
              { publicId: a.sessionId },
              { $set: { status: "active" } },
            );
          await db.collection("transfer_password_credentials").insertOne({
            ownerUserId: a.ownerUserId,
            passwordHash: "fixture",
            changedAt: new Date(),
          });
          await assert.rejects(
            () =>
              confirm(
                store,
                a.ownerUserId,
                p.publicId,
                a.publicId,
                p.intentHash,
              ),
            { code: "credential_changed" },
          );
          await db
            .collection("transfer_password_credentials")
            .deleteOne({ ownerUserId: a.ownerUserId });
          config.environment = "test";
        },
      );
      await suite.test(
        "recurring consent, unique invoices, stale lease fencing and cancellation",
        async () => {
          const product = await resourceRequest(
            store,
            principal,
            "products",
            "",
            "",
            "POST",
            "",
            "",
            { name: "Recurring" },
          );
          const price = await resourceRequest(
            store,
            principal,
            "prices",
            "",
            "",
            "POST",
            "",
            "",
            {
              product_id: product["id"],
              amount: "2",
              currency: "LMA",
              interval: "month",
            },
          );
          const paid = await pay(await make("2", String(price["id"])));
          assert.ok(paid.subscriptionId);
          const due = new Date(Date.now() - 1000);
          await db
            .collection("gateway_subscriptions")
            .updateOne(
              { publicId: paid.subscriptionId },
              { $set: { dueAt: due } },
            );
          await Promise.all([
            schedule(store, new Date()),
            schedule(store, new Date()),
          ]);
          assert.equal(
            await db.collection("gateway_invoices").countDocuments({
              subscriptionId: paid.subscriptionId,
              cycle: 1,
            }),
            1,
          );
          const first = await claimInvoice(store, new Date());
          assert.ok(first);
          await db
            .collection("gateway_invoices")
            .updateOne(
              { publicId: first.publicId },
              { $set: { leaseUntil: new Date(0) } },
            );
          const second = await claimInvoice(store, new Date());
          assert.ok(second && second.fence > first.fence);
          await assert.rejects(() => renew(store, first, new Date()), {
            code: "invoice_claim_lost",
          });
          await renew(store, second, new Date());
          await renew(store, second, new Date());
          assert.equal(
            (
              await db
                .collection("gateway_invoices")
                .findOne({ publicId: second.publicId })
            )?.["status"],
            "paid",
          );
          assert.equal(
            await db
              .collection("transactions")
              .countDocuments({ paymentId: second.paymentId }),
            1,
          );
          await cancelSubscription(store, {
            applicationId: app.publicId,
            ownerUserId: "",
            id: paid.subscriptionId,
            atPeriodEnd: false,
          });
          await db
            .collection("gateway_subscriptions")
            .updateOne(
              { publicId: paid.subscriptionId },
              { $set: { dueAt: new Date(0) } },
            );
          await schedule(store, new Date());
          assert.equal(
            await db.collection("gateway_invoices").countDocuments({
              subscriptionId: paid.subscriptionId,
              cycle: 2,
            }),
            0,
          );
        },
      );
      await suite.test(
        "webhook expansion is idempotent and stale workers cannot finish reclaimed deliveries",
        async () => {
          await resourceRequest(
            store,
            principal,
            "webhooks",
            "",
            "",
            "POST",
            "",
            "",
            { url: "https://example.com/hook", events: ["payment.succeeded"] },
          );
          await expandEvents(store, new Date());
          await expandEvents(store, new Date());
          const claim = await claimDelivery(store, new Date());
          assert.ok(claim);
          await db
            .collection("gateway_deliveries")
            .updateOne(
              { publicId: claim.publicId },
              { $set: { leaseUntil: new Date(0), dueAt: new Date(0) } },
            );
          const next = await claimDelivery(store, new Date());
          assert.ok(next && next.publicId === claim.publicId);
          await assert.rejects(
            () => finishDelivery(store, claim, 200, new Date()),
            { code: "delivery_claim_lost" },
          );
          await finishDelivery(store, next, 200, new Date());
          await assert.rejects(
            () => retryDelivery(store, app.publicId, next.publicId),
            { code: "delivery_not_retryable" },
          );
          const duplicates = await db
            .collection("gateway_deliveries")
            .aggregate([
              {
                $group: {
                  _id: { event: "$eventId", endpoint: "$endpointId" },
                  n: { $sum: 1 },
                },
              },
              { $match: { n: { $gt: 1 } } },
            ])
            .toArray();
          assert.equal(duplicates.length, 0);
        },
      );
      const report = await reconcileLedger({
        collections: getCollections(db),
        mongoClient: client,
      });
      assert.equal(report.ok, true, JSON.stringify(report));
    } finally {
      await db.dropDatabase();
      await client.close();
    }
  },
);
