import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { ObjectId, type Db, type MongoClient } from "mongodb";
import { generate, generateSecret } from "otplib";
import { buildApp } from "../app.js";
import { loadConfig, type AppConfig } from "../config/env.js";
import { connectMongo } from "../infrastructure/mongodb/client.js";
import { ensureDatabaseIndexes } from "../infrastructure/mongodb/indexes.js";
import { getCollections, type Collections } from "../infrastructure/mongodb/collections.js";
import { disabledRedis } from "../infrastructure/redis/client.js";
import { parseMoneyToMinorUnits } from "../modules/ledger/money.js";
import { reconcileLedger, TEST_FUNDING_CORRELATION_PREFIXES } from "../modules/ledger/reconciliation.js";
import { createTransfer, previewTransfer } from "../modules/transfers/service.js";
import { encryptSecret } from "../modules/security/crypto.js";
import { isTransferTransaction } from "../shared/types.js";
import { resetFinancialControlsCache, setFinancialControls } from "../modules/financial-controls/service.js";
import { generateWalletAddress } from "../modules/wallets/address.js";

/**
 * The adversarial suite for the transfer authorization state machine.
 *
 * It targets the properties the money depends on rather than the happy path: one approved intent can
 * be executed at most once, an accepted authenticator step can approve at most one financial
 * operation, a failed transfer burns neither the approval nor the code, the parameters an approval
 * names are the parameters the ledger executes, and every projection equals its immutable entries.
 *
 * Concurrency here is real: the racing calls are issued simultaneously against the configured
 * cluster, and the invariants are asserted on what the database ended up holding — never on the
 * order in which the responses happened to arrive.
 *
 * It calls the same service functions the HTTP routes call (`previewTransfer`, `createTransfer`),
 * which is what lets it run dozens of races, and covers the route layer's own requirement in
 * "a direct call cannot move money without a server-issued approval". Run it with
 * `npm run test:integration:transfers`.
 */

const FUNDING_MINOR = parseMoneyToMinorUnits("25.0000");
const TRANSFER = "10.0000";

let app: Awaited<ReturnType<typeof buildApp>>;
let client: MongoClient;
let db: Db;
let config: AppConfig;
let collections: Collections;
const createdUserIds: string[] = [];
const createdLedgerAccountIds: string[] = [];
const createdTransactionIds: string[] = [];
const createdTreasuryAccountIds: string[] = [];
let treasuryFundedMinor = 0;
/** The operator control row this run found, so it can be put back exactly as it was. */
let priorFinancialControls: Record<string, unknown> | null = null;

interface Account {
  userId: string;
  walletId: string;
  address: string;
  ledgerAccountId: string;
}

const codeOf = (error: unknown): unknown => (error as { code?: unknown }).code;

type SendResult = Awaited<ReturnType<typeof send>>;
type Settled = PromiseSettledResult<SendResult>;
const fulfilledOf = (settled: Settled[]): PromiseFulfilledResult<SendResult>[] =>
  settled.filter((result): result is PromiseFulfilledResult<SendResult> => result.status === "fulfilled");
const rejectedOf = (settled: Settled[]): PromiseRejectedResult[] =>
  settled.filter((result): result is PromiseRejectedResult => result.status === "rejected");

/** Asserts that a call was refused with a specific product code, and returns the error. */
async function expectRefusal(promise: Promise<unknown>, code: string, label: string) {
  try {
    await promise;
  } catch (error) {
    assert.equal(codeOf(error), code, `${label}: expected ${code}, got ${JSON.stringify({ code: codeOf(error), message: (error as Error).message })}`);
    return error;
  }
  assert.fail(`${label}: expected ${code}, but the call succeeded`);
}

/**
 * One account, created the way registration creates one: the user, the wallet, and the wallet's
 * ledger account. Registration through the endpoint costs an Argon2 hash and a session transaction
 * per account, which would dominate this suite's runtime without testing anything it is about.
 */
async function createAccount(label: string, funded = false): Promise<Account> {
  const user = await createAccountRecord(label);
  if (funded) await fund(user, FUNDING_MINOR);
  return user;
}

async function createAccountRecord(label: string): Promise<Account> {
  const now = new Date();
  const userId = randomUUID();
  const walletId = randomUUID();
  const ledgerAccountId = randomUUID();
  const address = generateWalletAddress();
  await collections.users.insertOne({
    _id: new ObjectId(),
    publicId: userId,
    email: `adversarial.${label}.${randomUUID()}@example.test`,
    passwordHash: "$argon2id$v=19$m=19456,t=2,p=1$YWR2ZXJzYXJpYWx0ZXN0$YWR2ZXJzYXJpYWx0ZXN0",
    profile: { displayName: `Adversarial ${label}`.slice(0, 32), country: null },
    status: "active",
    emailVerifiedAt: now,
    createdAt: now,
    updatedAt: now,
  } as never);
  await collections.wallets.insertOne({
    _id: new ObjectId(),
    publicId: walletId,
    address,
    addressNormalized: address,
    addressVersion: 1,
    ownerUserId: userId,
    isPrimary: true,
    status: "active",
    financialVersion: 0,
    createdAt: now,
    updatedAt: now,
    customAddressChangedAt: null,
    customAddress: null,
    customAddressNormalized: null,
  } as never);
  await collections.ledgerAccounts.insertOne({
    _id: new ObjectId(),
    publicId: ledgerAccountId,
    walletId,
    accountType: "wallet",
    currency: "LMA",
    balanceMinor: 0,
    createdAt: now,
  } as never);
  createdUserIds.push(userId);
  createdLedgerAccountIds.push(ledgerAccountId);
  return { userId, walletId, address, ledgerAccountId };
}

