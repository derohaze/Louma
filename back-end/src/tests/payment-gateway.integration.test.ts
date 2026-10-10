import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { MongoClient, ObjectId } from "mongodb";
import { buildApp } from "../app.js";
import { loadConfig } from "../config/env.js";
import { getCollections } from "../infrastructure/mongodb/collections.js";
import { schemas } from "../infrastructure/mongodb/schemas.js";
import { ensureCollection } from "../infrastructure/mongodb/validators.js";
import { ensureDatabaseIndexes } from "../infrastructure/mongodb/indexes.js";
import { disabledRedis } from "../infrastructure/redis/client.js";
import { ensureFeeAccount } from "../modules/wallets/service.js";
import { verifyAccessToken } from "../modules/security/access-token.js";
import { gatewayInternalRequest } from "../../payment-gateway/transport.js";
import { migrate } from "../../payment-gateway/infrastructure/migrations.js";
import { GatewayStore } from "../../payment-gateway/infrastructure/store.js";

const mongoUri = process.env["PAYMENT_GATEWAY_E2E_MONGO_URI"];
const configured = !!mongoUri;

interface TestAccount { id: string; walletId: string; address: string; token: string; csrf: string; email: string; password: string }
interface HttpOutcome { status: number; payload: Record<string, unknown> }

