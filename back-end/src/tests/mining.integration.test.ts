import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { MongoServerError, type MongoClient } from "mongodb";
import { buildApp } from "../app.js";
import { loadConfig, type AppConfig } from "../config/env.js";
import { connectMongo } from "../infrastructure/mongodb/client.js";
import { ensureDatabaseIndexes } from "../infrastructure/mongodb/indexes.js";
import { getCollections, type Collections } from "../infrastructure/mongodb/collections.js";
import { MONEY_SCALE } from "../shared/types.js";
import { reconcileLedger } from "../modules/ledger/reconciliation.js";

/**
 * Mining against the configured MongoDB cluster.
 *
 * The guarantees under test are the ones the product depends on: a cycle is exactly 24 hours, the
 * rate is the server's and never the browser's, the reward is a pure function of persisted state,
 * and settlement credits the ledger exactly once no matter how many times or how concurrently it is
 * asked. Where a test needs time to have passed it moves the stored window (both endpoints together,
 * so the 24-hour invariant holds) rather than waiting.
 *
 * Run with `npm run test:integration:mining`. Every document the run creates is removed afterwards,
 * and the shared treasury is returned to the balance it had before the run.
 */

const PASSWORD = "SmokeTest1234";
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const DAY_SECONDS = 24 * 60 * 60;

let app: FastifyInstance;
let client: MongoClient;
let config: AppConfig;
let collections: Collections;

const createdUserIds: string[] = [];
const createdSessionIds: string[] = [];
const createdTransactionIds: string[] = [];
const createdWalletAccountIds: string[] = [];
let treasuryDeltaMinor = 0;

let requestIp = 0;
const nextIp = () => `10.9.0.${(requestIp++ % 250) + 1}`;
let preauthCsrfTokenValue = "";
const csrfByAccessToken = new Map<string, string>();

interface Account {
  userId: string;
  email: string;
  accessToken: string;
  refreshCookie: string;
  walletId: string;
  ledgerAccountId: string;
}

async function call(
  method: "GET" | "POST",
  url: string,
  options: { token?: string; cookie?: string; body?: unknown } = {},
): Promise<{ status: number; body: Record<string, unknown>; cookie: string }> {
  const headers: Record<string, string> = {};
  if (options.token) headers["authorization"] = `Bearer ${options.token}`;
  if (options.cookie) headers["cookie"] = options.cookie;
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
  const body = response.payload.length ? (response.json() as Record<string, unknown>) : {};
  if (typeof body["accessToken"] === "string" && typeof body["csrfToken"] === "string") {
    csrfByAccessToken.set(body["accessToken"], body["csrfToken"]);
  }
  return { status: response.statusCode, body, cookie: Array.isArray(setCookie) ? (setCookie[0] ?? "") : ((setCookie as string | undefined) ?? "") };
}

async function register(label: string): Promise<Account> {
  const email = `mining.${label}.${randomUUID()}@example.test`;
  const response = await call("POST", "/api/v1/auth/register", {
    body: { email, password: PASSWORD, displayName: `Mining ${label}`.slice(0, 32) },
  });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  const user = response.body["user"] as { id: string };
  const wallet = response.body["wallet"] as { id: string };
  createdUserIds.push(user.id);
  const account = await collections.ledgerAccounts.findOne({ walletId: wallet.id, accountType: "wallet" });
  assert.ok(account, "the wallet has a ledger account");
  createdWalletAccountIds.push(account.publicId);
  return {
    userId: user.id,
    email,
    accessToken: response.body["accessToken"] as string,
    refreshCookie: response.cookie.split(";")[0] ?? "",
    walletId: wallet.id,
    ledgerAccountId: account.publicId,
  };
}

