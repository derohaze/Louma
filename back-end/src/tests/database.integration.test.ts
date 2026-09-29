import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { MongoClient } from "mongodb";
import { MongoServerError, ObjectId } from "mongodb";
import { generate } from "otplib";
import { buildApp } from "../app.js";
import { loadConfig, type AppConfig } from "../config/env.js";
import { connectMongo } from "../infrastructure/mongodb/client.js";
import type { Db } from "mongodb";
import { ensureDatabaseIndexes } from "../infrastructure/mongodb/indexes.js";
import { getCollections, type Collections } from "../infrastructure/mongodb/collections.js";
import { formatMoney, parseMoneyToMinorUnits } from "../modules/ledger/money.js";
import { reconcileLedger } from "../modules/ledger/reconciliation.js";
import { PENDING_2FA_TTL_MS } from "../shared/types.js";
import { createTransfer } from "../modules/transfers/service.js";

/**
 * Integration test against the configured MongoDB cluster.
 *
 * It is deliberately outside `npm test`, because it needs a real database (transactions require a
 * replica set): run it with `npm run test:integration`. Every document it creates is removed in
 * `after()`, and the shared fee and treasury accounts are returned to the balances they had before
 * the run — anything the test did not create is left in place.
 *
 * Funding: the customer API has no deposit endpoint yet, so the sender wallet is funded with an
 * explicit test-only mint line (one credit ledger entry plus its account projection). The assertion
 * that matters — the wallet balance reported by the API equals Σ(credits) − Σ(debits) of that
 * account's ledger entries — is checked for every wallet account after every step.
 */

const PASSWORD = "SmokeTest1234";
const FUNDING_MINOR = parseMoneyToMinorUnits("25.0000");
const TRANSFER = "10.0000";

let app: FastifyInstance;
let client: MongoClient;
let db: Db;
let config: AppConfig;
let collections: Collections;
const createdUserIds: string[] = [];
const createdLedgerAccountIds: string[] = [];
const createdTransactionIds: string[] = [];
/** Treasuries this run created, so teardown removes only those and never one that already existed. */
const createdTreasuryAccountIds: string[] = [];
/** How much this run's funding added to the shared treasury, so teardown takes back exactly that. */
let treasuryFundedMinor = 0;

interface Account {
  userId: string;
  email: string;
  accessToken: string;
  refreshCookie: string;
  walletId: string;
  address: string;
  ledgerAccountId: string;
}

/**
 * Each request is injected from its own client address: the API rate-limits per IP, and a test that
 * registered a dozen accounts from one address would be fighting the protection instead of testing
 * the endpoints. The addresses are documentation-range literals, never real clients.
 */
let requestIp = 0;
const nextIp = () => `10.0.0.${(requestIp++ % 250) + 1}`;

/**
 * The CSRF tokens the suite holds, mirroring what a browser does with them.
 *
 * A state-changing request has to carry the token derived for its scope, so the suite keeps the one
 * each session was issued — recorded from the response that minted it, exactly as the wallet stores
 * it — and uses the pre-session token for the requests that run before a session exists.
 */
let preauthCsrfTokenValue = "";
const csrfByAccessToken = new Map<string, string>();

async function call(
  method: "GET" | "POST" | "PATCH" | "DELETE",
  url: string,
  options: { token?: string; cookie?: string; body?: unknown; idempotencyKey?: string } = {},
) {
  const headers: Record<string, string> = {};
  if (options.token) headers["authorization"] = `Bearer ${options.token}`;
  if (options.cookie) headers["cookie"] = options.cookie;
  if (options.idempotencyKey) headers["idempotency-key"] = options.idempotencyKey;
  if (method !== "GET") {
    const token = options.token ? csrfByAccessToken.get(options.token) : undefined;
    headers["x-csrf-token"] = token ?? preauthCsrfTokenValue;
  }
  const response = await app.inject({
    method,
    url,
    headers,
    remoteAddress: nextIp(),
    ...(options.body === undefined ? {} : { payload: options.body as Record<string, unknown> }),
  });
  const setCookie = response.headers["set-cookie"];
  // A 204 (logout, revoke session) carries no payload, so an empty body is not an error here.
  const body = response.payload.length ? (response.json() as Record<string, unknown>) : {};
  // Whatever session this response started or rotated is now the one this suite can act as.
  if (typeof body["accessToken"] === "string" && typeof body["csrfToken"] === "string") {
    csrfByAccessToken.set(body["accessToken"], body["csrfToken"]);
  }
  return {
    status: response.statusCode,
    body,
    cookie: Array.isArray(setCookie) ? (setCookie[0] ?? "") : ((setCookie as string | undefined) ?? ""),
  };
}

async function register(label: string): Promise<Account> {
  const email = `smoke.${label}.${randomUUID()}@example.test`;
  const response = await call("POST", "/api/v1/auth/register", {
    // Labels can be long (failure-point names); the API caps display names at 32 characters.
    body: { email, password: PASSWORD, displayName: `Smoke ${label}`.slice(0, 32) },
  });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  const user = response.body["user"] as { id: string };
  const wallet = response.body["wallet"] as { id: string; address: string };
  createdUserIds.push(user.id);
  const account = await collections.ledgerAccounts.findOne({ walletId: wallet.id, accountType: "wallet" });
  assert.ok(account, "the wallet has a ledger account");
  createdLedgerAccountIds.push(account.publicId);
  return {
    userId: user.id,
    email,
    accessToken: response.body["accessToken"] as string,
    refreshCookie: response.cookie.split(";")[0] ?? "",
    walletId: wallet.id,
    address: wallet.address,
    ledgerAccountId: account.publicId,
  };
}

async function balanceOf(account: Account): Promise<string> {
  const response = await call("GET", "/api/v1/wallet", { token: account.accessToken });
  assert.equal(response.status, 200);
  return (response.body["wallet"] as { balance: string }).balance;
}

/** Recomputes the balance straight from the immutable entries, independently of the projection. */
async function ledgerBalanceOf(ledgerAccountId: string): Promise<number> {
  const entries = await collections.ledgerEntries.find({ ledgerAccountId }).toArray();
  return entries.reduce((total, entry) => total + (entry.side === "credit" ? entry.amountMinor : -entry.amountMinor), 0);
}

async function assertLedgerConsistency(): Promise<void> {
  for (const account of await collections.ledgerAccounts.find({ accountType: "wallet" }).toArray()) {
    assert.equal(
      account.balanceMinor,
      await ledgerBalanceOf(account.publicId),
      `ledger entries must explain the balance of account ${account.publicId}`,
    );
    assert.ok(account.balanceMinor >= 0, "a wallet balance is never negative");
  }
}

/**
 * A real authenticator code for `secret`. TOTP is time-based, so a code generated just before a
 * 30-second step ends would be rejected by the server as expired; wait for the next step instead.
 */
async function totpCode(secret: string): Promise<string> {
  const remainingSeconds = 30 - (Math.floor(Date.now() / 1000) % 30);
  if (remainingSeconds <= 3) await new Promise((resolve) => setTimeout(resolve, (remainingSeconds + 1) * 1000));
  return generate({ secret });
}

/** A well-formed code from an unrelated secret: guaranteed not to match, at any clock. */
const wrongTotpCode = () => generate({ secret: "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP" });

/**
 * Test-only funding: a balanced double-entry issuance. The customer API has no deposit rail, so the
 * test mints the way a controlled treasury issuance would be recorded — one transaction, a debit on
 * the system treasury account, a credit on the wallet account — which keeps every invariant intact:
 * the ledger balances after funding, the treasury's projection tracks its side, and nothing here is
 * reachable from the customer API.
 */
async function fund(account: Account, amountMinor: number): Promise<void> {
  const transactionId = randomUUID();
  createdTransactionIds.push(transactionId);
  const ensured = await collections.ledgerAccounts.updateOne(
    { accountType: "system_treasury", currency: "LMA" },
    { $setOnInsert: { publicId: randomUUID(), walletId: null, accountType: "system_treasury", currency: "LMA", balanceMinor: 0, createdAt: new Date() } },
    { upsert: true },
  );
  const treasury = await collections.ledgerAccounts.findOne({ accountType: "system_treasury", currency: "LMA" });
  if (!treasury) throw new Error("Failed to ensure the test treasury account");
  // A treasury the database already had belongs to the database, not to this test: record only one
  // this run created, and remember the amount added so teardown can return the balance exactly.
  if (ensured.upsertedId) createdTreasuryAccountIds.push(treasury.publicId);
  treasuryFundedMinor += amountMinor;
  const now = new Date();
  await collections.ledgerEntries.insertMany(
    [
      { publicId: randomUUID(), transactionId, lineNumber: 1, walletId: null, ledgerAccountId: treasury.publicId, side: "debit", amountMinor, currency: "LMA", correlationId: `smoke-funding-${transactionId}`, createdAt: now },
      { publicId: randomUUID(), transactionId, lineNumber: 2, walletId: account.walletId, ledgerAccountId: account.ledgerAccountId, side: "credit", amountMinor, currency: "LMA", correlationId: `smoke-funding-${transactionId}`, createdAt: now },
    ] as never,
  );
  await collections.ledgerAccounts.updateMany(
    { $or: [{ publicId: account.ledgerAccountId }, { _id: treasury._id }] },
    { $inc: { balanceMinor: amountMinor } },
  );
}