/** Test-only funding, recorded exactly as a controlled treasury issuance would be. */
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
  if (ensured.upsertedId) createdTreasuryAccountIds.push(treasury.publicId);
  treasuryFundedMinor += amountMinor;
  const now = new Date();
  await collections.ledgerEntries.insertMany(
    [
      { publicId: randomUUID(), transactionId, lineNumber: 1, walletId: null, ledgerAccountId: treasury.publicId, side: "debit", amountMinor, currency: "LMA", correlationId: `adversarial-funding-${transactionId}`, createdAt: now },
      { publicId: randomUUID(), transactionId, lineNumber: 2, walletId: account.walletId, ledgerAccountId: account.ledgerAccountId, side: "credit", amountMinor, currency: "LMA", correlationId: `adversarial-funding-${transactionId}`, createdAt: now },
    ] as never,
  );
  await collections.ledgerAccounts.updateMany({ $or: [{ publicId: account.ledgerAccountId }, { _id: treasury._id }] }, { $inc: { balanceMinor: amountMinor } });
}

/** The wizard's amount stage: the server computes the intent and issues the approval. */
async function approve(account: Account, address: string, amount: string, note = "") {
  const preview = await previewTransfer({
    collections,
    ownerUserId: account.userId,
    recipientAddress: address,
    amount,
    note,
    requestId: randomUUID(),
  });
  assert.ok(preview.authorization, "the preview must issue an approval for a quoted amount");
  return preview.authorization;
}

/** The transfer itself: it consumes the approval and executes the intent inside it. */
async function send(input: {
  sender: Account;
  authorizationId: string | null;
  address: string;
  amount: string;
  note?: string;
  key?: string;
  twoFactorCode?: string;
  abortSignal?: { throwAt: string };
}) {
  const result = await createTransfer({
    collections,
    mongoClient: client,
    config,
    ownerUserId: input.sender.userId,
    authorizationId: input.authorizationId,
    recipientAddress: input.address,
    amount: input.amount,
    note: input.note ?? "",
    idempotencyKey: input.key ?? randomUUID(),
    requestId: randomUUID(),
    ...(input.twoFactorCode === undefined ? {} : { twoFactorCode: input.twoFactorCode }),
    ...(input.abortSignal === undefined ? {} : { abortSignal: input.abortSignal }),
  });
  createdTransactionIds.push(result.id);
  return result;
}

/**
 * A real authenticator code. The server accepts a code only inside its own 30-second step, and the
 * approvals that follow one are round trips to a remote replica set, so a code minted near the end
 * of a step would be judged in the next one and read as a wrong code instead of as the replay being
 * tested. Waiting for a step with at least fifteen seconds left removes that race.
 */
async function totpCode(secret: string): Promise<string> {
  const remainingSeconds = 30 - (Math.floor(Date.now() / 1000) % 30);
  if (remainingSeconds < 15) await new Promise((resolve) => setTimeout(resolve, (remainingSeconds + 1) * 1000));
  return generate({ secret });
}

/** An account with an enabled authenticator, written the way the enrolment endpoints write one. */
async function enableTwoFactor(account: Account): Promise<string> {
  const secret = generateSecret();
  const encrypted = encryptSecret(secret, config.encryptionKey);
  const now = new Date();
  await collections.twoFactorCredentials.insertOne({
    _id: new ObjectId(),
    ownerUserId: account.userId,
    encryptedSecret: encrypted.encryptedSecret,
    secretIv: encrypted.iv,
    secretAuthTag: encrypted.authTag,
    pendingExpiresAt: null,
    enabledAt: now,
    recoveryCodeHashes: [],
    createdAt: now,
    updatedAt: now,
  } as never);
  return secret;
}

async function balanceMinorOf(ledgerAccountId: string): Promise<number> {
  const account = await collections.ledgerAccounts.findOne({ publicId: ledgerAccountId });
  assert.ok(account, `ledger account ${ledgerAccountId} exists`);
  return account.balanceMinor;
}

const transferCountOf = (account: Account) => collections.transactions.countDocuments({ senderUserId: account.userId, type: "transfer" });

/**
 * The account's own balance recomputed from the immutable entries, on the account's normal side —
 * credit-normal for wallets and fee revenue, debit-normal for the treasury (see reconciliation.ts).
 * Deliberately an independent implementation: if the production reconciler and this formula ever
 * disagreed, one of them is wrong and the test must notice.
 */
async function deriveBalance(accountType: string, ledgerAccountId: string): Promise<number> {
  const entries = await collections.ledgerEntries.find({ ledgerAccountId }).toArray();
  const sign = accountType === "system_treasury" ? 1 : -1;
  return entries.reduce((total, entry) => total + (entry.side === "credit" ? -entry.amountMinor : entry.amountMinor) * sign, 0);
}