interface MiningSession {
  id: string;
  status: string;
  cycleNumber: number;
  startedAt: string;
  endsAt: string;
  durationSeconds: number;
  rate: string;
  rateUnits: number;
  rateScale: number;
  accrued: string;
  accruedMinor: number;
  settled: string;
  settledMinor: number;
  totalAccrued: string;
  totalAccruedMinor: number;
  elapsedSeconds: number;
  remainingSeconds: number;
  canSettle: boolean;
}

async function miningState(account: Account) {
  const response = await call("GET", "/api/v1/mining/state", { token: account.accessToken });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  return response.body as { status: string; enabled: boolean; canStart: boolean; serverNow: string; session: MiningSession | null };
}

async function startMining(account: Account) {
  const response = await call("POST", "/api/v1/mining/start", { token: account.accessToken });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  const state = response.body as { status: string; session: MiningSession };
  createdSessionIds.push(state.session.id);
  return state;
}

async function settleMining(account: Account, body?: unknown) {
  const response = await call("POST", "/api/v1/mining/settle", { token: account.accessToken, ...(body === undefined ? {} : { body }) });
  if (response.status === 200 && response.body["session"]) {
    const session = response.body["session"] as MiningSession;
    if (!createdSessionIds.includes(session.id)) createdSessionIds.push(session.id);
  }
  return response;
}

async function balanceMinorOf(account: Account): Promise<number> {
  const response = await call("GET", "/api/v1/wallet", { token: account.accessToken });
  const balance = (response.body["wallet"] as { balance: string }).balance;
  const [whole = "0", fraction = ""] = balance.split(".");
  return Number(whole) * MONEY_SCALE + Number(fraction.padEnd(4, "0"));
}

async function ledgerDerivedMinor(ledgerAccountId: string): Promise<number> {
  const entries = await collections.ledgerEntries.find({ ledgerAccountId }).toArray();
  return entries.reduce((total, entry) => total + (entry.side === "credit" ? entry.amountMinor : -entry.amountMinor), 0);
}

/** Moves a stored cycle back by `elapsedMs`, keeping `endsAt - startedAt` exactly 24 hours. */
async function rewindCycle(sessionId: string, elapsedMs: number): Promise<void> {
  const session = await collections.miningSessions.findOne({ publicId: sessionId });
  assert.ok(session, "the cycle exists");
  await collections.miningSessions.updateOne(
    { publicId: sessionId },
    { $set: { startedAt: new Date(session.startedAt.getTime() - elapsedMs), endsAt: new Date(session.endsAt.getTime() - elapsedMs) } },
  );
}

/** The accrual the API must report, computed independently from the persisted integers. */
function expectedAccruedMinor(session: MiningSession, elapsedSeconds: number): number {
  const bounded = Math.max(0, Math.min(elapsedSeconds, session.durationSeconds));
  return Number((BigInt(session.rateUnits) * BigInt(MONEY_SCALE) * BigInt(bounded)) / (BigInt(session.rateScale) * 3600n));
}

/**
 * True when a settled total is exactly the accrual at some second within a few of the reported
 * elapsed one. A settlement commits on the server clock and its response is read a moment later, so
 * the read's elapsed second can be one or two ahead of the instant that was actually credited; the
 * point of the check is that the credited amount is an exact accrual, not an approximation of one.
 */
function settledMatchesRecentAccrual(session: MiningSession, settledMinor: number): boolean {
  for (let seconds = Math.max(0, session.elapsedSeconds - 5); seconds <= session.elapsedSeconds; seconds += 1) {
    if (expectedAccruedMinor(session, seconds) === settledMinor) return true;
  }
  return false;
}

async function trackSettlements(sessionId: string): Promise<void> {
  const settlements = await collections.miningSettlements.find({ sessionPublicId: sessionId }).toArray();
  for (const settlement of settlements) {
    if (!createdTransactionIds.includes(settlement.publicId)) {
      createdTransactionIds.push(settlement.publicId);
      treasuryDeltaMinor += settlement.amountMinor;
    }
  }
}