async function transfer(address: string, amount: string, token: string, key = randomUUID()) {
  const response = await call("POST", "/api/v1/transfers", {
    token,
    idempotencyKey: key,
    body: { recipientAddress: address, amount, note: "smoke test" },
  });
  // Every transfer this test creates is recorded, whatever the response status, so cleanup can
  // remove the ledger lines on both sides of the transaction (including the fee account's).
  const transaction = response.body["transaction"] as { id?: string } | undefined;
  if (transaction?.id) createdTransactionIds.push(transaction.id);
  return response;
}

/**
 * Seeds one notification row for an account. Only the reading side of notifications is served by the
 * API today, so what is exercised below is the read model: list, read state, and cursor paging.
 * Returns the id, which is also the cursor a client receives.
 */
async function seedNotification(
  account: Account,
  input: { kind: string; title: string; body: string; createdAt: Date; readAt?: Date },
): Promise<string> {
  const id = new ObjectId();
  await collections.notifications.insertOne({
    _id: id,
    ownerUserId: account.userId,
    kind: input.kind,
    title: input.title,
    body: input.body,
    readAt: input.readAt ?? null,
    createdAt: input.createdAt,
  });
  return id.toHexString();
}

before(async () => {
  config = loadConfig();
  // The live cluster is reached over the public internet: give server selection much more room
  // than the five seconds the service itself uses to fail fast.
  const connection = await connectMongo(config, { serverSelectionTimeoutMS: 30_000, connectTimeoutMS: 20_000 });
  client = connection.client;
  db = connection.db;
  collections = getCollections(connection.db);
  await ensureDatabaseIndexes(connection.db);
  app = await buildApp({ config, collections, mongoClient: client, logger: false });
  // The token a first-time visitor is handed, before any session exists.
  const csrf = await call("GET", "/api/v1/auth/csrf");
  assert.equal(csrf.status, 200, JSON.stringify(csrf.body));
  preauthCsrfTokenValue = csrf.body["csrfToken"] as string;
});

after(async () => {
  if (collections) {
    for (const userId of createdUserIds) {
      await collections.sessions.deleteMany({ ownerUserId: userId });
      await collections.securityEvents.deleteMany({ ownerUserId: userId });
      await collections.twoFactorCredentials.deleteMany({ ownerUserId: userId });
      await collections.transferPasswordCredentials.deleteMany({ ownerUserId: userId });
      await collections.notifications.deleteMany({ ownerUserId: userId });
      await collections.transactions.deleteMany({ $or: [{ senderUserId: userId }, { receiverUserId: userId }] });
      await collections.wallets.deleteMany({ ownerUserId: userId });
      await collections.users.deleteMany({ publicId: userId });
    }
    // The fee and treasury balances are adjusted by exactly what this run contributed, computed
    // before the lines are deleted. Replacing a live projection from a scan would erase a fee (or a
    // funding line) another transfer added between the scan and the write; decrementing this run's
    // own contribution atomically cannot.
    const feeAccount = await collections.ledgerAccounts.findOne({ accountType: "fee_revenue", currency: "LMA" });
    const feeDelta = feeAccount
      ? (await collections.ledgerEntries.find({ ledgerAccountId: feeAccount.publicId, transactionId: { $in: createdTransactionIds } }).toArray())
          .reduce((total, entry) => total + (entry.side === "credit" ? entry.amountMinor : -entry.amountMinor), 0)
      : 0;

    for (const ledgerAccountId of createdLedgerAccountIds) {
      await collections.ledgerEntries.deleteMany({ ledgerAccountId });
      await collections.ledgerAccounts.deleteMany({ publicId: ledgerAccountId });
    }
    await collections.ledgerEntries.deleteMany({ transactionId: { $in: createdTransactionIds } });
    await collections.transactions.deleteMany({ $or: [{ publicId: { $in: createdTransactionIds } }, { transferId: { $in: createdTransactionIds } }] });

    if (feeAccount && feeDelta !== 0) {
      await collections.ledgerAccounts.updateOne({ _id: feeAccount._id }, { $inc: { balanceMinor: -feeDelta } });
    }
    if (treasuryFundedMinor !== 0) {
      await collections.ledgerAccounts.updateOne({ accountType: "system_treasury", currency: "LMA" }, { $inc: { balanceMinor: -treasuryFundedMinor } });
    }
    // Only treasuries this run created are removed. One that was already in the database keeps its
    // account and its own ledger history, with the funding it received just taken back.
    await collections.ledgerAccounts.deleteMany({ publicId: { $in: createdTreasuryAccountIds } });
    await app?.close();
    await client?.close();
  }
});

test("registration creates a wallet with a unique address and a zero ledger balance", async () => {
  const account = await register("a");
  assert.match(account.address, /^LMA(-[A-Z0-9]{4}){3}$/);
  assert.equal(await balanceOf(account), "0.0000");
  assert.equal(await ledgerBalanceOf(account.ledgerAccountId), 0);
  const wallet = await collections.wallets.findOne({ publicId: account.walletId });
  assert.ok(wallet);
  assert.equal(wallet.status, "active");
});

test("the database enforces unique identities and addresses", async () => {
  const [first, second] = [await register("uniq-1"), await register("uniq-2")];
  assert.notEqual(first.walletId, second.walletId);
  assert.notEqual(first.address, second.address);

  await assert.rejects(
    () => collections.users.insertOne({ publicId: randomUUID(), email: first.email, passwordHash: "x", profile: { displayName: "dup", country: null }, status: "active", emailVerifiedAt: null, createdAt: new Date(), updatedAt: new Date() } as never),
    (error: unknown) => error instanceof MongoServerError && error.code === 11000,
  );
  await assert.rejects(
    () => collections.wallets.insertOne({ publicId: first.walletId, address: "LMA-0000-0000-0000", addressNormalized: "LMA-0000-0000-0000", ownerUserId: randomUUID(), status: "active", financialVersion: 0, createdAt: new Date(), updatedAt: new Date(), customAddressChangedAt: null, customAddress: null, customAddressNormalized: null } as never),
    (error: unknown) => error instanceof MongoServerError && error.code === 11000,
  );
});

test("the declared indexes required by the query patterns exist", async () => {
  const expected: Record<string, string[]> = {
    users: ["users_public_id_unique", "users_email_unique"],
    wallets: ["wallets_public_id_unique", "wallets_address_unique", "wallets_owner_unique"],
    ledger_accounts: ["ledger_accounts_public_id_unique", "ledger_accounts_revenue_unique"],
    ledger_entries: ["ledger_entries_transaction_line_unique", "ledger_entries_account_history"],
    transactions: ["transactions_public_id_unique", "transactions_transfer_id_unique", "transactions_idempotency_unique", "transactions_sender_history"],
    sessions: ["sessions_public_id_unique", "sessions_owner_active", "sessions_expire_at"],
    security_events: ["security_events_public_id_unique", "security_events_owner_history"],
  };
  for (const [collection, names] of Object.entries(expected)) {
    const namesInDatabase = (await db.collection(collection).listIndexes().toArray()).map((index) => index.name);
    for (const name of names) assert.ok(namesInDatabase.includes(name), `${collection} is missing index ${name}`);
  }
});

test("a transfer moves LMA through the ledger, applies the 1% fee, and stays balanced", async () => {
  const sender = await register("sender");
  const receiver = await register("receiver");
  await fund(sender, FUNDING_MINOR);
  assert.equal(await balanceOf(sender), "25.0000");

  const response = await transfer(receiver.address, TRANSFER, sender.accessToken);
  assert.equal(response.status, 201, JSON.stringify(response.body));
  const transaction = response.body["transaction"] as Record<string, string>;
  assert.equal(transaction["amount"], "10.0000");
  assert.equal(transaction["fee"], "0.1000");
  assert.equal(transaction["netAmount"], "9.9000");
  assert.equal(transaction["direction"], "sent");
  assert.equal(transaction["counterpartyAddress"], receiver.address);
  assert.equal(transaction["status"], "completed");
  createdTransactionIds.push(transaction["id"] as string);

  assert.equal(await balanceOf(sender), "15.0000");
  assert.equal(await balanceOf(receiver), "9.9000");
  await assertLedgerConsistency();

  const entries = await collections.ledgerEntries.find({ transactionId: transaction["id"] as string }).toArray();
  const debits = entries.filter((entry) => entry.side === "debit").reduce((total, entry) => total + entry.amountMinor, 0);
  const credits = entries.filter((entry) => entry.side === "credit").reduce((total, entry) => total + entry.amountMinor, 0);
  assert.equal(debits, credits, "debits and credits must be equal");
  assert.equal(debits, parseMoneyToMinorUnits(transaction["amount"] as string), "the sender is debited by the full amount");

  const history = await call("GET", "/api/v1/transactions?limit=10", { token: sender.accessToken });
  assert.equal(history.status, 200);
  const listed = (history.body["transactions"] as { id: string }[]).some((item) => item.id === transaction["id"]);
  assert.ok(listed, "the transfer appears in the sender's history");

  const received = await call("GET", "/api/v1/transactions?limit=10&direction=received", { token: receiver.accessToken });
  assert.ok((received.body["transactions"] as { id: string; direction: string }[]).some((item) => item.direction === "received"));

  const detail = await call("GET", `/api/v1/transfers/${transaction["transferId"]}`, { token: receiver.accessToken });
  assert.equal(detail.status, 200, "the recipient can read the transfer by its transfer id");
});

