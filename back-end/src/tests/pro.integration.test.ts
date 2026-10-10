import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { ObjectId, type Db, type MongoClient } from "mongodb";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { loadConfig, type AppConfig } from "../config/env.js";
import { connectMongo } from "../infrastructure/mongodb/client.js";
import { getCollections, type Collections } from "../infrastructure/mongodb/collections.js";
import { ensureDatabaseIndexes } from "../infrastructure/mongodb/indexes.js";
import { disabledRedis } from "../infrastructure/redis/client.js";
import { register } from "../modules/auth/service.js";
import { getSubscription, grantSubscription, sweepSubscriptions } from "../modules/subscriptions/service.js";
import { setCustomAddress, resolveRecipient, ensureTreasuryAccount } from "../modules/wallets/service.js";
import { subscriptionTransaction } from "../infrastructure/mongodb/subscription-repository.js";
import { reconcileLedger, TEST_FUNDING_CORRELATION_PREFIXES } from "../modules/ledger/reconciliation.js";
import { previewTransfer, createTransfer } from "../modules/transfers/service.js";
import { sessionCsrfToken } from "../modules/security/csrf.js";
import { setTransferPassword } from "../modules/security/service.js";
import type { MiningSessionRecord } from "../shared/types.js";

// Only this newly created disposable database is touched, including validators/index installation.
const databaseName = `louma_pro_test_${randomUUID().replaceAll("-", "").slice(0, 20)}`;
let config: AppConfig, client: MongoClient, db: Db, collections: Collections, app: FastifyInstance;
type Account = Awaited<ReturnType<typeof register>>;
let owner: Account, other: Account, free: Account;
const PASSWORD = "ProTest1234";
let ip = 0;
const grant = (account: Account, plan: "monthly" | "yearly" | "lifetime" = "monthly", activationKey = randomUUID()) =>
  grantSubscription({ collections, mongoClient: client, ownerUserId: account.user.id, plan, activationKey, createdBy: "test" });
const setAddress = (account: Account, address: string) => setCustomAddress({ collections, mongoClient: client, ownerUserId: account.user.id, handle: address, requestId: randomUUID() });
const resolve = (address: string) => resolveRecipient({ collections, address, senderWalletId: free.wallet.id });
const call = (account: Account, method: "GET" | "PATCH" | "POST", url: string, payload?: Record<string, unknown>) => app.inject({ method, url,
  remoteAddress: `10.0.1.${++ip}`, headers: { authorization: `Bearer ${account.accessToken}`, "x-csrf-token": sessionCsrfToken(config, account.sessionId) }, ...(payload ? { payload } : {}) });
const makeAccount = () => register({ collections, mongoClient: client, config, email: `pro.${randomUUID()}@example.test`, password: PASSWORD,
  displayName: "Pro Test", requestId: randomUUID(), userAgent: "integration", ipAddress: "127.0.0.1" });

before(async () => {
  config = { ...loadConfig(), mongoDatabase: databaseName };
  const connection = await connectMongo(config, { serverSelectionTimeoutMS: 30000, connectTimeoutMS: 20000 });
  client = connection.client; db = connection.db; collections = getCollections(db);
  await ensureDatabaseIndexes(db);
  app = await buildApp({ config, collections, mongoClient: client, redis: disabledRedis(), logger: false });
  owner = await makeAccount(); other = await makeAccount(); free = await makeAccount();
});
after(async () => {
  if (app) await app.close();
  if (db && db.databaseName === databaseName && databaseName.startsWith("louma_pro_test_")) await db.dropDatabase();
  if (client) await client.close();
});

test("free accounts are blocked on page data and mutation; client cannot grant itself Pro", async () => {
  for (const method of ["GET", "PATCH"] as const) {
    const result = await call(free, method, "/api/v1/wallet/custom-address", method === "PATCH" ? { address: "Ali123" } : undefined);
    assert.equal(result.statusCode, 403); assert.equal(result.json().error.code, "pro_required");
  }
  assert.equal((await call(free, "PATCH", "/api/v1/me", { subscription: { tier: "pro" } })).statusCode, 400);
  assert.equal((await call(free, "POST", "/api/v1/subscription", { plan: "lifetime" })).statusCode, 404);
  assert.equal((await call(free, "GET", "/api/v1/me")).json().user.subscription.tier, "free");
  assert.equal(await collections.walletAddressHistory.countDocuments({}), 0);
});