before(async () => {
  config = loadConfig();
  const connection = await connectMongo(config, { serverSelectionTimeoutMS: 30_000, connectTimeoutMS: 20_000 });
  client = connection.client;
  collections = getCollections(connection.db);
  await ensureDatabaseIndexes(connection.db);
  app = await buildApp({ config, collections, mongoClient: client, logger: false });
  const csrf = await call("GET", "/api/v1/auth/csrf");
  assert.equal(csrf.status, 200, JSON.stringify(csrf.body));
  preauthCsrfTokenValue = csrf.body["csrfToken"] as string;
});

after(async () => {
  if (!collections) return;
  for (const sessionId of createdSessionIds) await trackSettlements(sessionId);
  for (const userId of createdUserIds) {
    await collections.miningSessions.deleteMany({ ownerUserId: userId });
    await collections.miningSettlements.deleteMany({ ownerUserId: userId });
    await collections.securityEvents.deleteMany({ ownerUserId: userId });
    await collections.sessions.deleteMany({ ownerUserId: userId });
    await collections.wallets.deleteMany({ ownerUserId: userId });
    await collections.users.deleteMany({ publicId: userId });
  }
  await collections.ledgerEntries.deleteMany({ transactionId: { $in: createdTransactionIds } });
  await collections.transactions.deleteMany({ publicId: { $in: createdTransactionIds } });
  await collections.ledgerEntries.deleteMany({ ledgerAccountId: { $in: createdWalletAccountIds } });
  await collections.ledgerAccounts.deleteMany({ publicId: { $in: createdWalletAccountIds } });
  if (treasuryDeltaMinor !== 0) {
    await collections.ledgerAccounts.updateOne({ accountType: "system_treasury", currency: "LMA" }, { $inc: { balanceMinor: -treasuryDeltaMinor } });
  }
  await app?.close();
  await client?.close();
});

test("mining requires a session", async () => {
  assert.equal((await call("GET", "/api/v1/mining/state")).status, 401);
  assert.equal((await call("POST", "/api/v1/mining/start")).status, 401);
});

test("start opens exactly a 24-hour cycle with a server-chosen rate inside the configured band", async () => {
  const account = await register("start");
  assert.equal((await miningState(account)).status, "idle", "a fresh account has no cycle");

  const started = await startMining(account);
  const session = started.session;
  assert.equal(session.status, "active");
  assert.equal(new Date(session.endsAt).getTime() - new Date(session.startedAt).getTime(), DAY_MS, "the window is exactly 24 hours");
  assert.equal(session.durationSeconds, DAY_SECONDS);
  assert.ok(session.remainingSeconds > DAY_SECONDS - 5 && session.remainingSeconds <= DAY_SECONDS, "the cycle opens at the start of its 24-hour window");
  assert.match(session.rate, /^\d+\.\d{6}$/);
  const rateUnits = Number(session.rate.replace(".", ""));
  assert.ok(rateUnits >= config.mining.rate.minUnits && rateUnits <= config.mining.rate.maxUnits, "the drawn rate is inside the configured band");
  assert.equal(session.accrued, "0.0000", "nothing has accrued yet");
  assert.ok(session.totalAccruedMinor > 0, "the cycle still has a positive 24-hour ceiling");
  assert.ok(session.accruedMinor < session.totalAccruedMinor);
  assert.equal(started.session.canSettle, false);

  // A second start while the cycle runs is refused rather than silently replacing the window.
  const second = await call("POST", "/api/v1/mining/start", { token: account.accessToken });
  assert.equal(second.status, 409);
  assert.equal((second.body["error"] as { code: string }).code, "mining_cycle_active");
});