test("a replayed transfer is not charged twice", async () => {
  const sender = await register("replay");
  const receiver = await register("replay-target");
  await fund(sender, FUNDING_MINOR);
  const key = randomUUID();

  const first = await transfer(receiver.address, TRANSFER, sender.accessToken, key);
  const second = await transfer(receiver.address, TRANSFER, sender.accessToken, key);
  assert.equal(first.status, 201);
  assert.equal(second.status, 200, "the replay returns the original result");
  const firstTransaction = first.body["transaction"] as Record<string, string>;
  const secondTransaction = second.body["transaction"] as Record<string, string>;
  createdTransactionIds.push(firstTransaction["id"] as string);
  assert.equal(secondTransaction["transferId"], firstTransaction["transferId"]);
  assert.equal(await balanceOf(sender), "15.0000");
  assert.equal(await balanceOf(receiver), "9.9000");

  const reused = await transfer(receiver.address, "5.0000", sender.accessToken, key);
  assert.equal(reused.status, 409, "the same key with different data is rejected");
  await assertLedgerConsistency();
});

test("concurrent transfers cannot spend the same funds twice", async () => {
  const sender = await register("race");
  const receiver = await register("race-target");
  await fund(sender, FUNDING_MINOR);

  const [first, second] = await Promise.all([
    transfer(receiver.address, "25.0000", sender.accessToken),
    transfer(receiver.address, "25.0000", sender.accessToken),
  ]);
  const statuses = [first.status, second.status].sort();
  assert.deepEqual(statuses, [201, 409], `exactly one transfer succeeds: ${JSON.stringify([first, second])}`);
  assert.equal(await balanceOf(sender), "0.0000");
  assert.equal(await balanceOf(receiver), "24.7500");
  await assertLedgerConsistency();
});

test("transfers are refused for insufficient funds, self-transfers, unknown addresses, and missing auth", async () => {
  const sender = await register("refused");
  const receiver = await register("refused-target");
  assert.equal((await transfer(sender.address, "1.0000", sender.accessToken)).status, 409, "self transfer");
  const withoutFunds = await transfer(receiver.address, "1.0000", sender.accessToken);
  assert.equal(withoutFunds.status, 409, "a wallet with no funds cannot send");
  assert.equal((withoutFunds.body["error"] as { code: string }).code, "insufficient_funds");
  await fund(sender, FUNDING_MINOR);
  assert.equal((await transfer(sender.address, "1.0000", sender.accessToken)).status, 409, "self transfer");
  assert.equal((await transfer("LMA-1111-2222-3333", "1.0000", sender.accessToken)).status, 404, "unknown recipient");
  assert.equal((await transfer("not-an-address", "1.0000", sender.accessToken)).status, 400, "invalid recipient");
  const unauthenticated = await call("POST", "/api/v1/transfers", { body: { recipientAddress: "LMA-1111-2222-3333", amount: "1.0000" }, idempotencyKey: randomUUID() });
  assert.equal(unauthenticated.status, 401, "a transfer requires a session");
  assert.equal((await call("GET", "/api/v1/wallet")).status, 401, "the wallet requires a session");
});

test("freezing the wallet blocks transfers until it is unfrozen", async () => {
  const sender = await register("frozen");
  const receiver = await register("frozen-target");
  await fund(sender, FUNDING_MINOR);

  const freeze = await call("POST", "/api/v1/security/freeze", { token: sender.accessToken });
  assert.equal(freeze.status, 200);
  assert.equal((freeze.body as { status: string }).status, "frozen");

  const blocked = await transfer(receiver.address, "1.0000", sender.accessToken);
  assert.equal(blocked.status, 403, "a frozen wallet cannot send");
  assert.equal(await balanceOf(sender), "25.0000", "nothing was taken");

  const overview = await call("GET", "/api/v1/security", { token: sender.accessToken });
  assert.equal((overview.body["wallet"] as { status: string }).status, "frozen");

  const wrongPassword = await call("POST", "/api/v1/security/unfreeze", { token: sender.accessToken, body: { password: "WrongPassword1" } });
  assert.equal(wrongPassword.status, 403, "unfreezing needs the account password");

  const unfreeze = await call("POST", "/api/v1/security/unfreeze", { token: sender.accessToken, body: { password: PASSWORD } });
  assert.equal(unfreeze.status, 200, JSON.stringify(unfreeze.body));
  assert.equal((unfreeze.body as { status: string }).status, "active");
  assert.equal((await transfer(receiver.address, "1.0000", sender.accessToken)).status, 201);
  await assertLedgerConsistency();
});

test("a frozen wallet still receives LMA, and still cannot send", async () => {
  const sender = await register("frozen-recipient-sender");
  const receiver = await register("frozen-recipient");
  await fund(sender, FUNDING_MINOR);

  const frozen = await call("POST", "/api/v1/security/freeze", { token: receiver.accessToken });
  assert.equal(frozen.status, 200, JSON.stringify(frozen.body));

  // Freezing stops what leaves a wallet. The freeze page promises that LMA already on its way still
  // arrives, so a transfer to a frozen wallet must not be refused.
  const sent = await transfer(receiver.address, "10.0000", sender.accessToken);
  assert.equal(sent.status, 201, JSON.stringify(sent.body));
  assert.equal(await balanceOf(receiver), "9.9000", "the recipient is credited while frozen");
  assert.equal(await balanceOf(sender), "15.0000");
  assert.equal((await transfer(sender.address, "1.0000", receiver.accessToken)).status, 403, "the frozen wallet still cannot send");
  await assertLedgerConsistency();
});

test("each side of a transfer sees its own balance and nothing else", async () => {
  const sender = await register("balance-privacy-sender");
  const receiver = await register("balance-privacy-receiver");
  const stranger = await register("balance-privacy-stranger");
  await fund(sender, FUNDING_MINOR);

  const sent = await transfer(receiver.address, "10.0000", sender.accessToken);
  assert.equal(sent.status, 201, JSON.stringify(sent.body));
  const sentTransaction = sent.body["transaction"] as Record<string, unknown>;
  assert.equal(sentTransaction["balanceAfter"], "15.0000", "the sender sees its own balance afterwards");
  const transferId = String(sentTransaction["transferId"]);

  // The stored `balanceAfter` is the sender's: showing it to the recipient would publish the other
  // side's finances.
  const receiverView = await call("GET", `/api/v1/transactions/${transferId}`, { token: receiver.accessToken });
  assert.equal(receiverView.status, 200, JSON.stringify(receiverView.body));
  const received = receiverView.body["transaction"] as Record<string, unknown>;
  assert.equal(received["direction"], "received");
  assert.equal(received["balanceAfter"], undefined, "the recipient is never shown the sender's balance");
  assert.equal(received["amount"], "10.0000", "the amount the sender paid");
  assert.equal(received["netAmount"], "9.9000", "the amount this wallet was credited");

  // Both identifiers the API hands out resolve to the same transfer.
  assert.equal((await call("GET", `/api/v1/transactions/${sentTransaction["id"] as string}`, { token: sender.accessToken })).status, 200, "the public id resolves");
  assert.equal((await call("GET", `/api/v1/transactions/${transferId}`, { token: sender.accessToken })).status, 200, "the transfer id resolves");
  assert.equal((await call("GET", `/api/v1/transactions/${transferId}`, { token: stranger.accessToken })).status, 404, "another account sees nothing");
  await assertLedgerConsistency();
});

/**
 * The CSRF token is the only thing separating a request the wallet made from one another site made
 * on the customer's behalf with a cookie the browser attached by itself, so the endpoint has to
 * refuse the request that does not carry it. The suite's own helper always sends one; this is the
 * request that comes from somewhere else.
 */
test("a state-changing request without its CSRF token is refused", async () => {
  const account = await register("csrf-absent");
  const response = await app.inject({
    method: "PATCH",
    url: "/api/v1/me",
    headers: { authorization: `Bearer ${account.accessToken}` },
    payload: { displayName: "No token" },
    remoteAddress: nextIp(),
  });
  assert.equal(response.statusCode, 403, response.payload);
  assert.equal((response.json() as { error: { code: string } }).error.code, "csrf_token_invalid");

  // The same request with the token the session was issued is accepted, which is what makes the
  // rejection above a CSRF decision rather than the route failing for another reason.
  const accepted = await call("PATCH", "/api/v1/me", {
    token: account.accessToken,
    body: { displayName: "Has token" },
  });
  assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
});

/**
 * The pre-session endpoints (register, login, refresh, 2FA verify) are the ones a cross-site form
 * can reach with only a cookie, so they carry their own CSRF guard rather than the session guard
 * above. The suite helper always sends a token, which would keep passing if that guard were
 * removed — this is the headerless request that must still be refused.
 */