/** Every projection in the database must equal the sum of its own immutable entries. */
async function assertAccountsInvolvedMatchLedger(accounts: Account[]): Promise<void> {
  const ledgerAccountIds = [
    ...accounts.map((account) => account.ledgerAccountId),
    ...((await collections.ledgerAccounts.find({ accountType: { $in: ["fee_revenue", "system_treasury"] } }).toArray()).map((account) => account.publicId)),
  ];
  for (const account of await collections.ledgerAccounts.find({ publicId: { $in: ledgerAccountIds } }).toArray()) {
    assert.equal(account.balanceMinor, await deriveBalance(account.accountType, account.publicId), `account ${account.publicId} (${account.accountType}) must equal its ledger-derived balance`);
    assert.ok(account.balanceMinor >= 0, `account ${account.publicId} must never be negative`);
  }
}

async function assertFullReconciliation(): Promise<void> {
  const result = await reconcileLedger({
    collections,
    mongoClient: client,
    // The funding lines are test infrastructure, not ledger history: they are minted through a
    // deliberately unrecorded treasury debit (see `fund`), so they have no transaction header by
    // construction. Both suites' funding prefixes are excluded, not only this file's: an integration
    // run killed before its teardown leaves its own funding lines behind, and reporting them here
    // would read as a financial defect when it is abandoned test data. The maintenance answer is
    // `npm run cleanup:test-accounts:dev -- --apply`.
    options: { excludeCorrelationIdPrefixes: TEST_FUNDING_CORRELATION_PREFIXES },
  });
  assert.ok(result.ok, `ledger reconciliation must pass: ${JSON.stringify(result.issues)}`);
}

before(async () => {
  config = loadConfig();
  const connection = await connectMongo(config, { serverSelectionTimeoutMS: 30_000, connectTimeoutMS: 20_000 });
  client = connection.client;
  db = connection.db;
  collections = getCollections(db);
  await ensureDatabaseIndexes(db);
  app = await buildApp({ config, collections, mongoClient: client, redis: disabledRedis(), logger: false });
  priorFinancialControls = (await collections.financialControls.findOne({ _id: "global" })) as unknown as Record<string, unknown> | null;
});

after(async () => {
  if (!collections) return;
  // Both halves of the cleanup come from one query: a transfer that committed while its client saw a
  // timeout, an abort, or an ambiguous outcome has no remembered id, and deleting its journal header
  // by owner while leaving its ledger lines behind would hand the next run's reconciliation orphan
  // entries that read as a financial defect rather than as abandoned test data.
  const runTransactions = await collections.transactions
    .find({ $or: [{ senderUserId: { $in: createdUserIds } }, { receiverUserId: { $in: createdUserIds } }] })
    .toArray();
  const runTransferIds = runTransactions.filter(isTransferTransaction).map((transaction) => transaction.transferId);
  const runTransactionIds = [...new Set([...createdTransactionIds, ...runTransactions.map((transaction) => transaction.publicId), ...runTransferIds])];
  for (const userId of createdUserIds) {
    await collections.sessions.deleteMany({ ownerUserId: userId });
    await collections.securityEvents.deleteMany({ ownerUserId: userId });
    await collections.twoFactorCredentials.deleteMany({ ownerUserId: userId });
    await collections.transferPasswordCredentials.deleteMany({ ownerUserId: userId });
    await collections.transferAuthorizations.deleteMany({ ownerUserId: userId });
    await collections.twoFactorUses.deleteMany({ ownerUserId: userId });
    await collections.notifications.deleteMany({ ownerUserId: userId });
    // Wallets and their owners go last, after the ledger accounts below: an interrupted run must
    // not leave a wallet account whose wallet is already gone (unreachable to cleanup and reported
    // as a projection mismatch by the next suite's reconciliation).
  }
  const feeAccount = await collections.ledgerAccounts.findOne({ accountType: "fee_revenue", currency: "LMA" });
  const feeDelta = feeAccount
    ? (await collections.ledgerEntries.find({ ledgerAccountId: feeAccount.publicId, transactionId: { $in: runTransactionIds } }).toArray()).reduce(
        (total, entry) => total + (entry.side === "credit" ? entry.amountMinor : -entry.amountMinor),
        0,
      )
    : 0;
  for (const ledgerAccountId of createdLedgerAccountIds) {
    await collections.ledgerEntries.deleteMany({ ledgerAccountId });
    await collections.ledgerAccounts.deleteMany({ publicId: ledgerAccountId });
  }
  await collections.ledgerEntries.deleteMany({ transactionId: { $in: runTransactionIds } });
  await collections.transactions.deleteMany({ $or: [{ publicId: { $in: runTransactionIds } }, { transferId: { $in: runTransactionIds } }] });
  if (feeAccount && feeDelta !== 0) await collections.ledgerAccounts.updateOne({ _id: feeAccount._id }, { $inc: { balanceMinor: -feeDelta } });
  if (treasuryFundedMinor !== 0) await collections.ledgerAccounts.updateOne({ accountType: "system_treasury", currency: "LMA" }, { $inc: { balanceMinor: -treasuryFundedMinor } });
  await collections.ledgerAccounts.deleteMany({ publicId: { $in: createdTreasuryAccountIds } });
  // Last, once every ledger account is gone: wallets and their owners.
  for (const userId of createdUserIds) {
    await collections.wallets.deleteMany({ ownerUserId: userId });
    await collections.users.deleteMany({ publicId: userId });
  }
  // The operator controls belong to whoever set them: this run restores exactly what it found.
  if (priorFinancialControls) await collections.financialControls.replaceOne({ _id: "global" }, priorFinancialControls as never, { upsert: true });
  else await collections.financialControls.deleteMany({ _id: "global" });
  resetFinancialControlsCache();
  await app?.close();
  await client?.close();
});