test("the rate and window are immutable for the life of the cycle, and identical on every device", async () => {
  const account = await register("immutable");
  const started = await startMining(account).then((state) => state.session);

  const again = (await miningState(account)).session;
  assert.ok(again);
  assert.equal(again.id, started.id);
  assert.equal(again.rate, started.rate, "a read never re-draws the rate");
  assert.equal(again.startedAt, started.startedAt);
  assert.equal(again.endsAt, started.endsAt);

  // A second sign-in (another device) reads the same canonical cycle from the server.
  const phone = await call("POST", "/api/v1/auth/login", { body: { email: account.email, password: PASSWORD } });
  assert.equal(phone.status, 200, JSON.stringify(phone.body));
  const onPhone = (await miningState({ ...account, accessToken: phone.body["accessToken"] as string })).session;
  assert.ok(onPhone);
  assert.equal(onPhone.id, started.id);
  assert.equal(onPhone.rate, started.rate);
  assert.equal(onPhone.startedAt, started.startedAt);
  assert.equal(onPhone.endsAt, started.endsAt);
});

test("rates differ between accounts rather than being a global constant", async () => {
  const rates = new Set<string>();
  for (let index = 0; index < 12; index += 1) {
    const account = await register(`rate-${index}`);
    rates.add((await startMining(account)).session.rate);
  }
  assert.ok(rates.size >= 3, `twelve accounts drew distinct per-cycle rates: ${[...rates].join(", ")}`);
});

test("the server reports the accrual from persisted state, and settlement posts it through the ledger", async () => {
  const account = await register("accrue");
  const started = await startMining(account);
  const before = await collections.ledgerEntries.countDocuments({ ledgerAccountId: account.ledgerAccountId });

  await rewindCycle(started.session.id, HOUR_MS);
  const hour = (await miningState(account)).session;
  assert.ok(hour);
  assert.equal(hour.status, "active");
  assert.ok(hour.elapsedSeconds >= 3600, "about an hour has elapsed");
  assert.equal(hour.accruedMinor, expectedAccruedMinor(hour, hour.elapsedSeconds), "the reported accrual matches the exact server arithmetic");
  assert.equal(hour.remainingSeconds, DAY_SECONDS - hour.elapsedSeconds);
  assert.ok(hour.accruedMinor > 0, "an hour of mining has produced a reward");

  const settled = await settleMining(account);
  assert.equal(settled.status, 200, JSON.stringify(settled.body));
  const afterSettle = settled.body["session"] as MiningSession;
  assert.ok(settledMatchesRecentAccrual(afterSettle, afterSettle.settledMinor), "the whole accrual reached the ledger as an exact amount");
  assert.equal(await balanceMinorOf(account), afterSettle.settledMinor, "the wallet balance is the settled reward");

  // The ledger still explains the balance, and the settlement wrote exactly two lines.
  assert.equal(await ledgerDerivedMinor(account.ledgerAccountId), afterSettle.settledMinor);
  // The wallet is credited exactly once; the balancing debit lands on the treasury, not on the
  // wallet, so this account's line count grows by one.
  const written = await collections.ledgerEntries.countDocuments({ ledgerAccountId: account.ledgerAccountId });
  assert.equal(written - before, 1, "one credit line for the wallet");
  const settlement = await collections.miningSettlements.findOne({ sessionPublicId: started.session.id });
  assert.ok(settlement);
  const lines = await collections.ledgerEntries.find({ transactionId: settlement.publicId }).toArray();
  assert.equal(lines.length, 2, "the settlement is one balanced two-line transaction");

  // A mining settlement is not a transfer: it must not appear in the customer's transfer history.
  const history = await call("GET", "/api/v1/transactions?limit=50", { token: account.accessToken });
  assert.equal(history.status, 200);
  assert.equal((history.body["transactions"] as unknown[]).length, 0, "mining never surfaces as a transfer");
});