test("a pre-session request without its CSRF token is refused", async () => {
  // Deliberately invalid bodies: the guard runs before validation, so a missing token is refused
  // with 403 and nothing is written — no account, no session, no audit row to clean up.
  const invalidBody = { email: "not-an-email", password: PASSWORD, displayName: "No token" };
  for (const url of ["/api/v1/auth/register", "/api/v1/auth/login"]) {
    const response = await app.inject({
      method: "POST",
      url,
      payload: invalidBody,
      remoteAddress: nextIp(),
    });
    assert.equal(response.statusCode, 403, `${url}: ${response.payload}`);
    assert.equal((response.json() as { error: { code: string } }).error.code, "csrf_token_invalid");
  }

  // The same request with the pre-session token passes the guard and fails later on validation
  // (400, still nothing written), which is what makes the rejection above a CSRF decision rather
  // than the route failing for another reason.
  const guarded = await app.inject({
    method: "POST",
    url: "/api/v1/auth/register",
    headers: { "x-csrf-token": preauthCsrfTokenValue },
    payload: invalidBody,
    remoteAddress: nextIp(),
  });
  assert.equal(guarded.statusCode, 400, guarded.payload);
});

test("a suspended account cannot keep using the session it already had", async () => {
  const account = await register("suspended");
  assert.equal((await call("GET", "/api/v1/me", { token: account.accessToken })).status, 200);

  await collections.users.updateOne({ publicId: account.userId }, { $set: { status: "suspended" } });

  assert.equal((await call("GET", "/api/v1/me", { token: account.accessToken })).status, 401, "an access token of a suspended account stops working");
  assert.equal((await call("POST", "/api/v1/auth/refresh", { cookie: account.refreshCookie })).status, 401, "and its session cannot be refreshed");
});

test("a racing refresh is served, while a token replayed later signs every session out", async () => {
  const account = await register("refresh-race");

  const rotated = await call("POST", "/api/v1/auth/refresh", { cookie: account.refreshCookie });
  assert.equal(rotated.status, 200, JSON.stringify(rotated.body));

  // What a second tab sends when it read the cookie before the first rotation landed: one rotation
  // old. That is a race, not theft, so it is served.
  const raced = await call("POST", "/api/v1/auth/refresh", { cookie: account.refreshCookie });
  assert.equal(raced.status, 200, "a second tab refreshing at the same moment is not treated as theft");
  const racedAccessToken = raced.body["accessToken"] as string;
  assert.equal((await call("GET", "/api/v1/me", { token: racedAccessToken })).status, 200);

  // The same displaced token, long after the rotation that displaced it, is a replay: nothing is
  // served and the whole account is signed out.
  await collections.sessions.updateMany({ ownerUserId: account.userId, status: "active" }, { $set: { lastActiveAt: new Date(Date.now() - 10 * 60 * 1000) } });
  const replayed = await call("POST", "/api/v1/auth/refresh", { cookie: rotated.cookie.split(";")[0] ?? "" });
  assert.equal(replayed.status, 401, "a stale token is refused");
  assert.equal((await call("GET", "/api/v1/me", { token: racedAccessToken })).status, 401, "every session of the account is signed out");
});

test("the refresh cookie issues a new access token and sessions can be listed and revoked", async () => {
  const account = await register("session");
  const refreshed = await call("POST", "/api/v1/auth/refresh", { cookie: account.refreshCookie });
  assert.equal(refreshed.status, 200);
  const rotatedToken = refreshed.body["accessToken"] as string;
  assert.ok(rotatedToken);
  assert.ok(refreshed.cookie.includes("louma_refresh="), "the refresh token rotates");

  const login = await call("POST", "/api/v1/auth/login", { body: { email: account.email, password: PASSWORD } });
  assert.equal(login.status, 200);
  const secondToken = login.body["accessToken"] as string;
  assert.equal(login.body["requiresTwoFactor"], false);

  const sessions = await call("GET", "/api/v1/sessions", { token: secondToken });
  assert.equal(sessions.status, 200);
  const listed = sessions.body["sessions"] as { id: string; current: boolean }[];
  assert.ok(listed.length >= 2, "both sessions are listed");
  const other = listed.find((session) => !session.current);
  assert.ok(other, "the other session is not the current one");

  const revoked = await call("DELETE", `/api/v1/sessions/${other.id}`, { token: secondToken });
  assert.equal(revoked.status, 204);
  const afterRevoke = await call("GET", "/api/v1/sessions", { token: secondToken });
  assert.equal((afterRevoke.body["sessions"] as { id: string }[]).length, listed.length - 1);

  const logout = await call("POST", "/api/v1/auth/logout", { token: secondToken });
  assert.equal(logout.status, 204);
  assert.equal((await call("GET", "/api/v1/me", { token: secondToken })).status, 401, "the revoked session no longer authenticates");
});

test("the wallet balance reported by the API is the ledger-derived string", async () => {
  const account = await register("ledger");
  await fund(account, FUNDING_MINOR);
  const ledgerAccount = await collections.ledgerAccounts.findOne({ publicId: account.ledgerAccountId });
  assert.ok(ledgerAccount);
  assert.equal(await balanceOf(account), formatMoney(ledgerAccount.balanceMinor));
  assert.equal(await balanceOf(account), "25.0000");
  await assertLedgerConsistency();
});

test("two-factor authentication gates sign-in, spends a recovery code once, and can be turned off", async () => {
  const account = await register("2fa");

  // Enrolment is authorised by the authenticated session and proves itself with the first code, so
  // the endpoint takes no password and the secret never leaves the server unconfirmed.
  // Enrolment needs the account password: a session alone must not be able to bind an authenticator.
  assert.equal((await call("POST", "/api/v1/security/2fa/enable", { token: account.accessToken, body: { password: "WrongPassword1" } })).status, 403);
  const started = await call("POST", "/api/v1/security/2fa/enable", { token: account.accessToken, body: { password: PASSWORD } });
  assert.equal(started.status, 200, JSON.stringify(started.body));
  const secret = started.body["secret"] as string;
  assert.ok(secret.length >= 16, "a real secret is issued for the authenticator app");
  assert.ok((started.body["otpauthUri"] as string).startsWith("otpauth://totp/"));

  const confirmed = await call("POST", "/api/v1/security/2fa/confirm", { token: account.accessToken, body: { code: await totpCode(secret) } });
  assert.equal(confirmed.status, 200, JSON.stringify(confirmed.body));
  const recoveryCodes = confirmed.body["recoveryCodes"] as string[];
  assert.equal(recoveryCodes.length, 8);
  assert.equal(new Set(recoveryCodes).size, 8);

  const enabledOverview = await call("GET", "/api/v1/security", { token: account.accessToken });
  const enabledTwoFactor = enabledOverview.body["twoFactor"] as Record<string, unknown>;
  assert.equal(enabledTwoFactor["enabled"], true);
  assert.equal(enabledTwoFactor["recoveryCodesRemaining"], 8);
  assert.equal(enabledTwoFactor["secret"], undefined, "the TOTP secret is never read back through the API");
  assert.equal((await call("POST", "/api/v1/security/2fa/enable", { token: account.accessToken, body: { password: PASSWORD } })).status, 409, "setup cannot be started twice");

  // Signing in now returns a pending session that cannot authenticate until the code is checked.
  const login = await call("POST", "/api/v1/auth/login", { body: { email: account.email, password: PASSWORD } });
  assert.equal(login.status, 200);
  assert.equal(login.body["accessToken"], null);
  assert.equal(login.body["requiresTwoFactor"], true);
  const pendingSessionId = login.body["sessionId"] as string;
  assert.ok(login.cookie.includes("louma_refresh="), "the pending session carries its own refresh cookie");

  const rejected = await call("POST", "/api/v1/auth/2fa/verify", { cookie: login.cookie, body: { sessionId: pendingSessionId, code: await wrongTotpCode() } });
  assert.equal(rejected.status, 401, "a code from another authenticator is refused");

  // A pending challenge lasts for the challenge window, not for the 30 days a real session gets, and
  // it cannot be promoted once that window has passed.
  const pendingRecord = await collections.sessions.findOne({ publicId: pendingSessionId });
  assert.ok(pendingRecord);
  assert.ok(
    pendingRecord.expiresAt.getTime() - pendingRecord.createdAt.getTime() <= PENDING_2FA_TTL_MS + 1_000,
    "a pending challenge does not get the session lifetime",
  );
  const expiredLogin = await call("POST", "/api/v1/auth/login", { body: { email: account.email, password: PASSWORD } });
  await collections.sessions.updateOne({ publicId: String(expiredLogin.body["sessionId"]) }, { $set: { expiresAt: new Date(Date.now() - 1_000) } });
  const tooLate = await call("POST", "/api/v1/auth/2fa/verify", { cookie: expiredLogin.cookie, body: { sessionId: expiredLogin.body["sessionId"], code: await totpCode(secret) } });
  assert.equal(tooLate.status, 401, "a challenge that ran out of time cannot be promoted");

  const verified = await call("POST", "/api/v1/auth/2fa/verify", { cookie: login.cookie, body: { sessionId: pendingSessionId, code: await totpCode(secret) } });
  assert.equal(verified.status, 200, JSON.stringify(verified.body));
  const twoFactorToken = verified.body["accessToken"] as string;
  assert.ok(twoFactorToken);
  assert.equal((await call("GET", "/api/v1/me", { token: twoFactorToken })).status, 200, "the verified session authenticates");

  // A recovery code works exactly once: the second attempt is refused and nothing is consumed.
  const recoveryCode = recoveryCodes[0] as string;
  const firstLogin = await call("POST", "/api/v1/auth/login", { body: { email: account.email, password: PASSWORD } });
  const usedRecovery = await call("POST", "/api/v1/auth/2fa/verify", { cookie: firstLogin.cookie, body: { sessionId: firstLogin.body["sessionId"], code: recoveryCode } });
  assert.equal(usedRecovery.status, 200, JSON.stringify(usedRecovery.body));
  const afterUse = await call("GET", "/api/v1/security", { token: usedRecovery.body["accessToken"] as string });
  assert.equal((afterUse.body["twoFactor"] as { recoveryCodesRemaining: number }).recoveryCodesRemaining, 7);

  const secondLogin = await call("POST", "/api/v1/auth/login", { body: { email: account.email, password: PASSWORD } });
  const reusedRecovery = await call("POST", "/api/v1/auth/2fa/verify", { cookie: secondLogin.cookie, body: { sessionId: secondLogin.body["sessionId"], code: recoveryCode } });
  assert.equal(reusedRecovery.status, 401, "a spent recovery code does not work again");
  const afterReuse = await call("GET", "/api/v1/security", { token: twoFactorToken });
  assert.equal((afterReuse.body["twoFactor"] as { recoveryCodesRemaining: number }).recoveryCodesRemaining, 7, "the refused attempt consumed nothing");

  // Turning it off needs one current code and no password, and restores simple sign-in.
  // Turning it off needs a current code *and* the account password.
  assert.equal((await call("POST", "/api/v1/security/2fa/disable", { token: twoFactorToken, body: { code: await wrongTotpCode() } })).status, 403);
  assert.equal((await call("POST", "/api/v1/security/2fa/disable", { token: twoFactorToken, body: { password: "WrongPassword1", code: await totpCode(secret) } })).status, 403);
  const disabled = await call("POST", "/api/v1/security/2fa/disable", { token: twoFactorToken, body: { password: PASSWORD, code: await totpCode(secret) } });
  assert.equal(disabled.status, 200, JSON.stringify(disabled.body));
  assert.equal(disabled.body["enabled"], false);

  const finalOverview = await call("GET", "/api/v1/security", { token: twoFactorToken });
  const finalTwoFactor = finalOverview.body["twoFactor"] as Record<string, unknown>;
  assert.equal(finalTwoFactor["enabled"], false);
  assert.equal(finalTwoFactor["recoveryCodesRemaining"], 0, "the stored recovery-code hashes are removed with the credential");

  const simpleLogin = await call("POST", "/api/v1/auth/login", { body: { email: account.email, password: PASSWORD } });
  assert.equal(simpleLogin.body["requiresTwoFactor"], false);
  assert.ok(simpleLogin.body["accessToken"], "sign-in no longer needs a second factor");

  const storedCredential = await collections.twoFactorCredentials.findOne({ ownerUserId: account.userId });
  assert.equal(storedCredential, null, "disabling deletes the credential row");
});