test("the transfer executes the approved intent, not the request that carries it", async () => {
  const sender = await createAccount("intent-sender", true);
  const receiverA = await createAccount("intent-a");
  const receiverB = await createAccount("intent-b");

  const approval = await approve(sender, receiverA.address, TRANSFER, "rent");
  assert.deepEqual(approval.intent, {
    recipientAddress: receiverA.address,
    amount: "10.0000",
    fee: "0.1000",
    netAmount: "9.9000",
    currency: "LMA",
  });

  // A different amount, a different recipient, and a different note are each refused, and none of
  // them moves money: the approval is the only description of the transfer that counts.
  await expectRefusal(send({ sender, authorizationId: approval.id, address: receiverA.address, amount: "5.0000", note: "rent" }), "transfer_authorization_mismatch", "amount tampering");
  await expectRefusal(send({ sender, authorizationId: approval.id, address: receiverB.address, amount: TRANSFER, note: "rent" }), "transfer_authorization_mismatch", "recipient mutation");
  await expectRefusal(send({ sender, authorizationId: approval.id, address: receiverA.address, amount: TRANSFER, note: "not rent" }), "transfer_authorization_mismatch", "note tampering");
  assert.equal(await balanceMinorOf(sender.ledgerAccountId), FUNDING_MINOR, "no mismatch moved a minor unit");
  assert.equal(await balanceMinorOf(receiverB.ledgerAccountId), 0);
  assert.equal(await transferCountOf(sender), 0);

  // Exactly the approved intent still goes through afterwards: nothing was burned by the refusals.
  const executed = await send({ sender, authorizationId: approval.id, address: receiverA.address, amount: TRANSFER, note: "rent" });
  assert.equal(executed.amount, "10.0000");
  assert.equal(await balanceMinorOf(sender.ledgerAccountId), FUNDING_MINOR - parseMoneyToMinorUnits(TRANSFER));
  assert.equal(await balanceMinorOf(receiverA.ledgerAccountId), parseMoneyToMinorUnits("9.9000"));
  await assertAccountsInvolvedMatchLedger([sender, receiverA, receiverB]);
});

test("a direct call cannot move money without a server-issued approval", async () => {
  const sender = await createAccount("bypass-sender", true);
  const receiver = await createAccount("bypass-receiver");

  // A well-formed approval id that nobody issued is refused as missing — the same answer for one
  // that exists but belongs to another account, so the endpoint is no oracle for approvals.
  await expectRefusal(send({ sender, authorizationId: randomUUID(), address: receiver.address, amount: TRANSFER }), "not_found", "fabricated approval");
  // A malformed one is refused as bad input rather than looked up.
  await expectRefusal(send({ sender, authorizationId: "not-a-uuid", address: receiver.address, amount: TRANSFER }), "invalid_authorization", "malformed approval");
  // A credential proof without an approval is still refused: a proof is not a permission.
  await expectRefusal(
    send({ sender, authorizationId: randomUUID(), address: receiver.address, amount: TRANSFER, twoFactorCode: "123456" }),
    "not_found",
    "proof without approval",
  );
  assert.equal(await balanceMinorOf(sender.ledgerAccountId), FUNDING_MINOR, "no bypass attempt moved money");
  assert.equal(await transferCountOf(sender), 0, "no bypass attempt wrote a transaction");

  // The route layer requires the approval itself. Validation runs before the authentication
  // preHandler, so an unauthenticated body missing `authorizationId` is answered 400 by the schema,
  // while the same body carrying one reaches the auth guard and is answered 401 — which is what
  // proves the 400 came from the missing field and not from an authentication refusal.
  const withoutField = await app.inject({
    method: "POST",
    url: "/api/v1/transfers",
    headers: { "idempotency-key": randomUUID() },
    payload: { recipientAddress: receiver.address, amount: TRANSFER },
  });
  assert.equal(withoutField.statusCode, 400, "the transfer route requires an authorization id in the body");
  const withField = await app.inject({
    method: "POST",
    url: "/api/v1/transfers",
    headers: { "idempotency-key": randomUUID() },
    payload: { authorizationId: randomUUID(), recipientAddress: receiver.address, amount: TRANSFER },
  });
  assert.equal(withField.statusCode, 401, "with the approval present the same request is refused for authentication");
});

test("one approval is executed at most once, even under simultaneous requests", async () => {
  const sender = await createAccount("single-use", true);
  const receiver = await createAccount("single-use-target");
  const approval = await approve(sender, receiver.address, TRANSFER);

  const settled = await Promise.allSettled(
    Array.from({ length: 5 }, () => send({ sender, authorizationId: approval.id, address: receiver.address, amount: TRANSFER })),
  );
  const fulfilled = fulfilledOf(settled);
  const rejected = rejectedOf(settled);
  assert.equal(fulfilled.length, 1, `exactly one request executes the approval: ${JSON.stringify(rejected.map((result) => [codeOf(result.reason), (result.reason as Error).message]))}`);
  for (const failure of rejected) {
    assert.equal(codeOf(failure.reason), "transfer_authorization_used", `a losing request is refused as already used, not faulted: ${(failure.reason as Error).message}`);
  }
  assert.equal(await balanceMinorOf(sender.ledgerAccountId), FUNDING_MINOR - parseMoneyToMinorUnits(TRANSFER), "the sender was debited exactly once");
  assert.equal(await balanceMinorOf(receiver.ledgerAccountId), parseMoneyToMinorUnits("9.9000"), "the receiver was credited exactly once");
  assert.equal(await transferCountOf(sender), 1);
  assert.equal(await collections.notifications.countDocuments({ ownerUserId: { $in: [sender.userId, receiver.userId] } }), 2, "exactly one pair of notices was written");
  const consumed = await collections.transferAuthorizations.findOne({ publicId: approval.id });
  assert.ok(consumed?.consumedAt instanceof Date, "the approval records when it was consumed");
  assert.equal(consumed.consumedByTransactionPublicId, fulfilled[0]!.value.id, "the approval names the transaction it authorised");
  await assertFullReconciliation();
});