test("exactly 24 hours: one millisecond short pays less, and nothing after the window pays more", async () => {
  const account = await register("window");
  const started = await startMining(account);
  const cap = started.session.totalAccruedMinor;
  assert.ok(cap > 0, "the configured band pays a non-zero 24-hour reward");

  await rewindCycle(started.session.id, DAY_MS + 30 * DAY_MS);
  const expired = (await miningState(account)).session;
  assert.ok(expired);
  assert.equal(expired.status, "completed");
  assert.equal(expired.accruedMinor, cap, "a month past the window is clamped to the 24-hour reward");
  assert.equal(expired.remainingSeconds, 0);

  await settleMining(account);
  assert.equal(await balanceMinorOf(account), cap);

  // Repeated, replayed settlement after the window cannot credit a second time.
  const before = await collections.ledgerEntries.countDocuments({ ledgerAccountId: account.ledgerAccountId });
  for (let attempt = 0; attempt < 3; attempt += 1) await settleMining(account);
  assert.equal(await balanceMinorOf(account), cap, "no reward beyond the 24-hour total");
  assert.equal(await collections.ledgerEntries.countDocuments({ ledgerAccountId: account.ledgerAccountId }), before, "no further lines were written");

  // A closed cycle can be followed by a fresh one, and the old record is not reused.
  const next = await startMining(account);
  assert.notEqual(next.session.id, started.session.id);
  assert.equal(next.session.cycleNumber, 2);
  assert.notEqual(next.session.startedAt, started.session.startedAt);
});

test("a partial settlement advances the cycle and a later one posts only the difference", async () => {
  const account = await register("partial");
  const started = await startMining(account);

  await rewindCycle(started.session.id, HOUR_MS);
  const first = (await settleMining(account)).body["session"] as MiningSession;
  assert.ok(first.settledMinor > 0);
  assert.equal(await balanceMinorOf(account), first.settledMinor);

  await rewindCycle(started.session.id, HOUR_MS);
  const second = (await settleMining(account)).body["session"] as MiningSession;
  assert.ok(second.settledMinor > first.settledMinor, "the second settle posted only the newly accrued difference");
  assert.ok(settledMatchesRecentAccrual(second, second.settledMinor), "the cumulative settled total is still an exact accrual");
  // The two settlements' sequences advance, so nothing was rewritten in place.
  const settlements = await collections.miningSettlements.find({ sessionPublicId: started.session.id }).sort({ sequenceNumber: 1 }).toArray();
  assert.deepEqual(settlements.map((row) => row.sequenceNumber), [1, 2]);
  assert.equal(await balanceMinorOf(account), second.settledMinor);
  assert.equal(await ledgerDerivedMinor(account.ledgerAccountId), second.settledMinor);
});

test("duplicate and concurrent settlement credit exactly once", async () => {
  const account = await register("concurrent");
  const started = await startMining(account);
  await rewindCycle(started.session.id, 2 * HOUR_MS);

  const responses = await Promise.all(Array.from({ length: 6 }, () => settleMining(account)));
  assert.ok(responses.every((response) => response.status === 200), `every settle is answered: ${JSON.stringify(responses.map((response) => response.status))}`);
  const session = responses[0]!.body["session"] as MiningSession;

  // There may be more than one settlement: a slow link can have a later request observe an extra
  // second's accrual and post that small difference. That is not a double credit — the guarantee is
  // that the total never exceeds what the window earned and that no accrual is posted twice, which
  // is what is asserted here. "Exactly one row" would be asserting the link's latency.
  const settlements = await collections.miningSettlements.find({ sessionPublicId: started.session.id }).sort({ sequenceNumber: 1 }).toArray();
  assert.ok(settlements.length >= 1, "the reward reached the ledger");
  assert.deepEqual(
    settlements.map((row) => row.sequenceNumber),
    Array.from({ length: settlements.length }, (_, index) => index + 1),
    "settlements take contiguous, unique sequence numbers — none was applied twice",
  );
  const credited = settlements.reduce((sum, row) => sum + row.amountMinor, 0);
  assert.equal(await balanceMinorOf(account), credited, "the wallet holds exactly the credited settlements");
  assert.equal(await ledgerDerivedMinor(account.ledgerAccountId), credited);
  assert.ok(credited <= expectedAccruedMinor(session, session.elapsedSeconds), "the credit never exceeds the true accrual");
  assert.ok(credited >= expectedAccruedMinor(session, Math.max(0, session.elapsedSeconds - 5)), "and it is not short of the accrual a few seconds ago");

  for (const row of settlements) {
    const lines = await collections.ledgerEntries.find({ transactionId: row.publicId }).toArray();
    assert.equal(lines.length, 2, "every settlement is a two-line transaction");
    const debits = lines.filter((line) => line.side === "debit").reduce((sum, line) => sum + line.amountMinor, 0);
    const credits = lines.filter((line) => line.side === "credit").reduce((sum, line) => sum + line.amountMinor, 0);
    assert.equal(debits, credits, "every settlement is balanced");
    assert.equal(debits, row.amountMinor);
  }
});