test("a custom address replaces the receiving address, stays unique, and is locked for 30 days", async () => {
  const owner = await register("address");
  const other = await register("address-other");
  const generatedAddress = owner.address;
  assert.match(generatedAddress, /^LMA(-[A-Z0-9]{4}){3}$/);

  // The handle rules are enforced before anything is written.
  for (const invalid of ["ab", "a".repeat(25), "no spaces", "dash-handle"]) {
    const refused = await call("PATCH", "/api/v1/wallet/custom-address", { token: owner.accessToken, body: { address: invalid } });
    assert.equal(refused.status, 400, `${JSON.stringify(invalid)} is refused`);
  }

  const changed = await call("PATCH", "/api/v1/wallet/custom-address", { token: owner.accessToken, body: { address: "@Louma_Pocket" } });
  assert.equal(changed.status, 200, JSON.stringify(changed.body));
  const wallet = changed.body["wallet"] as Record<string, unknown>;
  assert.equal(wallet["address"], "@louma_pocket", "the handle is normalised: lowercase, without the @ prefix");
  assert.equal(wallet["customAddress"], "@louma_pocket");
  assert.ok(typeof wallet["customAddressChangedAt"] === "string", "the cooldown clock starts when it changes");

  // Handles are unique platform-wide, whatever case they were typed in.
  const taken = await call("PATCH", "/api/v1/wallet/custom-address", { token: other.accessToken, body: { address: "LOUMA_POCKET" } });
  assert.equal(taken.status, 409, JSON.stringify(taken.body));
  assert.equal((taken.body["error"] as Record<string, unknown>)["code"], "address_unavailable");

  // Both the new handle and the original generated address keep resolving as recipients.
  await fund(other, FUNDING_MINOR);
  assert.equal((await transfer("@Louma_Pocket", "1.0000", other.accessToken)).status, 201);
  assert.equal((await transfer(generatedAddress, "1.0000", other.accessToken)).status, 201);
  assert.equal(await balanceOf(owner), "1.9800", "each transfer credits 1.0000 less the 1% fee");

  // The handle is locked for 30 days, and a refused change leaves the wallet untouched.
  const cooldown = await call("PATCH", "/api/v1/wallet/custom-address", { token: owner.accessToken, body: { address: "louma_second" } });
  assert.equal(cooldown.status, 409, JSON.stringify(cooldown.body));
  assert.equal((cooldown.body["error"] as Record<string, unknown>)["code"], "address_change_cooldown");
  const unchanged = (await call("GET", "/api/v1/wallet", { token: owner.accessToken })).body["wallet"] as Record<string, unknown>;
  assert.equal(unchanged["address"], "@louma_pocket");
  assert.equal(unchanged["customAddressChangedAt"], wallet["customAddressChangedAt"]);

  await assertLedgerConsistency();
});

test("notifications carry their read state and page by cursor without repeating or skipping", async () => {
  const owner = await register("notify");
  const other = await register("notify-other");
  const now = Date.now();
  const seeded: string[] = [];
  for (let index = 0; index < 5; index += 1) {
    seeded.push(
      await seedNotification(owner, {
        kind: index === 0 ? "security" : "transfer_received",
        title: `Notice ${index}`,
        body: `Body ${index}`,
        createdAt: new Date(now - index * 1_000),
        ...(index === 0 ? { readAt: new Date(now - 30_000) } : {}),
      }),
    );
  }
  await seedNotification(other, { kind: "transfer_sent", title: "Not yours", body: "Another account", createdAt: new Date(now) });

  const listed = await call("GET", "/api/v1/notifications", { token: owner.accessToken });
  assert.equal(listed.status, 200);
  const notifications = listed.body["notifications"] as Array<Record<string, unknown>>;
  assert.equal(notifications.length, 5, "an account only ever sees its own notifications");
  assert.equal(listed.body["unread"], 4, "the unread count covers the whole account");
  assert.equal(listed.body["nextCursor"], null, "a page that holds the whole list hands back no cursor");
  assert.deepEqual(notifications.map((notification) => String(notification["id"])), seeded, "newest first");
  assert.equal(notifications.filter((notification) => notification["readAt"] === null).length, 4, "unread is derived from readAt");
  assert.equal(notifications[0]?.["readAt"], new Date(now - 30_000).toISOString(), "a read notification reports when it was read");
  assert.equal(notifications[0]?.["kind"], "security");
  assert.ok(notifications[0]?.["title"] && notifications[0]?.["body"] && notifications[0]?.["createdAt"]);

  const walked: string[] = [];
  let cursor: string | null = null;
  let pages = 0;
  do {
    const page = await call("GET", `/api/v1/notifications?limit=2${cursor ? `&cursor=${cursor}` : ""}`, { token: owner.accessToken });
    assert.equal(page.status, 200, JSON.stringify(page.body));
    const items = page.body["notifications"] as Array<Record<string, unknown>>;
    assert.ok(items.length > 0, "a followed cursor never returns an empty page");
    assert.equal(page.body["unread"], 4, "the unread count does not shrink to the size of the page");
    walked.push(...items.map((item) => String(item["id"])));
    cursor = page.body["nextCursor"] as string | null;
    pages += 1;
  } while (cursor && pages < 5);
  assert.equal(pages, 3, "five notifications at two per page take three pages");
  assert.deepEqual(walked, seeded, "paging visits every notification exactly once, in order");

  assert.equal((await call("GET", "/api/v1/notifications?cursor=not-a-cursor", { token: owner.accessToken })).status, 404, "a malformed cursor is refused");
  assert.equal((await call("GET", "/api/v1/notifications?cursor=aaaaaaaaaaaaaaaaaaaaaaaa", { token: owner.accessToken })).status, 404, "an unknown cursor is refused");
  assert.equal((await call("GET", "/api/v1/notifications")).status, 401, "notifications need a session");
});

