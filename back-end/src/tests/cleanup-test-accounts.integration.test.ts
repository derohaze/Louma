import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { ObjectId, type Db, type MongoClient } from "mongodb";
import { loadConfig } from "../config/env.js";
import { connectMongo } from "../infrastructure/mongodb/client.js";
import { getCollections, type Collections } from "../infrastructure/mongodb/collections.js";
import { schemas } from "../infrastructure/mongodb/schemas.js";
import { ensureCollection } from "../infrastructure/mongodb/validators.js";
import { generateWalletAddress } from "../modules/wallets/address.js";

/**
 * The test-account cleanup's retained-account behavior, run through the real CLI.
 *
 * The script deletes the ledger footprint of `@example.test` accounts, but an account entangled
 * with a real counterparty can never be unwound line by line: its shared lines must stay (the real
 * side is untouched), which pins the whole transaction and every account on it. These tests seed
 * exactly that shape — a funded test account that paid a real account, a real account that paid a
 * test account, a test-only transfer between the retained pair, one untouched test account, and a
 * shared header with no `participants` field — then assert the cleanup keeps the entangled component
 * whole (entries, wallet, user, projections) and removes only the free account. Running the CLI as a
 * subprocess tests the code path the operator actually executes.
 *
 * Everything is seeded into and dropped from a scratch database so the sweep can never touch
 * another suite's rows, which is also what lets this file run beside the other integration suites.
 */
const execFileAsync = promisify(execFile);
const RUN = randomUUID().slice(0, 8);
const SCRATCH_DATABASE = `louma_cleanup_${RUN}`;
const BACKEND_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const SCRIPT_PATH = fileURLToPath(new URL("../scripts/cleanup-test-accounts.ts", import.meta.url));

let client: MongoClient;
let db: Db;
let collections: Collections;

interface SeededAccount {
  userId: string;
  walletId: string;
  accountId: string;
  address: string;
}

let realUser: SeededAccount;
let testPayer: SeededAccount;
let testReceiver: SeededAccount;
let testFree: SeededAccount;
let payerFundingEntry: string;
let freeFundingEntry: string;
let paidRealHeader: string;
let testOnlyHeader: string;
let receivedFromRealHeader: string;
let treasuryAccountId: string;

async function seedAccount(email: string, displayName: string): Promise<SeededAccount> {
  const now = new Date();
  const account: SeededAccount = {
    userId: randomUUID(),
    walletId: randomUUID(),
    accountId: randomUUID(),
    address: generateWalletAddress(),
  };
  await collections.users.insertOne({
    _id: new ObjectId(),
    publicId: account.userId,
    email,
    passwordHash: "$argon2id$v=19$m=19456,t=2,p=1$Y2xlYW51cHRlc3Q$Y2xlYW51cHRlc3Q",
    profile: { displayName, country: null },
    status: "active",
    emailVerifiedAt: now,
    createdAt: now,
    updatedAt: now,
  } as never);
  await collections.wallets.insertOne({
    _id: new ObjectId(),
    publicId: account.walletId,
    address: account.address,
    addressNormalized: account.address,
    addressVersion: 1,
    ownerUserId: account.userId,
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
    publicId: account.accountId,
    walletId: account.walletId,
    accountType: "wallet",
    currency: "LMA",
    balanceMinor: 0,
    createdAt: now,
  } as never);
  return account;
}

/** A journal-less credit, exactly the shape the suites' funding mints. Returns the entry's public id. */
async function credit(account: SeededAccount, amountMinor: number, correlationId: string): Promise<string> {
  const entryPublicId = randomUUID();
  await collections.ledgerEntries.insertOne({
    _id: new ObjectId(),
    publicId: entryPublicId,
    transactionId: randomUUID(),
    lineNumber: 1,
    walletId: account.walletId,
    ledgerAccountId: account.accountId,
    side: "credit",
    amountMinor,
    currency: "LMA",
    correlationId,
    createdAt: new Date(),
  } as never);
  await collections.ledgerAccounts.updateOne({ publicId: account.accountId }, { $inc: { balanceMinor: amountMinor } });
  return entryPublicId;
}

