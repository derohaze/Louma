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

/**
 * Integration test against the configured MongoDB cluster.
 *
 * It is deliberately outside `npm test`, because it needs a real database (transactions require a
 * replica set): run it with `npm run test:integration`. Every document it creates is removed in
 * `after()`, and the shared fee account is restored to the balance it had before the run.
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
let feeAccountOriginalBalance = 0;

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

async function call(
  method: "GET" | "POST" | "PATCH" | "DELETE",
  url: string,
  options: { token?: string; cookie?: string; body?: unknown; idempotencyKey?: string } = {},
) {
  const headers: Record<string, string> = {};
  if (options.token) headers["authorization"] = `Bearer ${options.token}`;
  if (options.cookie) headers["cookie"] = options.cookie;
  if (options.idempotencyKey) headers["idempotency-key"] = options.idempotencyKey;
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
  return {
    status: response.statusCode,
    body,
    cookie: Array.isArray(setCookie) ? (setCookie[0] ?? "") : ((setCookie as string | undefined) ?? ""),
  };
}

async function register(label: string): Promise<Account> {
  const email = `smoke.${label}.${randomUUID()}@example.test`;
  const response = await call("POST", "/api/v1/auth/register", {
    body: { email, password: PASSWORD, displayName: `Smoke ${label}` },
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

/** Test-only funding line: one credit entry, with its projection updated in the same shape. */
async function fund(account: Account, amountMinor: number): Promise<void> {
  const transactionId = randomUUID();
  createdTransactionIds.push(transactionId);
  await collections.ledgerEntries.insertOne({
    publicId: randomUUID(),
    transactionId,
    lineNumber: 1,
    walletId: account.walletId,
    ledgerAccountId: account.ledgerAccountId,
    side: "credit",
    amountMinor,
    currency: "LMA",
    correlationId: `smoke-funding-${transactionId}`,
    createdAt: new Date(),
  } as never);
  await collections.ledgerAccounts.updateOne({ publicId: account.ledgerAccountId }, { $inc: { balanceMinor: amountMinor } });
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
  const revenue = await collections.ledgerAccounts.findOne({ accountType: "fee_revenue", currency: "LMA" });
  feeAccountOriginalBalance = revenue?.balanceMinor ?? 0;
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
    for (const ledgerAccountId of createdLedgerAccountIds) {
      await collections.ledgerEntries.deleteMany({ ledgerAccountId });
      await collections.ledgerAccounts.deleteMany({ publicId: ledgerAccountId });
    }
    // The fee account outlives the test, so its own ledger lines are removed by transaction id.
    await collections.ledgerEntries.deleteMany({ transactionId: { $in: createdTransactionIds } });
    await collections.transactions.deleteMany({ $or: [{ publicId: { $in: createdTransactionIds } }, { transferId: { $in: createdTransactionIds } }] });
    // The shared fee account is a projection of its own entries: restore it exactly as it was.
    await collections.ledgerAccounts.updateOne({ accountType: "fee_revenue", currency: "LMA" }, { $set: { balanceMinor: feeAccountOriginalBalance } });
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
    () => collections.wallets.insertOne({ publicId: first.walletId, address: "LMA-0000-0000-0000", addressNormalized: "LMA-0000-0000-0000", ownerUserId: randomUUID(), status: "active", createdAt: new Date(), updatedAt: new Date(), customAddressChangedAt: null, customAddress: null, customAddressNormalized: null } as never),
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

  // Enabling and confirming both require the account password, and the secret stays server-side.
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

  // Turning it off needs the password and a current code, and restores simple sign-in.
  assert.equal((await call("POST", "/api/v1/security/2fa/disable", { token: twoFactorToken, body: { password: PASSWORD, code: await wrongTotpCode() } })).status, 403);
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