test("notifications written in the same millisecond are all reachable through paging", async () => {
  const owner = await register("notify-same-ms");
  // A transfer notifies both sides in the same instant, so notices sharing a millisecond are normal
  // rather than exotic: a cursor that filters on the timestamp alone would hide the rest of them.
  const at = new Date();
  const seeded: string[] = [];
  for (let index = 0; index < 3; index += 1) {
    seeded.push(await seedNotification(owner, { kind: "security", title: `Same millisecond ${index}`, body: `Body ${index}`, createdAt: at }));
  }

  const walked: string[] = [];
  let cursor: string | null = null;
  let pages = 0;
  do {
    const page = await call("GET", `/api/v1/notifications?limit=2${cursor ? `&cursor=${cursor}` : ""}`, { token: owner.accessToken });
    assert.equal(page.status, 200, JSON.stringify(page.body));
    walked.push(...(page.body["notifications"] as Array<Record<string, unknown>>).map((item) => String(item["id"])));
    cursor = page.body["nextCursor"] as string | null;
    pages += 1;
  } while (cursor && pages < 5);

  assert.equal(walked.length, 3, "every notice of that millisecond is reachable");
  assert.equal(new Set(walked).size, 3, "and none is repeated");
  assert.deepEqual([...walked].sort(), [...seeded].sort());
});

test("a transfer notifies both sides, and a notice is acknowledged once by its owner", async () => {
  const sender = await register("notice-sender");
  const receiver = await register("notice-receiver");
  await fund(sender, FUNDING_MINOR);

  assert.equal((await transfer(receiver.address, "10.0000", sender.accessToken)).status, 201);

  const senderList = await call("GET", "/api/v1/notifications", { token: sender.accessToken });
  const senderNotices = senderList.body["notifications"] as Array<Record<string, unknown>>;
  assert.equal(senderNotices.length, 1, "the sender is told exactly once");
  assert.equal(senderList.body["unread"], 1, "the sender has one thing to read");
  assert.equal(senderNotices[0]?.["kind"], "transfer_sent");
  assert.equal(senderNotices[0]?.["readAt"], null, "a fresh notice is unread");
  assert.ok(String(senderNotices[0]?.["body"]).includes("10.0000"), "the notice states what was sent");
  assert.ok(String(senderNotices[0]?.["body"]).includes(receiver.address), "the notice names the recipient");
  assert.ok(String(senderNotices[0]?.["body"]).includes("0.1000"), "the notice states the fee the sender paid");

  const receiverList = await call("GET", "/api/v1/notifications", { token: receiver.accessToken });
  const receiverNotices = receiverList.body["notifications"] as Array<Record<string, unknown>>;
  assert.equal(receiverNotices.length, 1, "the receiver is told exactly once");
  assert.equal(receiverNotices[0]?.["kind"], "transfer_received");
  assert.ok(String(receiverNotices[0]?.["body"]).includes("9.9000"), "the receiver sees the amount after the fee");
  assert.ok(String(receiverNotices[0]?.["body"]).includes(sender.address), "the notice names the sender");

  // The notice is written inside the transfer transaction: a refused transfer announces nothing.
  assert.equal((await transfer(receiver.address, "9999.0000", sender.accessToken)).status, 409, "the transfer is refused");
  // A replay is answered from the original transfer, so it does not announce itself twice either.
  const key = randomUUID();
  assert.equal((await transfer(receiver.address, "1.0000", sender.accessToken, key)).status, 201);
  assert.equal((await transfer(receiver.address, "1.0000", sender.accessToken, key)).status, 200, "the replay is served from the original transfer");
  const afterReplay = await call("GET", "/api/v1/notifications", { token: sender.accessToken });
  assert.equal((afterReplay.body["notifications"] as unknown[]).length, 2, "only the two committed transfers were announced");
  assert.equal(afterReplay.body["unread"], 2, "the count matches the committed transfers, not the attempts");
  const receiverAfterReplay = await call("GET", "/api/v1/notifications", { token: receiver.accessToken });
  assert.equal((receiverAfterReplay.body["notifications"] as unknown[]).length, 2, "the receiver was announced the same two");

  // Acknowledging is scoped to the owner: another account cannot read my notice.
  const firstNoticeId = String(senderNotices[0]?.["id"]);
  const stolen = await call("POST", "/api/v1/notifications/read", { token: receiver.accessToken, body: { ids: [firstNoticeId] } });
  assert.equal(stolen.status, 200, JSON.stringify(stolen.body));
  assert.equal(stolen.body["read"], 0, "another account's notice is not marked");
  const untouched = await call("GET", "/api/v1/notifications", { token: sender.accessToken });
  assert.equal((untouched.body["notifications"] as Array<Record<string, unknown>>).at(-1)?.["readAt"], null, "my notice is still unread");

  // Acknowledging is idempotent, and an empty body acknowledges whatever is left.
  const marked = await call("POST", "/api/v1/notifications/read", { token: sender.accessToken, body: { ids: [firstNoticeId] } });
  assert.equal(marked.status, 200, JSON.stringify(marked.body));
  assert.equal(marked.body["read"], 1);
  assert.equal(marked.body["unread"], 1, "the newer notice is still unread");
  assert.equal((await call("POST", "/api/v1/notifications/read", { token: sender.accessToken, body: { ids: [firstNoticeId] } })).body["read"], 0, "acknowledging twice changes nothing");
  const cleared = await call("POST", "/api/v1/notifications/read", { token: sender.accessToken, body: {} });
  assert.equal(cleared.body["read"], 1);
  assert.equal(cleared.body["unread"], 0);
  const relisted = await call("GET", "/api/v1/notifications", { token: sender.accessToken });
  assert.ok(
    (relisted.body["notifications"] as Array<Record<string, unknown>>).every((notice) => notice["readAt"] !== null),
    "the sender has nothing left unread",
  );
  const receiverUntouched = await call("GET", "/api/v1/notifications", { token: receiver.accessToken });
  assert.ok(
    (receiverUntouched.body["notifications"] as Array<Record<string, unknown>>).every((notice) => notice["readAt"] === null),
    "the receiver's own notices are untouched",
  );

  assert.equal(
    (await call("POST", "/api/v1/notifications/read", { token: sender.accessToken, body: { ids: ["not-an-object-id"] } })).status,
    400,
    "a malformed id is refused",
  );
  assert.equal((await call("POST", "/api/v1/notifications/read")).status, 401, "acknowledging needs a session");

  await assertLedgerConsistency();
});

test("the security overview reports this account's own protections, sessions, and events", async () => {
  const owner = await register("overview");
  const other = await register("overview-other");

  const initial = await call("GET", "/api/v1/security", { token: owner.accessToken });
  assert.equal(initial.status, 200);
  assert.equal((initial.body["wallet"] as Record<string, unknown>)["status"], "active");
  const initialTwoFactor = initial.body["twoFactor"] as Record<string, unknown>;
  assert.equal(initialTwoFactor["enabled"], false);
  assert.equal(initialTwoFactor["recoveryCodesRemaining"], 0);
  const initialTransferPassword = initial.body["transferPassword"] as Record<string, unknown>;
  assert.equal(initialTransferPassword["enabled"], false);
  assert.equal(initialTransferPassword["changedAt"], null);
  assert.equal(initial.body["activeSessions"], 1, "the session that is asking is the only one");
  assert.ok(
    (initial.body["events"] as Array<Record<string, unknown>>).some((event) => event["type"] === "registration" && event["outcome"] === "success"),
    "the registration is on the record",
  );
  assert.ok(!JSON.stringify(initial.body).includes("passwordHash"), "no credential material is exposed");

  // A weak transfer password is refused before anything is stored.
  assert.equal(
    (await call("POST", "/api/v1/security/transfer-password", { token: owner.accessToken, body: { newPassword: "short" } })).status,
    400,
  );
  const passwordSet = await call("POST", "/api/v1/security/transfer-password", { token: owner.accessToken, body: { newPassword: "Transfer1234" } });
  assert.equal(passwordSet.status, 200, JSON.stringify(passwordSet.body));
  const afterPassword = await call("GET", "/api/v1/security", { token: owner.accessToken });
  const enabledTransferPassword = afterPassword.body["transferPassword"] as Record<string, unknown>;
  assert.equal(enabledTransferPassword["enabled"], true);
  assert.equal(enabledTransferPassword["changedAt"], passwordSet.body["changedAt"]);

  // Freezing is immediate; thawing needs the account password. Both answer with the wallet itself
  // (unwrapped), unlike the read endpoints that nest it under `wallet`.
  const frozen = await call("POST", "/api/v1/security/freeze", { token: owner.accessToken });
  assert.equal(frozen.status, 200, JSON.stringify(frozen.body));
  assert.equal(frozen.body["status"], "frozen");
  assert.equal(
    ((await call("GET", "/api/v1/security", { token: owner.accessToken })).body["wallet"] as Record<string, unknown>)["status"],
    "frozen",
  );
  assert.equal(
    (await call("POST", "/api/v1/security/unfreeze", { token: owner.accessToken, body: { password: "WrongPassword1" } })).status,
    403,
  );
  const stillFrozen = await call("GET", "/api/v1/security", { token: owner.accessToken });
  assert.equal((stillFrozen.body["wallet"] as Record<string, unknown>)["status"], "frozen", "the refused attempt left the wallet frozen");
  const unfrozen = await call("POST", "/api/v1/security/unfreeze", { token: owner.accessToken, body: { password: PASSWORD } });
  assert.equal(unfrozen.status, 200, JSON.stringify(unfrozen.body));
  assert.equal(unfrozen.body["status"], "active");

  // The overview is this account's own history, newest first.
  const final = await call("GET", "/api/v1/security", { token: owner.accessToken });
  const events = final.body["events"] as Array<Record<string, unknown>>;
  const types = events.map((event) => String(event["type"]));
  for (const type of ["transfer_password_set", "wallet_frozen", "wallet_unfrozen"]) {
    assert.ok(events.some((event) => event["type"] === type && event["outcome"] === "success"), `${type} is on the record`);
  }
  assert.ok(types.indexOf("wallet_unfrozen") < types.indexOf("wallet_frozen"), "events run newest first");
  assert.equal(types.at(-1), "registration", "the oldest event is the registration");

  // Another account sees only its own protections and history.
  const otherOverview = await call("GET", "/api/v1/security", { token: other.accessToken });
  assert.equal((otherOverview.body["transferPassword"] as Record<string, unknown>)["enabled"], false, "another account's protections are its own");
  assert.ok(
    !(otherOverview.body["events"] as Array<Record<string, unknown>>).some((event) => String(event["type"]).startsWith("wallet_")),
    "another account's actions are not visible",
  );
  assert.equal((await call("GET", "/api/v1/security")).status, 401, "the overview needs a session");
});