test("real Node identity and embedded gateway preserve consent, isolation, settlement, and replay", { skip: !configured, timeout: 90_000 }, async (suite) => {
  assert.ok(mongoUri);
  const database = `louma_gateway_test_${randomUUID().replaceAll("-", "")}`;
  assert.match(mongoUri, /^mongodb:\/\/(?:127\.0\.0\.1|localhost):\d+(?:\/|\?)/, "Financial tests require an explicitly local replica set");
  assert.match(database, /^louma_gateway_test_[a-zA-Z0-9_]+$/, "Financial tests require an isolated test database");
  const config = loadConfig({ NODE_ENV: "test", MONGODB_URI: mongoUri, MONGODB_DATABASE: database, ACCESS_TOKEN_SECRET: Buffer.alloc(32, 17).toString("base64"), APP_ENCRYPTION_KEY: Buffer.alloc(32, 29).toString("base64"), GATEWAY_ENABLED: "true", GATEWAY_ENVIRONMENT: "test", GATEWAY_SERVICE_KEY: "s".repeat(32), GATEWAY_API_KEY_PEPPER: "p".repeat(32), GATEWAY_ENCRYPTION_KEY: "ab".repeat(32), FRONTEND_ORIGINS: "http://localhost:3000", MINING_ENABLED: "false" });
  const client = new MongoClient(mongoUri);
  await client.connect();
  const db = client.db(database);
  for (const [name, validator] of Object.entries(schemas)) await ensureCollection(db, name, validator);
  await ensureDatabaseIndexes(db, { retentionTtlEnabled: false });
  assert.ok(config.embeddedGateway);
  const gatewayStore = new GatewayStore(client, db, config.embeddedGateway);
  await migrate(gatewayStore);
  const collections = getCollections(db);
  const app = await buildApp({ config, collections, mongoClient: client, redis: disabledRedis(), logger: false });
  await app.listen({ host: "127.0.0.1", port: 0 });
  const address = app.server.address();
  assert.ok(address && typeof address === "object");
  const nodeUrl = `http://127.0.0.1:${address.port}`;
  const gatewayUrl = nodeUrl;
  config.embeddedGateway.publicUrl = nodeUrl;
  const request = async (method: string, path: string, options: { account?: TestAccount; body?: unknown; key?: string; csrf?: string } = {}): Promise<HttpOutcome> => {
    const response = await fetch(`${nodeUrl}${path}`, { method, headers: { "Content-Type": "application/json", ...(options.account ? { Authorization: `Bearer ${options.account.token}`, "X-CSRF-Token": options.csrf ?? options.account.csrf } : {}), ...(options.key ? { "Idempotency-Key": options.key } : {}) }, ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }) });
    return { status: response.status, payload: await response.json() as Record<string, unknown> };
  };
  const expectStatus = (response: HttpOutcome, expected: number) => assert.equal(response.status, expected, JSON.stringify(response.payload["error"] ?? { status: response.status }));
  const register = async (label: string): Promise<TestAccount> => {
    const email = `gateway-${label}-${randomUUID()}@example.test`;
    const password = `Gateway!${randomUUID()}`;
    const csrfResponse = await request("GET", "/api/v1/auth/csrf");
    const response = await fetch(`${nodeUrl}/api/v1/auth/register`, { method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": String(csrfResponse.payload["csrfToken"]) }, body: JSON.stringify({ email, password, displayName: label }) });
    assert.equal(response.status, 201);
    const session = await response.json() as { user: { id: string }; wallet: { id: string; address: string }; accessToken: string; csrfToken: string };
    return { id: session.user.id, walletId: session.wallet.id, address: session.wallet.address, token: session.accessToken, csrf: session.csrfToken, email, password };
  };
  const merchant = await register("Merchant");
  const payer = await register("Payer");
  const outsider = await register("Outsider");
  const walletBalance = async (account: TestAccount) => (await collections.ledgerAccounts.findOne({ walletId: account.walletId, accountType: "wallet" }))!.balanceMinor;
  const resource = (applicationId: string, name: string, payload: unknown, key = randomUUID()) => request("POST", `/api/v1/developer/applications/${applicationId}/${name}`, { account: merchant, key, body: { mode: "test", payload } });
  const fundingId = randomUUID();
  await ensureFeeAccount(collections);
  await collections.ledgerAccounts.updateOne({ accountType: "system_treasury", currency: "LMA" }, { $setOnInsert: { publicId: randomUUID(), walletId: null, accountType: "system_treasury", currency: "LMA", balanceMinor: 0, createdAt: new Date() } }, { upsert: true });
  const treasury = await collections.ledgerAccounts.findOne({ accountType: "system_treasury" });
  const payerLedger = await collections.ledgerAccounts.findOne({ walletId: payer.walletId, accountType: "wallet" });
  assert.ok(treasury && payerLedger);
  const fundingSession = client.startSession();
  try { await fundingSession.withTransaction(async () => {
    const now = new Date();
    await collections.transactions.insertOne({ _id: new ObjectId(), publicId: fundingId, type: "mining", currency: "LMA", status: "completed", ownerUserId: payer.id, walletId: payer.walletId, miningSessionId: randomUUID(), sequenceNumber: 1, amountMinor: 500_000, treasuryAccountId: treasury.publicId, walletAccountId: payerLedger.publicId, idempotencyKey: `smoke-funding-${fundingId}`, correlationId: `smoke-funding-${fundingId}`, createdAt: now, completedAt: now }, { session: fundingSession });
    await collections.ledgerEntries.insertMany([
      { _id: new ObjectId(), publicId: randomUUID(), transactionId: fundingId, lineNumber: 1, walletId: null, ledgerAccountId: treasury.publicId, side: "debit", amountMinor: 500_000, currency: "LMA", correlationId: `smoke-funding-${fundingId}`, createdAt: now },
      { _id: new ObjectId(), publicId: randomUUID(), transactionId: fundingId, lineNumber: 2, walletId: payer.walletId, ledgerAccountId: payerLedger.publicId, side: "credit", amountMinor: 500_000, currency: "LMA", correlationId: `smoke-funding-${fundingId}`, createdAt: now },
    ], { session: fundingSession });
    await collections.ledgerAccounts.updateMany({ publicId: { $in: [treasury.publicId, payerLedger.publicId] } }, { $inc: { balanceMinor: 500_000 } }, { session: fundingSession });
  }, { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" } }); } finally { await fundingSession.endSession(); }
  let applicationId = "";
  let paymentId = "";
  let paymentIntent = "";
  let credentialId = "";
  let merchantApiKey = "";
  let recurringPriceId = "";
  const paymentRequestKey = randomUUID();
  try {
    await suite.test("developer eligibility is explicit and every Node dashboard request enforces it", async () => {
      expectStatus(await request("GET", "/api/v1/developer/applications?mode=test", { account: outsider }), 403);
      await db.collection("gateway_developers").insertOne({ ownerUserId: merchant.id, status: "active", updatedAt: new Date() });
      const access = await request("GET", "/api/v1/developer/access", { account: merchant });
      expectStatus(access, 200);
      assert.equal(access.payload["eligible"], true);
      assert.equal(access.payload["mode"], "test");
      assert.equal(access.payload["available"], true);
      expectStatus(await request("POST", "/api/v1/developer/applications", { account: merchant, key: randomUUID(), body: { mode: "test", name: "Forbidden wallet", wallet_id: outsider.walletId, domains: [] } }), 403);
      const creationKey = randomUUID();
      const creation = { mode: "test", name: "Gateway integration merchant", wallet_id: merchant.walletId, domains: ["localhost:3000"] };
      const created = await request("POST", "/api/v1/developer/applications", { account: merchant, key: creationKey, body: creation });
      expectStatus(created, 201);
      applicationId = String(created.payload["id"]);
      const replay = await request("POST", "/api/v1/developer/applications", { account: merchant, key: creationKey, body: creation });
      expectStatus(replay, 201);
      assert.equal(replay.payload["id"], applicationId);
      expectStatus(await request("POST", "/api/v1/developer/applications", { account: merchant, key: creationKey, body: { ...creation, name: "Changed creation intent" } }), 409);
      expectStatus(await request("PATCH", `/api/v1/developer/applications/${applicationId}`, { account: merchant, body: { mode: "test", wallet_id: outsider.walletId } }), 403);
      const saved = await request("PATCH", `/api/v1/developer/applications/${applicationId}`, { account: merchant, body: { mode: "test", name: "Verified merchant", domains: ["localhost:3000"], wallet_id: merchant.walletId } });
      expectStatus(saved, 200);
      assert.equal(saved.payload["name"], "Verified merchant");
      assert.equal(saved.payload["receiving_wallet_id"], merchant.walletId);
    });
    await suite.test("scoped secret credentials and immutable checkout intents reach real gateway HTTP", async () => {
      const createdKey = await resource(applicationId, "credentials", { scopes: ["checkout:create", "payments:read"] });
      expectStatus(createdKey, 201);
      credentialId = String(createdKey.payload["id"]);
      assert.equal(typeof (createdKey.payload["secret"] ?? createdKey.payload["api_key"]), "string");
      merchantApiKey = String(createdKey.payload["secret"] ?? createdKey.payload["api_key"]);
      const created = await resource(applicationId, "checkouts", { subtotal: "10.0000", tax: "0.0000", currency: "LMA", description: "Real Node module checkout" });
      expectStatus(created, 201);
      paymentId = String(created.payload["id"]);
      paymentIntent = String(created.payload["intent_hash"]);
      assert.equal(created.payload["total"], "10.0000");
      assert.equal(created.payload["fee"], "0.1000");
      assert.equal(created.payload["merchant_net"], "9.9000");
    });
    await suite.test("cross-merchant resources, CSRF, mismatched intent, and wallet freezes reject", async () => {
      await db.collection("gateway_developers").insertOne({ ownerUserId: outsider.id, status: "active", updatedAt: new Date() });
      expectStatus(await request("GET", `/api/v1/developer/applications/${applicationId}/payments?mode=test`, { account: outsider }), 404);
      expectStatus(await request("POST", `/api/v1/developer/credentials/${credentialId}/revoke`, { account: outsider, key: randomUUID(), body: { mode: "test" } }), 404);
      expectStatus(await request("POST", `/api/v1/payments/checkout/${paymentId}/confirm`, { account: payer, csrf: "invalid", key: paymentRequestKey, body: { mode: "test", intent_hash: paymentIntent } }), 403);
      expectStatus(await request("POST", `/api/v1/payments/checkout/${paymentId}/confirm`, { account: payer, key: paymentRequestKey, body: { mode: "test", intent_hash: "0".repeat(64) } }), 409);
      expectStatus(await request("POST", "/api/v1/security/freeze", { account: payer, body: {} }), 200);
      expectStatus(await request("POST", `/api/v1/payments/checkout/${paymentId}/confirm`, { account: payer, key: paymentRequestKey, body: { mode: "test", intent_hash: paymentIntent } }), 403);
      expectStatus(await request("POST", "/api/v1/security/unfreeze", { account: payer, body: { password: payer.password } }), 200);
      assert.equal(await walletBalance(payer), 500_000);
    });
    await suite.test("pending approval retries bind the current session, wallet, consent, policy, and expiry", async () => {
      const claims = await verifyAccessToken(payer.token, config.accessTokenSecret);
      const approval = await gatewayInternalRequest(gatewayStore, { ownerUserId: payer.id, method: "POST", path: "/internal/v1/approvals", body: { payment_id: paymentId, owner_user_id: payer.id, wallet_id: payer.walletId, session_id: claims.sessionId, intent_hash: paymentIntent, idempotency_key: paymentRequestKey, recurring_consent: false, policy_version: "", proof: { kind: "none", passwordChangedAt: null, twoFactorEnabledAt: null } } });
      const retry = (additional: Record<string, unknown> = {}) => request("POST", `/api/v1/payments/checkout/${paymentId}/confirm`, { account: payer, key: paymentRequestKey, body: { mode: "test", intent_hash: paymentIntent, ...additional } });
      expectStatus(await retry({ recurring_consent: true }), 409);
      expectStatus(await retry({ policy_version: "changed" }), 409);
      await db.collection("gateway_approvals").updateOne({ publicId: approval["id"] }, { $set: { sessionId: randomUUID() } });
      expectStatus(await retry(), 409);
      await db.collection("gateway_approvals").updateOne({ publicId: approval["id"] }, { $set: { sessionId: claims.sessionId, walletId: outsider.walletId } });
      expectStatus(await retry(), 409);
      await db.collection("gateway_approvals").updateOne({ publicId: approval["id"] }, { $set: { walletId: payer.walletId, expiresAt: new Date(Date.now() - 1_000) } });
      expectStatus(await retry(), 409);
      await db.collection("gateway_approvals").updateOne({ publicId: approval["id"] }, { $set: { expiresAt: new Date(String(approval["expires_at"])) } });
      assert.equal(await walletBalance(payer), 500_000);
      assert.equal(await collections.transactions.countDocuments({ paymentId }), 0);
    });
    await suite.test("settlement and concurrent duplicate Node confirmations post exactly one balanced gateway journal", async () => {
      const paid = await request("POST", `/api/v1/payments/checkout/${paymentId}/confirm`, { account: payer, key: paymentRequestKey, body: { mode: "test", intent_hash: paymentIntent } });
      expectStatus(paid, 200);
      assert.equal(paid.payload["status"], "succeeded");
      const repeated = await Promise.all([1, 2, 3].map(() => request("POST", `/api/v1/payments/checkout/${paymentId}/confirm`, { account: payer, key: paymentRequestKey, body: { mode: "test", intent_hash: paymentIntent } })));
      for (const duplicate of repeated) expectStatus(duplicate, 200);
      assert.equal(await walletBalance(payer), 400_000);
      assert.equal(await walletBalance(merchant), 99_000);
      const headers = await collections.transactions.find({ type: "merchant_payment", paymentId }).toArray();
      assert.equal(headers.length, 1);
      const entries = await collections.ledgerEntries.find({ transactionId: headers[0]!.publicId }).toArray();
      assert.equal(entries.length, 3);
      assert.equal(entries.filter((entry) => entry.side === "debit").reduce((sum, entry) => sum + entry.amountMinor, 0), entries.filter((entry) => entry.side === "credit").reduce((sum, entry) => sum + entry.amountMinor, 0));
      expectStatus(await request("POST", `/api/v1/payments/checkout/${paymentId}/confirm`, { account: outsider, key: paymentRequestKey, body: { mode: "test", intent_hash: paymentIntent } }), 404);
    });
    await suite.test("credential metadata never redisplays secrets and revocation is durable", async () => {
      const listed = await request("GET", `/api/v1/developer/applications/${applicationId}/credentials?mode=test`, { account: merchant });
      expectStatus(listed, 200);
      for (const credential of listed.payload["data"] as Record<string, unknown>[]) { assert.equal(credential["secret"], undefined); assert.equal(credential["api_key"], undefined); assert.equal(credential["hash"], undefined); }
      const authorized = await fetch(`${gatewayUrl}/v1/payments/${paymentId}`, { headers: { Authorization: `Bearer ${merchantApiKey}` } });
      assert.equal(authorized.status, 200);
      expectStatus(await request("POST", `/api/v1/developer/credentials/${credentialId}/revoke`, { account: merchant, key: randomUUID(), body: { mode: "test" } }), 200);
      const revoked = await fetch(`${gatewayUrl}/v1/payments/${paymentId}`, { headers: { Authorization: `Bearer ${merchantApiKey}` } });
      assert.equal(revoked.status, 401);
    });
    await suite.test("products, recurring prices, checkout consent, and subscription cancellation use real gateway state", async () => {
      const product = await resource(applicationId, "products", { name: "Monthly test service", description: "Synthetic subscription" });
      expectStatus(product, 201);
      const price = await resource(applicationId, "prices", { product_id: product.payload["id"], amount: "2.0000", currency: "LMA", interval: "monthly" });
      expectStatus(price, 201);
      assert.equal(price.payload["amount_minor"], 20_000);
      recurringPriceId = String(price.payload["id"]);
      const recurring = await resource(applicationId, "checkouts", { subtotal: "2.0000", tax: "0", currency: "LMA", description: "Monthly authorization", price_id: price.payload["id"] });
      expectStatus(recurring, 201);
      const recurringDetails = recurring.payload["recurring"] as { consent_policy_version: string };
      const terms = { mode: "test", intent_hash: recurring.payload["intent_hash"], recurring_consent: true, policy_version: recurringDetails.consent_policy_version };
      const paid = await request("POST", `/api/v1/payments/checkout/${String(recurring.payload["id"])}/confirm`, { account: payer, key: randomUUID(), body: terms });
      expectStatus(paid, 200);
      const subscribed = await request("GET", `/api/v1/developer/applications/${applicationId}/subscriptions?mode=test`, { account: merchant });
      expectStatus(subscribed, 200);
      const subscription = (subscribed.payload["data"] as { id: string }[])[0];
      assert.ok(subscription);
      expectStatus(await request("POST", `/api/v1/developer/subscriptions/${subscription.id}/cancel`, { account: merchant, key: randomUUID(), body: { mode: "test", at_period_end: true } }), 200);
      const cancellationKey = randomUUID();
      const cancellationPath = `/api/v1/payments/subscriptions/${subscription.id}/cancel`;
      expectStatus(await request("POST", cancellationPath, { account: outsider, key: cancellationKey, body: { mode: "test" } }), 404);
      expectStatus(await request("POST", cancellationPath, { account: payer, csrf: "invalid", key: cancellationKey, body: { mode: "test" } }), 403);
      expectStatus(await request("POST", cancellationPath, { account: payer, key: cancellationKey, body: { mode: "test" } }), 200);
      expectStatus(await request("POST", cancellationPath, { account: payer, key: cancellationKey, body: { mode: "test" } }), 200);
      assert.equal((await db.collection("gateway_subscriptions").findOne({ publicId: subscription.id }))?.["mandateActive"], false);
    });
    await suite.test("payment links return usable URLs and disabling a link blocks new checkout", async () => {
      const created = await resource(applicationId, "links", { subtotal: "1.2500", tax: "0", currency: "LMA", description: "Reusable integration link" });
      expectStatus(created, 201);
      const linkUrl = String(created.payload["url"]);
      assert.equal(new URL(linkUrl).pathname, `/pay/${String(created.payload["id"])}`);
      const active = await fetch(linkUrl, { redirect: "manual" });
      assert.equal(active.status, 303);
      expectStatus(await request("POST", `/api/v1/developer/links/${String(created.payload["id"])}/disable`, { account: merchant, key: randomUUID(), body: { mode: "test" } }), 200);
      assert.equal((await fetch(linkUrl, { redirect: "manual" })).status, 404);
    });
    await suite.test("usage summary is application scoped and reflects authenticated API activity", async () => {
      const summary = await request("GET", `/api/v1/developer/applications/${applicationId}/usage?mode=test`, { account: merchant });
      expectStatus(summary, 200);
      assert.equal(summary.payload["environment"], "test");
      assert.equal(typeof summary.payload["requests"], "number");
      assert.equal(typeof summary.payload["errors"], "number");
      assert.equal(typeof summary.payload["rate_limit_per_minute"], "number");
      assert.ok(Number(summary.payload["requests"]) >= 1);
      expectStatus(await request("GET", `/api/v1/developer/applications/${applicationId}/usage?mode=test`, { account: outsider }), 404);
    });
    await suite.test("refund and SSRF rejection use gateway-owned authorization and financial records", async () => {
      const refund = await resource(applicationId, "refunds", { payment_id: paymentId, amount: "1.0000", reason: "Integration refund" });
      expectStatus(refund, 201);
      assert.equal(refund.payload["status"], "succeeded");
      assert.equal(await walletBalance(payer), 390_000);
      expectStatus(await resource(applicationId, "webhooks", { url: "http://127.0.0.1:27177/private", events: ["payment.succeeded"] }), 400);
    });
    await suite.test("developer revocation stops new dashboard operations immediately", async () => {
      await db.collection("gateway_developers").updateOne({ ownerUserId: outsider.id }, { $set: { status: "suspended" } });
      expectStatus(await request("GET", "/api/v1/developer/applications?mode=test", { account: outsider }), 403);
      const created = await resource(applicationId, "checkouts", { subtotal: "3.2500", tax: "0", currency: "LMA", description: "Browser payment verification" });
      expectStatus(created, 201);
      assert.equal(typeof created.payload["id"], "string");
      const recurring = await resource(applicationId, "checkouts", { subtotal: "2.0000", tax: "0", currency: "LMA", description: "Browser recurring consent verification", price_id: recurringPriceId });
      expectStatus(recurring, 201);
      assert.equal(typeof recurring.payload["id"], "string");
    });
    await suite.test("hosted checkout escapes merchant input and internal approval HTTP is absent", async () => {
      const response = await fetch(`${nodeUrl}/checkout/${paymentId}?lang=ar`);
      assert.equal(response.status, 200);
      assert.match(response.headers.get("content-security-policy") ?? "", /frame-ancestors 'none'/);
      assert.match(await response.text(), /تم الدفع بنجاح/);
      const unsafeDescription = await resource(applicationId, "checkouts", { subtotal: "1", currency: "LMA", description: "<script>window.x=1</script>&" });
      expectStatus(unsafeDescription, 201);
      const escapedPage = await (await fetch(`${nodeUrl}/checkout/${String(unsafeDescription.payload["id"])}`)).text();
      assert.match(escapedPage, /&lt;script&gt;window.x=1&lt;\/script&gt;&amp;/);
      assert.doesNotMatch(escapedPage, /<script>/);
      assert.equal((await fetch(`${nodeUrl}/internal/v1/approvals`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).status, 404);
    });
    await suite.test("real Python SDK responses conform to the shipped public OpenAPI", async () => {
      const credential = await resource(applicationId, "credentials", { scopes: ["checkout:create", "payments:read", "refunds:create", "subscriptions:manage", "products:manage", "webhooks:manage", "credentials:manage"] });
      expectStatus(credential, 201);
      const temporaryRoot = resolve(".temp");
      await mkdir(temporaryRoot, { recursive: true });
      const temporary = await mkdtemp(join(temporaryRoot, "gateway-contract-"));
      try {
        const keyFile = join(temporary, "merchant-key.txt");
        await writeFile(keyFile, String(credential.payload["api_key"]), { mode: 0o600 });
        const result = await promisify(execFile)("python", ["payment-gateway/tests/sdk-openapi.test.py"], { windowsHide: true, env: { ...process.env, LMA_API_KEY_FILE: keyFile, LMA_BASE_URL: nodeUrl } });
        assert.match(result.stderr, /OK/);
        assert.doesNotMatch(result.stderr, /skipped/);
      } finally {
        if (!temporary.startsWith(temporaryRoot + "/") && !temporary.startsWith(temporaryRoot + "\\")) throw new Error("Unexpected temporary fixture path");
        await rm(temporary, { recursive: true });
      }
    });
  } finally { await app.close(); await db.dropDatabase(); await client.close(); }
});