/** The shared treasury account the funding pairs debit, so a retained pair can keep its offset. */
async function seedTreasury(): Promise<void> {
  treasuryAccountId = randomUUID();
  await collections.ledgerAccounts.insertOne({
    _id: new ObjectId(),
    publicId: treasuryAccountId,
    walletId: null,
    accountType: "system_treasury",
    currency: "LMA",
    balanceMinor: 0,
    createdAt: new Date(),
  } as never);
}

/**
 * A realistic funding mint: a treasury debit and the account credit on one journal-less transaction,
 * so both lines share a `transactionId`. The single-sided `credit()` above cannot cover the rule that
 * a retained credit keeps its paired debit — there is no debit to lose — so the tests below use this
 * shape to make that invariant observable.
 */
async function fundPair(account: SeededAccount, amountMinor: number, correlationId: string): Promise<{ debitEntry: string; creditEntry: string }> {
  const now = new Date();
  const transactionId = randomUUID();
  const debitEntry = randomUUID();
  const creditEntry = randomUUID();
  await collections.ledgerEntries.insertMany([
    { publicId: debitEntry, transactionId, lineNumber: 1, walletId: null, ledgerAccountId: treasuryAccountId, side: "debit", amountMinor, currency: "LMA", correlationId, createdAt: now },
    { publicId: creditEntry, transactionId, lineNumber: 2, walletId: account.walletId, ledgerAccountId: account.accountId, side: "credit", amountMinor, currency: "LMA", correlationId, createdAt: now },
  ] as never);
  await collections.ledgerAccounts.updateOne({ publicId: treasuryAccountId }, { $inc: { balanceMinor: amountMinor } });
  await collections.ledgerAccounts.updateOne({ publicId: account.accountId }, { $inc: { balanceMinor: amountMinor } });
  return { debitEntry, creditEntry };
}

/**
 * One transfer: a journal header plus its balanced pair, `withParticipants: false` reproducing the
 * legacy header an older process wrote after the participants backfill.
 */
async function seedTransfer(from: SeededAccount, to: SeededAccount, amountMinor: number, withParticipants: boolean): Promise<string> {
  const now = new Date();
  const publicId = randomUUID();
  const correlationId = `cleanup-seed-${publicId}`;
  await collections.transactions.insertOne({
    _id: new ObjectId(),
    publicId,
    transferId: randomUUID(),
    type: "transfer",
    currency: "LMA",
    status: "completed",
    correlationId,
    ...(withParticipants ? { participants: [from.userId, to.userId] } : {}),
    senderUserId: from.userId,
    receiverUserId: to.userId,
    senderWalletId: from.walletId,
    receiverWalletId: to.walletId,
    senderAddress: from.address,
    receiverAddress: to.address,
    amountMinor,
    feeMinor: 0,
    netAmountMinor: amountMinor,
    note: "",
    idempotencyKey: randomUUID(),
    requestFingerprint: randomUUID(),
    balanceAfterMinor: 0,
    createdAt: now,
    completedAt: now,
  } as never);
  await collections.ledgerEntries.insertMany([
    { publicId: randomUUID(), transactionId: publicId, lineNumber: 1, walletId: from.walletId, ledgerAccountId: from.accountId, side: "debit", amountMinor, currency: "LMA", correlationId, createdAt: now },
    { publicId: randomUUID(), transactionId: publicId, lineNumber: 2, walletId: to.walletId, ledgerAccountId: to.accountId, side: "credit", amountMinor, currency: "LMA", correlationId, createdAt: now },
  ] as never);
  await collections.ledgerAccounts.updateOne({ publicId: from.accountId }, { $inc: { balanceMinor: -amountMinor } });
  await collections.ledgerAccounts.updateOne({ publicId: to.accountId }, { $inc: { balanceMinor: amountMinor } });
  return publicId;
}