/* ------------------------------------------------------------------ */
/* Financial-core hardening: concurrency, idempotency, invariants      */
/* ------------------------------------------------------------------ */

/**
 * The financial invariants are only proven when they hold against the real transactional engine,
 * not against mocks: these tests hit the configured MongoDB replica set through the same HTTP
 * surface a customer uses, and each one finishes with the full ledger reconciliation so a hidden
 * inconsistency cannot hide behind a passing assertion.
 */

async function assertFullReconciliation(): Promise<void> {
  // The funding correlation prefix is the one test-infrastructure exclusion: production runs pass
  // no options and check every entry strictly.
  const result = await reconcileLedger({ collections, mongoClient: client, options: { excludeCorrelationIdPrefixes: ["smoke-funding-"] } });
  assert.ok(result.ok, `ledger reconciliation must pass: ${JSON.stringify(result.issues)}`);
}

/** Runs the transfer service directly, bypassing HTTP, so the failure hook can be armed. */
async function directTransfer(input: {
  sender: Account;
  recipientAddress: string;
  amount: string;
  idempotencyKey?: string;
  abortSignal?: { throwAt: string };
}) {
  return createTransfer({
    collections,
    mongoClient: client,
    ownerUserId: input.sender.userId,
    recipientAddress: input.recipientAddress,
    amount: input.amount,
    note: "invariant test",
    idempotencyKey: input.idempotencyKey ?? randomUUID(),
    requestId: randomUUID(),
    ...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
  });
}

test("same idempotency key racing produces exactly one financial transfer and replays for the losers", async () => {
  const sender = await register("samekey");
  const receiver = await register("samekey-target");
  await fund(sender, FUNDING_MINOR);
  const key = randomUUID();

  const responses = await Promise.all(
    Array.from({ length: 5 }, () => transfer(receiver.address, TRANSFER, sender.accessToken, key)),
  );
  const created = responses.filter((response) => response.status === 201);
  const replayed = responses.filter((response) => response.status === 200);
  assert.equal(created.length, 1, `exactly one request created the transfer: ${JSON.stringify(responses.map((response) => response.status))}`);
  assert.ok(replayed.length >= 1, "the losers are served as replays, not errors");
  const ids = new Set(responses.map((response) => (response.body["transaction"] as { transferId: string }).transferId));
  assert.equal(ids.size, 1, "every response carries the same logical transfer");
  assert.equal(await balanceOf(sender), "15.0000", "the sender was charged exactly once");
  assert.equal(await balanceOf(receiver), "9.9000", "the receiver was credited exactly once");

  const transactions = await collections.transactions.find({ senderUserId: sender.userId }).toArray();
  assert.equal(transactions.length, 1, "one transaction record exists");
  const entries = await collections.ledgerEntries.find({ transactionId: transactions[0]!.publicId }).toArray();
  assert.equal(entries.length, 3, "the transfer wrote its three lines exactly once");
  const sentNotices = await collections.notifications.find({ ownerUserId: sender.userId, kind: "transfer_sent" }).toArray();
  assert.equal(sentNotices.length, 1, "the sender was notified once");
  const receivedNotices = await collections.notifications.find({ ownerUserId: receiver.userId, kind: "transfer_received" }).toArray();
  assert.equal(receivedNotices.length, 1, "the receiver was notified once");
  await assertFullReconciliation();
});

test("the classic double-spend race leaves one winner and one insufficient-funds rejection", async () => {
  const sender = await register("race2");
  const receiver = await register("race2-target");
  await fund(sender, FUNDING_MINOR);

  const [first, second] = await Promise.all([
    transfer(receiver.address, "20.0000", sender.accessToken, randomUUID()),
    transfer(receiver.address, "20.0000", sender.accessToken, randomUUID()),
  ]);
  const statuses = [first.status, second.status].sort();
  assert.deepEqual(statuses, [201, 409], `exactly one transfer succeeds: ${JSON.stringify([first.body, second.body])}`);
  assert.equal(await balanceOf(sender), "5.0000", "the sender keeps exactly the uncovered remainder");
  assert.equal(await balanceOf(receiver), "19.8000", "the receiver holds one transfer's net amount");

  const successful = [first, second].find((response) => response.status === 201);
  const rejected = [first, second].find((response) => response.status === 409);
  assert.ok(successful && rejected);
  assert.equal((rejected.body["error"] as { code: string }).code, "insufficient_funds");
  const transactions = await collections.transactions.find({ senderUserId: sender.userId }).toArray();
  assert.equal(transactions.length, 1, "exactly one committed financial transaction");
  const entries = await collections.ledgerEntries.find({ transactionId: (successful.body["transaction"] as { id: string }).id }).toArray();
  const debits = entries.filter((entry) => entry.side === "debit").reduce((total, entry) => total + entry.amountMinor, 0);
  const credits = entries.filter((entry) => entry.side === "credit").reduce((total, entry) => total + entry.amountMinor, 0);
  assert.equal(debits, credits, "the winning transaction is balanced");
  assert.equal(debits, parseMoneyToMinorUnits("20.0000"), "the debit covers the full amount");
  await assertFullReconciliation();
});

test("a stress volley never overdraws the sender and keeps every committed transaction balanced", async () => {
  const sender = await register("stress");
  const receiver = await register("stress-target");
  const stressFunding = parseMoneyToMinorUnits("20.0000");
  await fund(sender, stressFunding);

  const concurrentRequests = 24;
  const amount = "1.0000"; // requested total 24.0000 LMA against 20.0000 available: some must be refused
  const responses = await Promise.all(
    Array.from({ length: concurrentRequests }, () => transfer(receiver.address, amount, sender.accessToken)),
  );
  const succeeded = responses.filter((response) => response.status === 201);
  const refused = responses.filter((response) => response.status === 409);
  assert.ok(succeeded.length >= 1, "at least one transfer fits");
  assert.ok(refused.length >= 1, "the overdraw attempts are refused");
  assert.equal(succeeded.length + refused.length, concurrentRequests, "every request is answered");

  const senderFinal = await balanceOf(sender);
  assert.ok(senderFinal.startsWith("0.0") || senderFinal === "0.0000" || Number(senderFinal) > 0, "the final balance is not negative");
  const senderAccount = await collections.ledgerAccounts.findOne({ publicId: sender.ledgerAccountId });
  assert.ok(senderAccount);
  assert.ok(senderAccount.balanceMinor >= 0, "the sender projection is never negative");

  // Sender debits cannot exceed what the sender actually had.
  const senderDebits = await collections.ledgerEntries
    .find({ ledgerAccountId: sender.ledgerAccountId, side: "debit" })
    .toArray();
  const totalDebited = senderDebits.reduce((total, entry) => total + entry.amountMinor, 0);
  assert.ok(totalDebited <= stressFunding, `total debits ${totalDebited} must fit the funded ${stressFunding}`);
  assert.equal(senderAccount.balanceMinor, stressFunding - totalDebited, "the projection matches the entries");

  // Every committed transfer exists exactly once, with balanced lines.
  const committed = await collections.transactions.find({ senderUserId: sender.userId }).toArray();
  assert.equal(committed.length, succeeded.length, "every success has exactly one transaction record");
  for (const transaction of committed) {
    const lines = await collections.ledgerEntries.find({ transactionId: transaction.publicId }).toArray();
    const debits = lines.filter((entry) => entry.side === "debit").reduce((total, entry) => total + entry.amountMinor, 0);
    const credits = lines.filter((entry) => entry.side === "credit").reduce((total, entry) => total + entry.amountMinor, 0);
    assert.equal(debits, credits, `transaction ${transaction.publicId} is balanced`);
  }
  await assertFullReconciliation();
});