test("one idempotency key under simultaneous requests produces one effect and replays for the rest", async () => {
  const sender = await createAccount("samekey", true);
  const receiver = await createAccount("samekey-target");
  const approval = await approve(sender, receiver.address, TRANSFER);
  const key = randomUUID();

  const responses = await Promise.all(
    Array.from({ length: 5 }, () => send({ sender, authorizationId: approval.id, address: receiver.address, amount: TRANSFER, key })),
  );
  assert.equal(new Set(responses.map((response) => response.transferId)).size, 1, "all five responses describe the same logical transfer");
  assert.equal(responses.filter((response) => response.replayed === false).length, 1, "exactly one request executed the transfer");
  assert.equal(responses.filter((response) => response.replayed === true).length, 4, "the others were served as replays, never as errors");
  assert.equal(await balanceMinorOf(sender.ledgerAccountId), FUNDING_MINOR - parseMoneyToMinorUnits(TRANSFER));
  assert.equal(await transferCountOf(sender), 1);

  // The same key with a different approved intent is key reuse, not a replay.
  const other = await approve(sender, receiver.address, "1.0000");
  await expectRefusal(send({ sender, authorizationId: other.id, address: receiver.address, amount: "1.0000", key }), "idempotency_key_reused", "key reuse with a different intent");
  assert.equal(await balanceMinorOf(sender.ledgerAccountId), FUNDING_MINOR - parseMoneyToMinorUnits(TRANSFER), "the reuse attempt moved nothing");
});