test("trusted grants, renewals and activation retries preserve subscription history", async () => {
  const key = randomUUID();
  const first = await grant(owner, "monthly", key);
  const currentId = (await collections.subscriptions.findOne({ ownerUserId: owner.user.id }))?.publicId;
  assert.equal(first.tier, "pro"); assert.equal(first.plan, "monthly");
  const retried = await grant(owner, "monthly", key);
  assert.equal(retried.plan, first.plan); assert.equal(retried.expiresAt, first.expiresAt);
  await assert.rejects(() => grant(other, "yearly", key), { code: "activation_key_reused" });
  const second = await grant(owner, "yearly");
  assert.ok(Date.parse(second.expiresAt!) > Date.parse(first.expiresAt!));
  assert.equal(await collections.subscriptions.countDocuments({ ownerUserId: owner.user.id }), 1);
  assert.equal(await collections.subscriptions.countDocuments({ ownerUserId: owner.user.id, status: "active" }), 1);
  assert.equal(await collections.subscriptionGrants.countDocuments({ ownerUserId: owner.user.id }), 2);
  assert.equal((await collections.subscriptions.findOne({ ownerUserId: owner.user.id }))?.publicId, currentId);
  assert.equal((await call(owner, "GET", "/api/v1/me")).json().user.subscription.plan, "yearly");
  await grant(other, "lifetime");
  assert.equal((await getSubscription(collections, other.user.id)).expiresAt, null);
  await assert.rejects(() => grant(other), { code: "lifetime_already_active" });
});

test("an expired current row can be reactivated before the subscription sweep", async () => {
  const account = await makeAccount();
  await grant(account);
  const currentId = (await collections.subscriptions.findOne({ ownerUserId: account.user.id }))?.publicId;
  await collections.subscriptions.updateOne({ ownerUserId: account.user.id }, { $set: { expiresAt: new Date(Date.now() - 1) } });
  const renewed = await grant(account, "yearly");
  assert.equal(renewed.tier, "pro");
  assert.equal((await collections.subscriptions.findOne({ ownerUserId: account.user.id }))?.publicId, currentId);
  assert.equal(await collections.subscriptions.countDocuments({ ownerUserId: account.user.id, status: "active" }), 1);
});

test("validation, case-insensitive uniqueness, immutable canonical address and atomic archives", async () => {
  for (const address of ["ab", "a".repeat(17), "1Ali", "@Ali", "ali_moh", "ali moh", "Ali ", "علي"]) {
    await assert.rejects(() => setAddress(owner, address), { code: "invalid_custom_address" });
  }
  const wallet = await setAddress(owner, "Ali123");
  assert.equal(wallet.customAddress, "ali123"); assert.equal(wallet.address, owner.wallet.address);
  assert.equal((await setAddress(owner, "ALI123")).customAddress, "ali123", "same-address retry does not spend cooldown");
  await assert.rejects(() => setAddress(other, "ALI123"), { code: "address_unavailable" });
  await assert.rejects(() => setAddress(owner, "New123"), { code: "address_change_cooldown" });
  assert.equal((await resolve("ALI123")).publicId, owner.wallet.id);
  assert.equal((await resolve(owner.wallet.address)).publicId, owner.wallet.id);
  const row = await collections.walletAddressHistory.findOne({ ownerUserId: owner.user.id });
  assert.equal(row?.previousAddress, owner.wallet.address); assert.equal(row?.nextAddress, "ali123");
  await collections.wallets.updateOne({ publicId: owner.wallet.id }, { $set: { customAddressChangedAt: new Date(Date.now() - 31 * 86400000) } });
  await setAddress(owner, "New123");
  assert.equal(await collections.walletAddressHistory.countDocuments({ ownerUserId: owner.user.id }), 2);
  await assert.rejects(() => resolve("ali123"), { code: "not_found" });
  assert.equal((await resolve("new123")).publicId, owner.wallet.id);
  const response = await call(other, "GET", "/api/v1/wallet/custom-address");
  assert.equal(response.json().history.length, 0, "history stays scoped to its owner");
});