/** The account's balance recomputed independently from its immutable entries (wallet = credit-normal). */
async function derivedBalance(ledgerAccountId: string): Promise<number> {
  const entries = await collections.ledgerEntries.find({ ledgerAccountId }).toArray();
  return entries.reduce((total, entry) => total + (entry.side === "credit" ? entry.amountMinor : -entry.amountMinor), 0);
}

async function runCleanup(apply: boolean): Promise<{ stdout: string; stderr: string }> {
  const { stdout, stderr } = await execFileAsync(
    process.execPath,
    ["--import", "tsx", SCRIPT_PATH, ...(apply ? ["--apply"] : [])],
    { cwd: BACKEND_ROOT, env: { ...process.env, MONGODB_DATABASE: SCRATCH_DATABASE }, timeout: 120_000 },
  );
  return { stdout: String(stdout), stderr: String(stderr) };
}

before(async () => {
  const config = loadConfig();
  const connection = await connectMongo(
    { ...config, mongoDatabase: SCRATCH_DATABASE },
    { serverSelectionTimeoutMS: 30_000, connectTimeoutMS: 20_000 },
  );
  client = connection.client;
  db = connection.db;
  for (const name of ["users", "wallets", "ledger_accounts", "ledger_entries", "transactions"]) {
    await ensureCollection(db, name, schemas[name]!);
  }
  collections = getCollections(db);

  realUser = await seedAccount(`cleanup.real.${RUN}@example.com`, "Cleanup real");
  testPayer = await seedAccount(`cleanup.payer.${RUN}@example.test`, "Cleanup payer");
  testReceiver = await seedAccount(`cleanup.receiver.${RUN}@example.test`, "Cleanup receiver");
  testFree = await seedAccount(`cleanup.free.${RUN}@example.test`, "Cleanup free");

  await credit(realUser, 100, `cleanup-real-seed-${RUN}`);
  payerFundingEntry = await credit(testPayer, 100, `smoke-funding-cleanup-${RUN}-payer`);
  freeFundingEntry = await credit(testFree, 500, `smoke-funding-cleanup-${RUN}-free`);

  // Entangled component: payer paid the real account (shared), the real account paid the receiver
  // (shared), and the payer paid the receiver (test-only, pinned through the payer).
  paidRealHeader = await seedTransfer(testPayer, realUser, 90, false);
  testOnlyHeader = await seedTransfer(testPayer, testReceiver, 10, true);
  receivedFromRealHeader = await seedTransfer(realUser, testReceiver, 5, true);
});

after(async () => {
  if (!client) return;
  await db.dropDatabase().catch(() => undefined);
  await client.close();
});

test("the report classifies the entangled accounts and writes nothing", async () => {
  const { stdout } = await runCleanup(false);
  const report = JSON.parse(stdout) as Record<string, unknown>;
  assert.equal(report["apply"], false);
  assert.equal(report["testUsers"], 3);
  assert.equal(report["wallets"], 3);
  assert.equal(report["ledgerAccounts"], 3);
  assert.equal(report["transactions"], 3);
  assert.equal(report["ledgerEntries"], 1, "only the unentangled funding line is deletable");
  assert.equal(report["sharedTransactionsRetained"], 2);
  assert.equal(report["sharedEntriesRetained"], 5);
  assert.equal(report["testAccountsRetained"], 2);
  assert.equal(report["testOnlyTransactionsRetained"], 1);
  assert.equal(report["walletsRetained"], 2);
  assert.equal(report["usersRetained"], 2);
  assert.deepEqual(report["sharedProjectionAdjustments"], []);
  // Report mode writes nothing: the deletable account and its line are still present.
  assert.ok(await collections.users.findOne({ publicId: testFree.userId }));
  assert.ok(await collections.ledgerEntries.findOne({ publicId: freeFundingEntry }));
});