test("an approval cannot be borrowed by another account, nor survive its expiry", async () => {
  const sender = await createAccount("borrow-sender", true);
  const stranger = await createAccount("borrow-stranger", true);
  const receiver = await createAccount("borrow-target");
  const approval = await approve(sender, receiver.address, TRANSFER);

  await expectRefusal(send({ sender: stranger, authorizationId: approval.id, address: receiver.address, amount: TRANSFER }), "not_found", "borrowed approval");
  assert.equal(await balanceMinorOf(stranger.ledgerAccountId), FUNDING_MINOR, "the stranger's balance is untouched");

  // Expiry is enforced by the consume itself (the conditional update names `expiresAt`), so moving
  // the clock past it is enough — no timer has to run for the approval to stop working.
  await collections.transferAuthorizations.updateOne({ publicId: approval.id }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
  await expectRefusal(send({ sender, authorizationId: approval.id, address: receiver.address, amount: TRANSFER }), "transfer_authorization_expired", "expired approval");
  assert.equal(await balanceMinorOf(sender.ledgerAccountId), FUNDING_MINOR, "an expired approval moves nothing");
  assert.equal(await transferCountOf(sender), 0);
});

test("a replayed authenticator code cannot authorise a second transfer", async () => {
  const sender = await createAccount("totp-replay", true);
  const receiver = await createAccount("totp-replay-target");
  const secret = await enableTwoFactor(sender);
  const first = await approve(sender, receiver.address, "1.0000");
  const second = await approve(sender, receiver.address, "2.0000");
  // The code is generated last, exactly as an owner does: the quote is on screen, then the
  // authenticator is read. A code is only accepted in its own 30-second step, so generating it before
  // the approvals — which are round trips — would be racing the step boundary rather than testing it.
  const code = await totpCode(secret);

  const executed = await send({ sender, authorizationId: first.id, address: receiver.address, amount: "1.0000", twoFactorCode: code });
  // The refusal is either the consumed step (the same 30-second window) or the code no longer being
  // accepted at all (the window rolled between the two requests). Both are safe; a success is not.
  let replayCode: unknown = null;
  try {
    await send({ sender, authorizationId: second.id, address: receiver.address, amount: "2.0000", twoFactorCode: code });
  } catch (error) {
    replayCode = codeOf(error);
  }
  assert.ok(
    replayCode === "two_factor_code_already_used" || replayCode === "invalid_two_factor_code",
    `the replayed code must not authorise a second transfer, got ${String(replayCode)}`,
  );
  assert.equal(await balanceMinorOf(sender.ledgerAccountId), FUNDING_MINOR - parseMoneyToMinorUnits("1.0000"), "only the first transfer was charged");
  assert.equal(await transferCountOf(sender), 1);

  // The consumed step is persisted, exactly once, and it names the intent it authorised.
  const uses = await collections.twoFactorUses.find({ ownerUserId: sender.userId, purpose: "transfer" }).toArray();
  assert.equal(uses.length, 1, "exactly one accepted step was consumed");
  assert.ok(Number.isInteger(uses[0]!.timeStep) && uses[0]!.timeStep > 0, "the consumed time step is recorded");
  const executedHeader = await collections.transactions.findOne({ type: "transfer", publicId: executed.id });
  assert.ok(executedHeader && isTransferTransaction(executedHeader));
  assert.equal(uses[0]!.intentHash, executedHeader.requestFingerprint, "the consumed step names the intent it authorised");
  await assertAccountsInvolvedMatchLedger([sender, receiver]);
});

test("simultaneous requests with the same authenticator code authorise exactly one transfer", async () => {
  const sender = await createAccount("totp-race", true);
  const receiver = await createAccount("totp-race-target");
  const secret = await enableTwoFactor(sender);
  const [first, second] = await Promise.all([approve(sender, receiver.address, "3.0000"), approve(sender, receiver.address, "4.0000")]);
  const code = await totpCode(secret);

  const settled = await Promise.allSettled([
    send({ sender, authorizationId: first.id, address: receiver.address, amount: "3.0000", twoFactorCode: code }),
    send({ sender, authorizationId: second.id, address: receiver.address, amount: "4.0000", twoFactorCode: code }),
  ]);
  assert.equal(fulfilledOf(settled).length, 1, `exactly one simultaneous request is authorised: ${JSON.stringify(settled.map((result) => (result.status === "rejected" ? codeOf(result.reason) : "ok")))}`);
  assert.equal(await collections.twoFactorUses.countDocuments({ ownerUserId: sender.userId }), 1, "one accepted step was consumed");
  assert.equal(await transferCountOf(sender), 1);
  const committed = await collections.transactions.findOne({ senderUserId: sender.userId });
  assert.ok(committed);
  assert.equal(await balanceMinorOf(sender.ledgerAccountId), FUNDING_MINOR - committed.amountMinor, "exactly one approved amount left the wallet");
  await assertFullReconciliation();
});

test("a failed transfer burns neither the approval nor the authenticator step", async () => {
  const sender = await createAccount("rollback-sender", true);
  const receiver = await createAccount("rollback-target");
  const secret = await enableTwoFactor(sender);
  const approval = await approve(sender, receiver.address, "12.0000", "rollback");
  // Generated just before the send, for the same reason as in the replay test above.
  const code = await totpCode(secret);

  // Fail after the approval and the authenticator step have been consumed inside the transaction:
  // both consumptions must roll back with the money that never moved.
  await send({ sender, authorizationId: approval.id, address: receiver.address, amount: "12.0000", note: "rollback", twoFactorCode: code, abortSignal: { throwAt: "after_credential_consume" } }).then(
    () => assert.fail("the injected failure must abort the transfer"),
    (error: unknown) => assert.match((error as Error).message, /Injected failure/, "the injected failure must surface"),
  );
  assert.equal(await balanceMinorOf(sender.ledgerAccountId), FUNDING_MINOR, "the aborted transfer moved nothing");
  assert.equal(await collections.twoFactorUses.countDocuments({ ownerUserId: sender.userId }), 0, "the aborted transfer burned no authenticator step");
  assert.equal((await collections.transferAuthorizations.findOne({ publicId: approval.id }))?.consumedAt, null, "the aborted transfer left the approval unconsumed");

  // The retry uses the same approval. The code is regenerated rather than reused: the code above was
  // issued for a 30-second step, and on a slow link the abort and the retry can straddle that
  // boundary, in which case the old code is *legitimately* rejected (the accepted window is the
  // current step only). The property under test — that the failure consumed nothing — is asserted
  // directly above, on the database itself.
  const executed = await send({ sender, authorizationId: approval.id, address: receiver.address, amount: "12.0000", note: "rollback", twoFactorCode: await totpCode(secret) });
  assert.equal(executed.amount, "12.0000");
  assert.equal(await balanceMinorOf(sender.ledgerAccountId), FUNDING_MINOR - parseMoneyToMinorUnits("12.0000"));
  assert.equal(await balanceMinorOf(receiver.ledgerAccountId), parseMoneyToMinorUnits("11.8800"));
  assert.equal(await collections.twoFactorUses.countDocuments({ ownerUserId: sender.userId }), 1, "the retry consumed the step exactly once");
  await assertAccountsInvolvedMatchLedger([sender, receiver]);
});

test("an approval survives a transfer that failed on the funds check, and is usable afterwards", async () => {
  const sender = await createAccount("funds-race", true);
  const receiver = await createAccount("funds-race-target");
  const approval = await approve(sender, receiver.address, "30.0000");

  await expectRefusal(send({ sender, authorizationId: approval.id, address: receiver.address, amount: "30.0000" }), "insufficient_funds", "unaffordable transfer");
  assert.equal((await collections.transferAuthorizations.findOne({ publicId: approval.id }))?.consumedAt, null, "a refused debit does not consume the approval");

  await fund(sender, parseMoneyToMinorUnits("10.0000"));
  const executed = await send({ sender, authorizationId: approval.id, address: receiver.address, amount: "30.0000" });
  assert.equal(executed.amount, "30.0000");
  assert.equal(await balanceMinorOf(sender.ledgerAccountId), parseMoneyToMinorUnits("5.0000"));
  assert.equal(await transferCountOf(sender), 1, "the failed attempt wrote no transaction");
});

test("an approved amount cannot overdraw a wallet that was spent in the meantime", async () => {
  const sender = await createAccount("stale-balance", true);
  const receiver = await createAccount("stale-balance-target");
  const stale = await approve(sender, receiver.address, "25.0000");

  // Another transfer drains the wallet between the approval and its use.
  const other = await approve(sender, receiver.address, "20.0000");
  await send({ sender, authorizationId: other.id, address: receiver.address, amount: "20.0000" });

  await expectRefusal(send({ sender, authorizationId: stale.id, address: receiver.address, amount: "25.0000" }), "insufficient_funds", "stale approval overdraw");
  const remaining = await balanceMinorOf(sender.ledgerAccountId);
  assert.equal(remaining, FUNDING_MINOR - parseMoneyToMinorUnits("20.0000"), "the projection follows the entries exactly");
  assert.ok(remaining >= 0, "the balance is never negative, not even transiently");
  await assertAccountsInvolvedMatchLedger([sender, receiver]);
});

test("the wallet, receiver, fee and treasury projections all equal their immutable entries", async () => {
  const sender = await createAccount("projection-sender", true);
  const receiver = await createAccount("projection-receiver");
  const feeAccountBefore = await collections.ledgerAccounts.findOne({ accountType: "fee_revenue", currency: "LMA" });
  const feeBalanceBefore = feeAccountBefore?.balanceMinor ?? 0;

  const sent = await send({ sender, authorizationId: (await approve(sender, receiver.address, TRANSFER)).id, address: receiver.address, amount: TRANSFER });
  const transactionId = sent.id;

  const [senderAccount, receiverAccount, feeAccount, treasury] = await Promise.all([
    collections.ledgerAccounts.findOne({ publicId: sender.ledgerAccountId }),
    collections.ledgerAccounts.findOne({ publicId: receiver.ledgerAccountId }),
    collections.ledgerAccounts.findOne({ accountType: "fee_revenue", currency: "LMA" }),
    collections.ledgerAccounts.findOne({ accountType: "system_treasury", currency: "LMA" }),
  ]);
  assert.ok(senderAccount && receiverAccount && feeAccount && treasury);

  // The raw signed sum, with the convention the code actually uses: a credit increases a wallet or a
  // fee balance, a debit increases the treasury's. Both are checked against the projection.
  const rawSignedSum = (entries: { side: string; amountMinor: number }[], creditIncreases: boolean) =>
    entries.reduce((total, entry) => total + ((entry.side === "credit") === creditIncreases ? entry.amountMinor : -entry.amountMinor), 0);
  const [senderEntries, receiverEntries, feeEntries, treasuryEntries] = await Promise.all([
    collections.ledgerEntries.find({ ledgerAccountId: sender.ledgerAccountId }).toArray(),
    collections.ledgerEntries.find({ ledgerAccountId: receiver.ledgerAccountId }).toArray(),
    collections.ledgerEntries.find({ ledgerAccountId: feeAccount.publicId, transactionId }).toArray(),
    collections.ledgerEntries.find({ ledgerAccountId: treasury.publicId }).toArray(),
  ]);
  assert.equal(rawSignedSum(senderEntries, true), senderAccount.balanceMinor, "the sender's projection is the signed sum of its entries");
  assert.equal(rawSignedSum(receiverEntries, true), receiverAccount.balanceMinor, "the receiver's projection is the signed sum of its entries");
  assert.equal(rawSignedSum(treasuryEntries, false), treasury.balanceMinor, "the treasury is debit-normal, like the reconciliation says");
  assert.equal(receiverAccount.balanceMinor, parseMoneyToMinorUnits("9.9000"), "the receiver holds the net amount");
  assert.equal(feeAccount.balanceMinor - feeBalanceBefore, parseMoneyToMinorUnits("0.1000"), "exactly this transfer's fee was posted, and it grew the fee balance");
  assert.equal(rawSignedSum(feeEntries, true), parseMoneyToMinorUnits("0.1000"), "fee revenue is credit-normal, like the reconciliation says");
  await assertAccountsInvolvedMatchLedger([sender, receiver]);

  // The transfer's own lines are balanced, complete, and numbered exactly once.
  const lines = await collections.ledgerEntries.find({ transactionId }).toArray();
  assert.equal(lines.length, 3);
  const debits = lines.filter((line) => line.side === "debit").reduce((total, line) => total + line.amountMinor, 0);
  const credits = lines.filter((line) => line.side === "credit").reduce((total, line) => total + line.amountMinor, 0);
  assert.equal(debits, credits, "the transaction's lines balance");
  assert.equal(debits, parseMoneyToMinorUnits(TRANSFER), "the sender is debited the full amount");
  assert.deepEqual(lines.map((line) => line.lineNumber).sort(), [1, 2, 3], "the lines are numbered exactly once");
});

test("an operator pause fails closed: no transfer executes while it is on", async () => {
  const sender = await createAccount("paused-sender", true);
  const receiver = await createAccount("paused-target");
  const approval = await approve(sender, receiver.address, "1.0000");

  try {
    await setFinancialControls({ collections, transfersPaused: true, payoutsPaused: false, reason: "adversarial test", updatedBy: "test" });
    await expectRefusal(send({ sender, authorizationId: approval.id, address: receiver.address, amount: "1.0000" }), "transfers_paused", "paused transfer");
    assert.equal(await balanceMinorOf(sender.ledgerAccountId), FUNDING_MINOR, "a paused transfer moves nothing");
    assert.equal(await transferCountOf(sender), 0, "a paused transfer writes no transaction");
    assert.equal((await collections.transferAuthorizations.findOne({ publicId: approval.id }))?.consumedAt, null, "the pause refuses before anything is consumed");
  } finally {
    await setFinancialControls({ collections, transfersPaused: false, payoutsPaused: false, reason: "adversarial test complete", updatedBy: "test" });
  }

  // Resuming restores the service exactly: the approval the sender held still works.
  const executed = await send({ sender, authorizationId: approval.id, address: receiver.address, amount: "1.0000" });
  assert.equal(executed.amount, "1.0000");
  assert.equal(await balanceMinorOf(sender.ledgerAccountId), FUNDING_MINOR - parseMoneyToMinorUnits("1.0000"));
});

test("a burst of approved transfers keeps the ledger exact and the wallet solvent", async () => {
  const sender = await createAccount("burst-sender", true);
  const receiver = await createAccount("burst-target");

  // Twelve approvals of 3.0000 each: 36.0000 requested against 25.0000 available, so the funds check
  // — not the approval — decides how many commit.
  const approvals = await Promise.all(Array.from({ length: 12 }, () => approve(sender, receiver.address, "3.0000")));
  const settled = await Promise.allSettled(
    approvals.map((approval) => send({ sender, authorizationId: approval.id, address: receiver.address, amount: "3.0000" })),
  );
  const committed = fulfilledOf(settled);
  const refused = rejectedOf(settled);
  assert.ok(committed.length >= 1 && committed.length <= 8, `between one and eight transfers fit in the balance: ${JSON.stringify(refused.map((result) => codeOf(result.reason)))}`);
  for (const failure of refused) assert.equal(codeOf(failure.reason), "insufficient_funds", `a refusal is a funds refusal: ${(failure.reason as Error).message}`);

  const amountMinor = parseMoneyToMinorUnits("3.0000");
  const netMinor = parseMoneyToMinorUnits("2.9700");
  assert.equal(await balanceMinorOf(sender.ledgerAccountId), FUNDING_MINOR - committed.length * amountMinor, "the sender's balance is exactly the committed debits");
  assert.equal(await balanceMinorOf(receiver.ledgerAccountId), committed.length * netMinor, "the receiver holds exactly the committed nets");
  assert.equal(await transferCountOf(sender), committed.length, "one transaction per committed transfer");

  // Exactly the committed transfers consumed an approval, each naming a distinct transaction: an
  // approval that was not used stays unconsumed (its transfer was refused on funds) rather than
  // being marked as spent.
  const consumed = [];
  for (const approval of approvals) {
    const record = await collections.transferAuthorizations.findOne({ publicId: approval.id });
    if (record?.consumedAt) consumed.push(record);
  }
  assert.equal(consumed.length, committed.length, "exactly the committed transfers consumed their approvals");
  assert.equal(new Set(consumed.map((record) => record.consumedByTransactionPublicId)).size, consumed.length, "each committed transfer consumed exactly one approval");
  const transactionIds = new Set(committed.map((result) => result.value.id));
  for (const record of consumed) assert.ok(transactionIds.has(record.consumedByTransactionPublicId as string), "every consumed approval names one of the committed transactions");
  await assertFullReconciliation();
});

test("the authorization invariants hold across everything this run wrote", async () => {
  const approvals = await collections.transferAuthorizations.find({ ownerUserId: { $in: createdUserIds } }).toArray();
  assert.ok(approvals.length > 0, "the run issued approvals");
  const consumedBy = new Map<string, number>();
  for (const approval of approvals) {
    if (!approval.consumedAt || !approval.consumedByTransactionPublicId) continue;
    consumedBy.set(approval.consumedByTransactionPublicId, (consumedBy.get(approval.consumedByTransactionPublicId) ?? 0) + 1);
  }
  for (const [transactionId, count] of consumedBy) assert.equal(count, 1, `transaction ${transactionId} consumed exactly one approval`);

  const stepKeys = new Map<string, number>();
  for (const use of await collections.twoFactorUses.find({ ownerUserId: { $in: createdUserIds } }).toArray()) {
    const key = `${use.ownerUserId}:${use.purpose}:${use.timeStep}`;
    stepKeys.set(key, (stepKeys.get(key) ?? 0) + 1);
  }
  for (const [key, count] of stepKeys) assert.equal(count, 1, `accepted step ${key} was consumed exactly once`);

  // Every approval a transaction consumed names a transaction that exists and is balanced, and every
  // transfer this run committed has the three lines a transfer must have.
  for (const approval of approvals.filter((item) => item.consumedAt !== null && item.consumedByTransactionPublicId !== null)) {
    const transaction = await collections.transactions.findOne({ publicId: approval.consumedByTransactionPublicId as string });
    assert.ok(transaction, `the transaction an approval names exists: ${approval.publicId}`);
    const lines = await collections.ledgerEntries.find({ transactionId: transaction.publicId }).toArray();
    const debits = lines.filter((line) => line.side === "debit").reduce((total, line) => total + line.amountMinor, 0);
    const credits = lines.filter((line) => line.side === "credit").reduce((total, line) => total + line.amountMinor, 0);
    assert.equal(debits, credits, `transaction ${transaction.publicId} is balanced`);
    assert.equal(lines.length, 3, `transaction ${transaction.publicId} carries a debit, a credit and a fee line`);
  }
  await assertFullReconciliation();
});