test("expired alias preview cannot execute using a canonical echo; expiry and reclaim preserve archives", async () => {
  const preview = await previewTransfer({ collections, ownerUserId: free.user.id, recipientAddress: "new123", amount: "1.0000", requestId: randomUUID() });
  assert.ok(preview.authorization);
  await setTransferPassword({ collections, mongoClient: client, ownerUserId: free.user.id, currentPassword: PASSWORD, newPassword: PASSWORD, requestId: randomUUID() });
  await collections.subscriptions.updateOne({ ownerUserId: owner.user.id, status: "active" }, { $set: { startsAt: new Date(Date.now() - 86400000), expiresAt: new Date(Date.now() - 1) } });
  assert.equal((await call(owner, "GET", "/api/v1/me")).json().user.subscription.tier, "free");
  assert.equal((await call(owner, "GET", "/api/v1/wallet")).json().wallet.customAddress, null);
  assert.equal((await call(owner, "GET", "/api/v1/wallet/custom-address")).statusCode, 403);
  await assert.rejects(() => resolve("new123"), { code: "not_found" });
  await assert.rejects(() => createTransfer({ collections, mongoClient: client, ownerUserId: free.user.id, authorizationId: preview.authorization!.id,
    recipientAddress: owner.wallet.address, amount: "1.0000", idempotencyKey: randomUUID(), transferPassword: PASSWORD, requestId: randomUUID() }), { code: "not_found" });
  assert.equal(await collections.transactions.countDocuments({ type: "transfer" }), 0);
  assert.equal((await collections.transferAuthorizations.findOne({ publicId: preview.authorization!.id }))?.consumedAt, null);
  assert.equal((await resolve(owner.wallet.address)).publicId, owner.wallet.id);
  await setAddress(other, "NEW123");
  assert.equal((await resolve("new123")).publicId, other.wallet.id, "available immediately without waiting for sweep");
  const archive = await collections.walletAddressHistory.findOne({ ownerUserId: owner.user.id, reason: "subscription_expired" });
  assert.equal(archive?.previousAddress, "new123"); assert.equal(archive?.nextAddress, owner.wallet.address);
  await sweepSubscriptions({ collections, mongoClient: client, afterAddress: null });
  assert.equal(await collections.walletAddressHistory.countDocuments({ ownerUserId: owner.user.id }), 3, "sweep does not duplicate the release");
});

test("concurrent activation and claims converge through unique constraints", async () => {
  const a = await makeAccount(), b = await makeAccount();
  const key = randomUUID();
  await Promise.all([grant(a, "monthly", key), grant(a, "monthly", key)]);
  assert.equal(await collections.subscriptions.countDocuments({ ownerUserId: a.user.id }), 1);
  await grant(b, "monthly");
  const claims = await Promise.allSettled([setAddress(a, "Race123"), setAddress(b, "RACE123")]);
  assert.equal(claims.filter((row) => row.status === "fulfilled").length, 1);
  assert.equal(claims.filter((row) => row.status === "rejected").length, 1);
  assert.equal(await collections.wallets.countDocuments({ customAddressNormalized: "race123" }), 1);
  assert.equal(await collections.walletAddressHistory.countDocuments({ nextAddress: "race123" }), 1);
});

test("archive failure rolls back the alias and its subscription authorization write", async () => {
  const account = await makeAccount();
  await grant(account);
  const before = await collections.subscriptions.findOne({ ownerUserId: account.user.id, status: "active" });
  assert.ok(before);
  const insert = collections.walletAddressHistory.insertOne;
  collections.walletAddressHistory.insertOne = async () => { throw new Error("Injected archive failure"); };
  try { await assert.rejects(() => setAddress(account, "Archive123"), /Injected archive failure/); }
  finally { collections.walletAddressHistory.insertOne = insert; }
  assert.equal((await collections.wallets.findOne({ publicId: account.wallet.id }))?.customAddress, null);
  assert.equal(await collections.walletAddressHistory.countDocuments({ ownerUserId: account.user.id }), 0);
  assert.equal((await collections.subscriptions.findOne({ ownerUserId: account.user.id, status: "active" }))?.version, before.version);
  assert.equal((await setAddress(account, "Archive123")).customAddress, "archive123", "failed change spent no cooldown");
});