test("apply keeps the entangled accounts whole and removes only the free one", async () => {
  const { stdout } = await runCleanup(true);
  assert.match(stdout, /"applied": true/);

  // Retained accounts keep their ledger lives: entries, wallet, owner, and a projection that still
  // equals the immutable entries (never a negative balance a rejected adjustment would have left).
  for (const account of [testPayer, testReceiver]) {
    const ledger = await collections.ledgerAccounts.findOne({ publicId: account.accountId });
    assert.ok(ledger, "the retained ledger account stays");
    assert.ok(ledger.balanceMinor >= 0, "the retained projection is never negative");
    assert.equal(ledger.balanceMinor, await derivedBalance(account.accountId), "the retained projection equals its entries");
    assert.ok(await collections.wallets.findOne({ publicId: account.walletId }), "the wallet stays beside its ledger account");
    assert.ok(await collections.users.findOne({ publicId: account.userId }), "the owner stays so a later run can rediscover it");
  }

  // Every kept transaction survives whole: shared headers and their lines, and the test-only header
  // pinned through the retained payer.
  for (const publicId of [paidRealHeader, testOnlyHeader, receivedFromRealHeader]) {
    assert.ok(await collections.transactions.findOne({ publicId }), `header ${publicId} survives`);
    assert.equal(await collections.ledgerEntries.countDocuments({ transactionId: publicId }), 2, `header ${publicId} keeps both lines`);
  }
  assert.ok(await collections.ledgerEntries.findOne({ publicId: payerFundingEntry }), "the funding line behind a kept shared move stays");

  // The free account is gone, footprint and all.
  assert.equal(await collections.ledgerEntries.countDocuments({ publicId: freeFundingEntry }), 0);
  assert.equal(await collections.ledgerEntries.countDocuments({ ledgerAccountId: testFree.accountId }), 0);
  assert.equal(await collections.ledgerAccounts.findOne({ publicId: testFree.accountId }), null);
  assert.equal(await collections.wallets.findOne({ publicId: testFree.walletId }), null);
  assert.equal(await collections.users.findOne({ publicId: testFree.userId }), null);

  // The real counterparty is untouched, lines and projection included: seed 100 + received 90 − paid 5.
  const real = await collections.ledgerAccounts.findOne({ publicId: realUser.accountId });
  assert.equal(real?.balanceMinor, 185);
  assert.equal(await derivedBalance(realUser.accountId), 185);
  assert.ok(await collections.users.findOne({ publicId: realUser.userId }));
});

test("a retained funding credit keeps its paired treasury debit, and a removed one loses both", async () => {
  await seedTreasury();
  const retained = await seedAccount(`cleanup.paired.retained.${RUN}@example.test`, "Cleanup paired retained");
  const removable = await seedAccount(`cleanup.paired.free.${RUN}@example.test`, "Cleanup paired free");
  const keptFunds = await fundPair(retained, 50, `smoke-funding-cleanup-${RUN}-paired-retained`);
  const lostFunds = await fundPair(removable, 70, `smoke-funding-cleanup-${RUN}-paired-free`);
  // Fund before spending: the real validator correctly rejects a negative wallet projection.
  await seedTransfer(retained, realUser, 3, true);

  const { stdout } = await runCleanup(true);
  assert.match(stdout, /"applied": true/);

  // The kept credit pins its whole funding transaction, so the treasury debit offsetting it survives.
  assert.ok(await collections.ledgerEntries.findOne({ publicId: keptFunds.creditEntry }), "the retained funding credit survives");
  assert.ok(await collections.ledgerEntries.findOne({ publicId: keptFunds.debitEntry }), "its paired treasury debit survives with it");

  // The removed credit's pair goes with it, and the treasury projection follows its own entries.
  assert.equal(await collections.ledgerEntries.countDocuments({ publicId: lostFunds.creditEntry }), 0);
  assert.equal(await collections.ledgerEntries.countDocuments({ publicId: lostFunds.debitEntry }), 0);
  const treasury = await collections.ledgerAccounts.findOne({ publicId: treasuryAccountId });
  assert.equal(treasury?.balanceMinor, 50, "the treasury keeps exactly the retained funding debit");
});