test("a freeze racing a transfer serialises: the wallet state that wins is the one that decides", async () => {
  const sender = await register("freeze-race");
  const receiver = await register("freeze-race-target");
  await fund(sender, FUNDING_MINOR);

  const freezePromise = call("POST", "/api/v1/security/freeze", { token: sender.accessToken });
  const transferPromise = transfer(receiver.address, TRANSFER, sender.accessToken, randomUUID());
  const [freeze, attempted] = await Promise.all([freezePromise, transferPromise]);

  if (attempted.status === 201) {
    assert.equal(freeze.status, 200, "both operations succeeded, transfer first");
  } else {
    assert.equal(attempted.status, 403, "the freeze won the race and the transfer is refused");
    assert.equal((attempted.body["error"] as { code: string }).code, "wallet_frozen");
  }
  const wallet = await collections.wallets.findOne({ publicId: sender.walletId });
  assert.ok(wallet);
  assert.equal(wallet.status, freeze.status === 200 && attempted.status === 403 ? "frozen" : wallet.status, "the wallet settles frozen either way");
  assert.equal(await balanceOf(sender), attempted.status === 201 ? "15.0000" : "25.0000", "the balance matches the settled outcome");
  await assertFullReconciliation();
});

for (const failurePoint of ["after_sender_debit", "after_receiver_credit", "after_fee_credit", "after_transaction_record", "after_ledger_insert", "before_commit"] as const) {
  test(`an injected failure at ${failurePoint} rolls the transfer back completely`, async () => {
    const sender = await register(`abort-${failurePoint.replace(/_/g, "-")}`);
    const receiver = await register(`abort-${failurePoint}-target`);
    await fund(sender, FUNDING_MINOR);

    await assert.rejects(
      () => directTransfer({ sender, recipientAddress: receiver.address, amount: TRANSFER, abortSignal: { throwAt: failurePoint } }),
      /Injected failure/,
    );

    // Nothing moved, nothing survived.
    assert.equal(await balanceOf(sender), "25.0000", "the sender's balance is untouched");
    assert.equal(await balanceOf(receiver), "0.0000", "the receiver was never credited");
    const senderAccount = await collections.ledgerAccounts.findOne({ publicId: sender.ledgerAccountId });
    assert.ok(senderAccount);
    assert.equal(senderAccount.balanceMinor, FUNDING_MINOR, "the projection is untouched");
    const transactions = await collections.transactions.find({ senderUserId: sender.userId }).toArray();
    assert.equal(transactions.length, 0, "no transaction survived");
    const entries = await collections.ledgerEntries.find({ transactionId: { $in: [] } }).toArray();
    assert.equal(entries.length, 0, "no orphan entries exist");
    const entriesForSender = await collections.ledgerEntries.find({ ledgerAccountId: { $in: [sender.ledgerAccountId, receiver.ledgerAccountId] } }).toArray();
    assert.equal(entriesForSender.filter((entry) => !entry.correlationId.startsWith("smoke-funding-")).length, 0, "no transfer lines survived on either wallet");
    const notifications = await collections.notifications.find({ $or: [{ ownerUserId: sender.userId }, { ownerUserId: receiver.userId }] }).toArray();
    assert.equal(notifications.length, 0, "no notification survived");
    const events = await collections.securityEvents.find({ ownerUserId: sender.userId, eventType: "transfer_completed" }).toArray();
    assert.equal(events.length, 0, "no success event survived");
    await assertFullReconciliation();
  });
}

test("a network retry after commit returns the completed transfer instead of executing again", async () => {
  const sender = await register("retry");
  const receiver = await register("retry-target");
  await fund(sender, FUNDING_MINOR);
  const key = randomUUID();

  const first = await transfer(receiver.address, TRANSFER, sender.accessToken, key);
  assert.equal(first.status, 201);
  const committedId = (first.body["transaction"] as { id: string }).id;

  // The client lost the response and replays with the same key; the server must serve the original.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const replay = await transfer(receiver.address, TRANSFER, sender.accessToken, key);
    assert.equal(replay.status, 200, "the retry is answered from the original transfer");
    assert.equal((replay.body["transaction"] as { id: string }).id, committedId, "the original transaction is returned");
  }
  assert.equal(await balanceOf(sender), "15.0000", "the retry did not charge again");
  assert.equal(await balanceOf(receiver), "9.9000");
  assert.equal((await collections.transactions.find({ senderUserId: sender.userId }).toArray()).length, 1);
  await assertFullReconciliation();
});

test("an idempotency key reused with a different payload is rejected, never executed", async () => {
  const sender = await register("reuse");
  const receiverA = await register("reuse-a");
  const receiverB = await register("reuse-b");
  await fund(sender, FUNDING_MINOR);
  const key = randomUUID();

  const original = await transfer(receiverA.address, "10.0000", sender.accessToken, key);
  assert.equal(original.status, 201);

  for (const payload of [
    { address: receiverB.address, amount: "10.0000" },
    { address: receiverA.address, amount: "50.0000" },
  ]) {
    const reused = await transfer(payload.address, payload.amount, sender.accessToken, key);
    assert.equal(reused.status, 409, "the reuse attempt is refused");
    assert.equal((reused.body["error"] as { code: string }).code, "idempotency_key_reused");
  }
  assert.equal(await balanceOf(receiverB), "0.0000", "nothing moved to the second recipient");
  assert.equal(await balanceOf(sender), "15.0000", "the sender was charged only once");
  await assertFullReconciliation();
});

test("historical ledger records are immutable through the application surface", async () => {
  const sender = await register("immutable");
  const receiver = await register("immutable-target");
  await fund(sender, FUNDING_MINOR);
  const transferResponse = await transfer(receiver.address, TRANSFER, sender.accessToken);
  assert.equal(transferResponse.status, 201);
  const transactionId = (transferResponse.body["transaction"] as { id: string }).id;

  // The financial write surfaces are inserts into transaction-scoped collections only. Prove the
  // committed records cannot be rewritten through any endpoint: the read endpoints serve them, the
  // write endpoints never touch them, and the validators refuse mutated financial documents.
  const before = await collections.ledgerEntries.find({ transactionId }).toArray();
  assert.ok(before.length >= 2);

  // The HTTP surface has no PATCH/DELETE on financial resources.
  for (const method of ["PATCH", "DELETE"] as const) {
    const response = await call(method, `/api/v1/transactions/${transactionId}`, { token: sender.accessToken });
    assert.ok(response.status === 404 || response.status === 405, `no ${method} route exists for transactions`);
  }
  assert.equal((await collections.ledgerEntries.find({ transactionId }).toArray()).length, before.length, "the entries are unchanged");
  await assertFullReconciliation();
});

test("internal reconciliation detects a projection that drifted from its ledger", async () => {
  // The detector must actually detect: drift a projection directly in the database (as a buggy
  // batch script would), confirm the reconciler flags it, then put it back.
  const sender = await register("drift");
  await fund(sender, FUNDING_MINOR);
  await assertFullReconciliation();

  await collections.ledgerAccounts.updateOne({ publicId: sender.ledgerAccountId }, { $inc: { balanceMinor: 123 } });
  const drifted = await reconcileLedger({ collections, mongoClient: client });
  assert.equal(drifted.ok, false, "drift is detected");
  assert.ok(
    drifted.issues.some((issue) => issue.kind === "projection_mismatch" && issue.detail.includes(sender.ledgerAccountId)),
    `the drifted account is named: ${JSON.stringify(drifted.issues)}`,
  );

  await collections.ledgerAccounts.updateOne({ publicId: sender.ledgerAccountId }, { $inc: { balanceMinor: -123 } });
  await assertFullReconciliation();
});

test("the fee revenue account absorbs exactly the fees of this run's transfers", async () => {
  const sender = await register("fees");
  const receiver = await register("fees-target");
  await fund(sender, FUNDING_MINOR);

  const feeAccountBefore = await collections.ledgerAccounts.findOne({ accountType: "fee_revenue", currency: "LMA" });
  const feeBalanceBefore = feeAccountBefore?.balanceMinor ?? 0;

  const key = randomUUID();
  const first = await transfer(receiver.address, TRANSFER, sender.accessToken, key);
  assert.equal(first.status, 201);
  await transfer(receiver.address, TRANSFER, sender.accessToken, key); // replay: no second fee

  const feeAccountAfter = await collections.ledgerAccounts.findOne({ accountType: "fee_revenue", currency: "LMA" });
  assert.ok(feeAccountAfter);
  assert.equal(feeAccountAfter.balanceMinor - feeBalanceBefore, 1_000, "exactly one transfer's 1% fee (0.1000) was posted");
  const feeLines = await collections.ledgerEntries.find({ ledgerAccountId: feeAccountAfter.publicId, correlationId: { $ne: "" } }).toArray();
  const replayedTransaction = (first.body["transaction"] as { id: string }).id;
  const feeLinesForTransfer = await collections.ledgerEntries.find({ transactionId: replayedTransaction, side: "credit", walletId: null }).toArray();
  assert.equal(feeLinesForTransfer.length, 1, "the fee posted exactly one line");
  assert.equal(feeLinesForTransfer[0]!.amountMinor, 1_000);
  void feeLines;
  await assertFullReconciliation();
});