test("active alias transfers balance the ledger; retries replay after expiry; canonical transfers remain usable", async () => {
  const account = await makeAccount();
  await grant(account); await setAddress(account, "Pay123");
  const sender = await collections.ledgerAccounts.findOne({ walletId: free.wallet.id, accountType: "wallet" });
  assert.ok(sender);
  const treasuryId = await ensureTreasuryAccount(collections);
  const fundingId = randomUUID(), now = new Date(), amountMinor = 100000;
  await subscriptionTransaction(client, async (session) => {
    // Test-only balanced issuance; the real reconciler recognizes this existing funding prefix.
    await collections.ledgerEntries.insertMany([
      { publicId: randomUUID(), transactionId: fundingId, lineNumber: 1, walletId: null, ledgerAccountId: treasuryId, side: "debit", amountMinor, currency: "LMA", correlationId: `smoke-funding-${fundingId}`, createdAt: now },
      { publicId: randomUUID(), transactionId: fundingId, lineNumber: 2, walletId: free.wallet.id, ledgerAccountId: sender.publicId, side: "credit", amountMinor, currency: "LMA", correlationId: `smoke-funding-${fundingId}`, createdAt: now },
    ] as never, { session });
    await collections.ledgerAccounts.updateOne({ publicId: sender.publicId }, { $inc: { balanceMinor: amountMinor } }, { session });
    await collections.ledgerAccounts.updateOne({ publicId: treasuryId }, { $inc: { balanceMinor: amountMinor } }, { session });
  });
  const preview = await previewTransfer({ collections, ownerUserId: free.user.id, recipientAddress: "PAY123", amount: "1.0000", requestId: randomUUID() });
  assert.ok(preview.authorization);
  const input = { collections, mongoClient: client, ownerUserId: free.user.id, authorizationId: preview.authorization.id,
    recipientAddress: account.wallet.address, amount: "1.0000", idempotencyKey: randomUUID(), transferPassword: PASSWORD, requestId: randomUUID() };
  const sent = await createTransfer(input);
  assert.equal(sent.replayed, false); assert.equal(sent.netAmount, "0.9900"); assert.equal(sent.balanceAfter, "9.0000");
  await collections.subscriptions.updateOne({ ownerUserId: account.user.id, status: "active" }, { $set: { startsAt: new Date(Date.now() - 86400000), expiresAt: new Date(Date.now() - 1) } });
  const replay = await createTransfer(input);
  assert.equal(replay.id, sent.id); assert.equal(replay.replayed, true); assert.equal(replay.balanceAfter, sent.balanceAfter);
  await assert.rejects(() => resolve("pay123"), { code: "not_found" });
  const canonical = await previewTransfer({ collections, ownerUserId: free.user.id, recipientAddress: account.wallet.address, amount: "1.0000", requestId: randomUUID() });
  assert.ok(canonical.authorization);
  await createTransfer({ ...input, authorizationId: canonical.authorization.id, idempotencyKey: randomUUID() });
  assert.equal(await collections.transactions.countDocuments({ receiverWalletId: account.wallet.id, receiverAddress: account.wallet.address }), 2);
  assert.equal((await collections.ledgerAccounts.findOne({ walletId: account.wallet.id, accountType: "wallet" }))?.balanceMinor, 19800);
  const reconciled = await reconcileLedger({ collections, mongoClient: client, options: { excludeCorrelationIdPrefixes: TEST_FUNDING_CORRELATION_PREFIXES } });
  assert.deepEqual(reconciled, { ok: true, issues: [] });
});