test("a client cannot forge a rate, a window, or an amount", async () => {
  const account = await register("tamper");
  const started = await startMining(account);
  await rewindCycle(started.session.id, HOUR_MS);
  const before = (await miningState(account)).session;
  assert.ok(before);

  // None of these are read by the server; the canonical numbers come from the stored cycle.
  const forged = await settleMining(account, {
    rate: "999.000000",
    accrued: "999.0000",
    startedAt: new Date(0).toISOString(),
    endsAt: new Date(Date.now() + 10 * DAY_MS).toISOString(),
    durationSeconds: 10 * DAY_SECONDS,
  });
  assert.equal(forged.status, 200, JSON.stringify(forged.body));
  const session = forged.body["session"] as MiningSession;
  assert.equal(session.id, started.session.id);
  assert.equal(session.rate, before.rate, "the rate is still the stored one");
  assert.equal(session.endsAt, before.endsAt, "the window was not extended");
  assert.equal(session.durationSeconds, DAY_SECONDS);
  assert.ok(session.accruedMinor <= before.totalAccruedMinor, "the reward cannot exceed the 24-hour total");
  assert.ok(settledMatchesRecentAccrual(session, session.settledMinor), "only the canonical reward was credited");
  assert.equal(await balanceMinorOf(account), session.settledMinor);
});

test("another account cannot see or touch a cycle that is not its own", async () => {
  const owner = await register("isolation-owner");
  const stranger = await register("isolation-stranger");
  const started = await startMining(owner);

  const strangerState = await miningState(stranger);
  assert.equal(strangerState.status, "idle", "a fresh account sees no cycle");

  const strangerSettle = await settleMining(stranger);
  assert.equal(strangerSettle.status, 200);
  assert.equal(strangerSettle.body["session"], null, "settling your own idle account touches nothing else");
  const ownerStillOwns = await collections.miningSessions.findOne({ publicId: started.session.id });
  assert.equal(ownerStillOwns?.ownerUserId, owner.userId, "the owner's cycle is untouched");
});

test("the database enforces one active cycle per account", async () => {
  const account = await register("unique");
  await startMining(account);
  await assert.rejects(
    () =>
      collections.miningSessions.insertOne({
        publicId: randomUUID(),
        ownerUserId: account.userId,
        walletId: account.walletId,
        ledgerAccountId: account.ledgerAccountId,
        status: "active",
        cycleNumber: 99,
        startedAt: new Date(),
        endsAt: new Date(Date.now() + DAY_MS),
        durationSeconds: DAY_SECONDS,
        rateUnits: 10_000,
        rateScale: 1_000_000,
        rateDecimals: 6,
        rate: "0.010000",
        rateUnit: "LMA/hour",
        settledMinor: 0,
        settlementSequence: 0,
        lastSettledAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as never),
    (error: unknown) => error instanceof MongoServerError && error.code === 11000,
  );
});

test("the ledger remains reconciled after mining settles", async () => {
  const result = await reconcileLedger({ collections, mongoClient: client, options: { excludeCorrelationIdPrefixes: ["smoke-funding-"] } });
  assert.ok(result.ok, `ledger reconciliation must pass: ${JSON.stringify(result.issues)}`);
});