test("free and Pro history windows filter service-created transfers and mining records", async () => {
  await setTransferPassword({ collections, mongoClient: client, ownerUserId: free.user.id, currentPassword: PASSWORD, newPassword: PASSWORD, requestId: randomUUID() });
  const existingFreeTransfers = await collections.transactions.countDocuments({ type: "transfer", senderUserId: free.user.id });
  const agesInDays = [0.5, 3, 8, 31, 90, 121];
  for (const [index, ageDays] of agesInDays.entries()) {
    const preview = await previewTransfer({ collections, ownerUserId: free.user.id, recipientAddress: other.wallet.address, amount: "0.1000", requestId: randomUUID() });
    assert.ok(preview.authorization);
    const transfer = await createTransfer({ collections, mongoClient: client, ownerUserId: free.user.id,
      authorizationId: preview.authorization.id, recipientAddress: other.wallet.address, amount: "0.1000",
      idempotencyKey: randomUUID(), transferPassword: PASSWORD, requestId: randomUUID() });
    const createdAt = new Date(Date.now() - ageDays * 86400000);
    // These service-created, balanced transfers live only in the disposable integration database.
    await collections.transactions.updateOne({ publicId: transfer.id }, { $set: { createdAt, completedAt: createdAt } });
    await collections.ledgerEntries.updateMany({ transactionId: transfer.id }, { $set: { createdAt } });

    for (const account of [free, other]) {
      const ledgerAccount = await collections.ledgerAccounts.findOne({ walletId: account.wallet.id, accountType: "wallet" });
      assert.ok(ledgerAccount);
      const session: MiningSessionRecord = {
        _id: new ObjectId(), publicId: randomUUID(), ownerUserId: account.user.id, walletId: account.wallet.id,
        ledgerAccountId: ledgerAccount.publicId, status: "settled", cycleNumber: index + 1,
        startedAt: createdAt, endsAt: createdAt, durationSeconds: 0,
        rateUnits: 50_000, rateScale: 1_000_000, rateDecimals: 6, rate: "0.050000", rateUnit: "LMA/hour",
        settledMinor: 0, settlementSequence: 0, lastSettledAt: null, createdAt, updatedAt: createdAt,
      };
      await collections.miningSessions.insertOne(session);
    }
  }

  const freeTransfers = await call(free, "GET", "/api/v1/transactions?days=30");
  assert.equal(freeTransfers.statusCode, 200);
  assert.equal(freeTransfers.json().transactions.length, existingFreeTransfers + 3);
  assert.equal((await call(free, "GET", "/api/v1/transactions?days=90")).statusCode, 403);
  assert.equal((await call(free, "GET", "/api/v1/transactions")).json().transactions.length, existingFreeTransfers + agesInDays.length,
    "unfiltered transfer history stays available");

  const proTransfers = await call(other, "GET", "/api/v1/transactions?days=120");
  assert.equal(proTransfers.statusCode, 200);
  assert.equal(proTransfers.json().transactions.length, 5);
  assert.equal((await call(other, "GET", "/api/v1/transactions?days=7")).json().transactions.length, 2);

  const freeMining = await call(free, "GET", "/api/v1/mining/history?days=30");
  assert.equal(freeMining.statusCode, 200);
  assert.equal(freeMining.json().sessions.length, 3);
  assert.equal((await call(free, "GET", "/api/v1/mining/history?days=120")).statusCode, 403);
  assert.equal((await call(free, "GET", "/api/v1/mining/history")).json().sessions.length, 3,
    "mining history defaults to the Free limit");

  const proMining = await call(other, "GET", "/api/v1/mining/history?days=120");
  assert.equal(proMining.statusCode, 200);
  assert.equal(proMining.json().sessions.length, 5);
  assert.equal((await call(other, "GET", "/api/v1/mining/history?days=7")).json().sessions.length, 2);
});

test("new authorization and history queries use their named indexes", async () => {
  const explain = await collections.subscriptions.find({ ownerUserId: other.user.id, status: "active" }).explain("executionStats");
  assert.ok(JSON.stringify(explain).includes("subscriptions_owner_active_unique"));
  const history = await collections.walletAddressHistory.find({ ownerUserId: owner.user.id }).sort({ createdAt: -1, publicId: -1 }).limit(20).explain("executionStats");
  assert.ok(JSON.stringify(history).includes("wallet_address_history_owner"));
});
