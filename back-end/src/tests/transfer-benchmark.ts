import { randomUUID } from "node:crypto";
import { ObjectId } from "mongodb";
import { loadConfig, type AppConfig } from "../config/env.js";
import { connectMongo } from "../infrastructure/mongodb/client.js";
import { getCollections, type Collections } from "../infrastructure/mongodb/collections.js";
import { ensureDatabaseIndexes } from "../infrastructure/mongodb/indexes.js";
import { createTransfer, previewTransfer } from "../modules/transfers/service.js";
import { parseMoneyToMinorUnits } from "../modules/ledger/money.js";
import { generateWalletAddress } from "../modules/wallets/address.js";

/**
 * The financial load benchmark: throughput and latency of the transfer path under concurrency, and
 * the workload shapes that decide where the writes serialise.
 *
 * Run with `npm run bench:transfers -- --concurrency 1,10,50 --per-level 20 --shapes A,B,C,D`.
 *
 * What it measures is the whole database footprint of one transfer — the approval insert, the
 * transaction, the conditional approval consume, the sender debit, the receiver credit, the fee
 * credit, the transaction header, three ledger lines, two notifications, and the security event —
 * against the configured cluster, with no HTTP in the way. That is deliberately the *widest* write
 * set the product performs per transfer; the endpoint adds only request parsing.
 *
 * The shapes exist to answer one question honestly: where does contention actually come from?
 *
 *  - A: random senders, random receivers, with a fee — every transfer writes the shared fee account.
 *  - B: random senders, one receiver, with a fee — the same, plus one hot receiver.
 *  - C: random senders, random receivers, **no fee** (an amount small enough to round the fee to
 *       zero) — every transfer except the fee write. Comparing A with C isolates the cost of the
 *       single global fee document; if the two do not diverge under load, partitioning the fee
 *    account would buy throughput the workload never needed.
 *  - D: identical requests under one idempotency key — the duplicate-submission storm a double click,
 *       a retrying client, or a bot produces.
 *
 * Every row it writes is prefixed `benchmark-` and removed at the end, with the shared fee and
 * treasury projections returned by exactly the amount this run added. It creates no operator state
 * and changes no configuration.
 */

const RUN_TAG = process.env["BENCH_TAG"] ?? randomUUID().slice(0, 8);
const CORRELATION_PREFIX = `benchmark-${RUN_TAG}-`;
const PASSWORD_HASH = "$argon2id$v=19$m=19456,t=2,p=1$benchmarkbenchmarkbenchmark$benchmarkbenchmarkbenchmarkbenchmarkbenchmark";

interface Options {
  concurrency: number[];
  perLevel: number;
  shapes: string[];
  senders: number;
  receivers: number;
  amount: string;
}

function parseOptions(): Options {
  const values = new Map<string, string>();
  for (const argument of process.argv.slice(2)) {
    const [key, value] = argument.replace(/^--/, "").split("=");
    if (key && value !== undefined) values.set(key, value);
  }
  return {
    concurrency: (values.get("concurrency") ?? "1,10,50").split(",").map((value) => Number(value.trim())).filter((value) => Number.isSafeInteger(value) && value > 0),
    perLevel: Number(values.get("per-level") ?? 20),
    shapes: (values.get("shapes") ?? "A,B,C,D").split(",").map((value) => value.trim().toUpperCase()),
    senders: Number(values.get("senders") ?? 10),
    receivers: Number(values.get("receivers") ?? 10),
    amount: values.get("amount") ?? "0.5000",
  };
}

interface Fixture {
  userId: string;
  walletId: string;
  address: string;
  ledgerAccountId: string;
}

async function createAccounts(collections: Collections, count: number, role: string, funded: boolean): Promise<Fixture[]> {
  const now = new Date();
  const fixtures: Fixture[] = [];
  for (let index = 0; index < count; index += 1) {
    const userId = randomUUID();
    const walletId = randomUUID();
    const ledgerAccountId = randomUUID();
    const address = generateWalletAddress();
    await collections.users.insertOne({
      _id: new ObjectId(),
      publicId: userId,
      email: `bench.${RUN_TAG}.${role}.${index}.${randomUUID()}@example.test`,
      passwordHash: PASSWORD_HASH,
      profile: { displayName: `Bench ${role} ${index}`, country: null },
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
    fixtures.push({ userId, walletId, address, ledgerAccountId });
  }
  if (funded) {
    // One funding transaction per sender, recorded the way a controlled issuance is: a debit on the
    // treasury, a credit on the wallet, and both projections moved by the same amount.
    const treasuryPublicId = randomUUID();
    await collections.ledgerAccounts.updateOne(
      { accountType: "system_treasury", currency: "LMA" },
      { $setOnInsert: { publicId: treasuryPublicId, walletId: null, accountType: "system_treasury", currency: "LMA", balanceMinor: 0, createdAt: now } },
      { upsert: true },
    );
    const treasury = await collections.ledgerAccounts.findOne({ accountType: "system_treasury", currency: "LMA" });
    if (!treasury) throw new Error("Failed to ensure the treasury account");
    const funding = parseMoneyToMinorUnits("1000.0000");
    for (const fixture of fixtures) {
      const transactionId = `${CORRELATION_PREFIX}fund-${fixture.userId}`;
      await collections.ledgerEntries.insertMany(
        [
          { publicId: randomUUID(), transactionId, lineNumber: 1, walletId: null, ledgerAccountId: treasury.publicId, side: "debit", amountMinor: funding, currency: "LMA", correlationId: `${CORRELATION_PREFIX}fund`, createdAt: now },
          { publicId: randomUUID(), transactionId, lineNumber: 2, walletId: fixture.walletId, ledgerAccountId: fixture.ledgerAccountId, side: "credit", amountMinor: funding, currency: "LMA", correlationId: `${CORRELATION_PREFIX}fund`, createdAt: now },
        ] as never,
      );
      await collections.ledgerAccounts.updateMany(
        { $or: [{ publicId: fixture.ledgerAccountId }, { _id: treasury._id }] },
        { $inc: { balanceMinor: funding } },
      );
    }
  }
  return fixtures;
}

function percentile(sorted: number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.floor(fraction * (sorted.length - 1)));
  return sorted[index] ?? 0;
}

async function runLevel(input: {
  shape: string;
  concurrency: number;
  total: number;
  senders: Fixture[];
  receivers: Fixture[];
  amount: string;
  collections: Collections;
  mongoClient: Parameters<typeof createTransfer>[0]["mongoClient"];
  config: AppConfig;
}): Promise<Record<string, unknown> & { transactions: string[] }> {
  const { collections, config } = input;
  const amount = input.shape === "C" ? "0.0049" : input.amount; // 0.0049 rounds its 1% fee to zero.
  const latencies: number[] = [];
  let ok = 0;
  let refused = 0;
  let conflicts = 0;
  let other = 0;
  const amountMinor = parseMoneyToMinorUnits(amount);
  const createdTransactionIds: string[] = [];
  const runId = randomUUID();

  const oneTransfer = async (index: number): Promise<void> => {
    const sender = input.senders[index % input.senders.length]!;
    const receiver = input.shape === "B" ? input.receivers[0]! : input.receivers[index % input.receivers.length]!;
    const idempotencyKey = input.shape === "D" ? `${runId}-shared` : `${runId}-${index}`;
    const start = process.hrtime.bigint();
    try {
      const preview = await previewTransfer({
        collections,
        ownerUserId: sender.userId,
        recipientAddress: receiver.address,
        amount,
        note: "",
        requestId: `${CORRELATION_PREFIX}${runId}`,
      });
      if (!preview.authorization) throw new Error("no authorization issued");
      const result = await createTransfer({
        collections,
        mongoClient: input.mongoClient,
        config,
        ownerUserId: sender.userId,
        authorizationId: preview.authorization.id,
        recipientAddress: receiver.address,
        amount,
        note: "",
        idempotencyKey,
        requestId: `${CORRELATION_PREFIX}${runId}`,
      });
      createdTransactionIds.push(result.id);
      ok += 1;
    } catch (error) {
      const status = (error as { statusCode?: number }).statusCode;
      const code = (error as { code?: unknown }).code;
      if (code === "transfer_conflict") conflicts += 1;
      else if (status === 409 || status === 403) refused += 1;
      else other += 1;
    } finally {
      latencies.push(Number(process.hrtime.bigint() - start) / 1e6);
    }
  };

  const startedAt = Date.now();
  let next = 0;
  const workers = Array.from({ length: input.concurrency }, async () => {
    for (;;) {
      const index = next++;
      if (index >= input.total) return;
      await oneTransfer(index);
    }
  });
  await Promise.all(workers);
  const elapsedMs = Date.now() - startedAt;

  const sorted = [...latencies].sort((left, right) => left - right);
  return {
    shape: input.shape,
    fee: amountMinor >= 50,
    concurrency: input.concurrency,
    requests: input.total,
    ok,
    refused,
    retry_exhausted: conflicts,
    other_errors: other,
    tps: Number(((input.total / elapsedMs) * 1000).toFixed(1)),
    p50_ms: Number(percentile(sorted, 0.5).toFixed(1)),
    p95_ms: Number(percentile(sorted, 0.95).toFixed(1)),
    p99_ms: Number(percentile(sorted, 0.99).toFixed(1)),
    elapsed_ms: elapsedMs,
    transactions: createdTransactionIds,
  };
}

async function main(): Promise<void> {
  const options = parseOptions();
  const config = loadConfig();
  const connection = await connectMongo(config, { serverSelectionTimeoutMS: 30_000, connectTimeoutMS: 20_000 });
  const { client, db } = connection;
  const collections = getCollections(db);
  const createdUserIds: string[] = [];
  const createdTransactionIds: string[] = [];
  try {
    await ensureDatabaseIndexes(db);
    const senders = await createAccounts(collections, options.senders, "sender", true);
    const receivers = await createAccounts(collections, options.receivers, "receiver", false);
    for (const fixture of [...senders, ...receivers]) createdUserIds.push(fixture.userId);

    const feeAccountBefore = await collections.ledgerAccounts.findOne({ accountType: "fee_revenue", currency: "LMA" });
    const treasuryBefore = await collections.ledgerAccounts.findOne({ accountType: "system_treasury", currency: "LMA" });
    console.log(JSON.stringify({ benchmark: "transfer", tag: RUN_TAG, database: config.mongoDatabase, hosts: "configured cluster", senders: senders.length, receivers: receivers.length, amount: options.amount, perLevel: options.perLevel, note: "measurement includes every database write of one transfer; no HTTP in the path" }));

    let workloadError: unknown = null;
    try {
      for (const shape of options.shapes) {
        for (const concurrency of options.concurrency) {
          const { transactions, ...row } = await runLevel({
            shape,
            concurrency,
            total: options.perLevel,
            senders,
            receivers,
            amount: options.amount,
            collections,
            mongoClient: client,
            config,
          });
          createdTransactionIds.push(...transactions);
          console.log(JSON.stringify(row));
        }
      }
    } catch (error) {
      workloadError = error;
    }

    // Cleanup: remove this run's writes, and take the shared accounts back by exactly this run's
    // contribution (recorded from the immutable entries, never by recomputing a balance).
    // Runs even when the workload above failed, so a failed benchmark never leaves test users,
    // funding entries, or balance changes behind.
    // The fee account is re-resolved here (not only the pre-run read): the first fee-bearing
    // transfer creates it after `feeAccountBefore` was taken, and its entries must still reverse.
    const feeAccountNow = (await collections.ledgerAccounts.findOne({ accountType: "fee_revenue", currency: "LMA" })) ?? feeAccountBefore;
    const feeDelta = feeAccountNow && createdTransactionIds.length > 0
      ? (await collections.ledgerEntries.find({ ledgerAccountId: feeAccountNow.publicId, transactionId: { $in: createdTransactionIds } }).toArray()).reduce(
          (total, entry) => total + (entry.side === "credit" ? entry.amountMinor : -entry.amountMinor),
          0,
        )
      : 0;
    const senderFunding = options.senders * parseMoneyToMinorUnits("1000.0000");
    for (const userId of createdUserIds) {
      await collections.transferAuthorizations.deleteMany({ ownerUserId: userId });
      await collections.twoFactorUses.deleteMany({ ownerUserId: userId });
      await collections.notifications.deleteMany({ ownerUserId: userId });
      await collections.securityEvents.deleteMany({ correlationId: { $regex: `^${CORRELATION_PREFIX}` } });
      await collections.transactions.deleteMany({ $or: [{ senderUserId: userId }, { receiverUserId: userId }] });
      const wallet = await collections.wallets.findOne({ ownerUserId: userId });
      if (wallet) {
        await collections.ledgerAccounts.deleteMany({ walletId: wallet.publicId });
        await collections.wallets.deleteMany({ publicId: wallet.publicId });
      }
      await collections.users.deleteMany({ publicId: userId });
    }
    await collections.ledgerEntries.deleteMany({ correlationId: { $regex: `^${CORRELATION_PREFIX}` } });
    await collections.transactions.deleteMany({ correlationId: { $regex: `^${CORRELATION_PREFIX}` } });
    if (feeAccountNow && feeDelta !== 0) await collections.ledgerAccounts.updateOne({ _id: feeAccountNow._id }, { $inc: { balanceMinor: -feeDelta } });
    if (treasuryBefore && senderFunding !== 0) await collections.ledgerAccounts.updateOne({ _id: treasuryBefore._id }, { $inc: { balanceMinor: -senderFunding } });
    console.log(JSON.stringify({ benchmark: "transfer", tag: RUN_TAG, cleaned: true }));
    if (workloadError) throw workloadError;
  } finally {
    await client.close();
  }
}

try {
  await main();
} catch (error) {
  console.error(JSON.stringify({ ok: false, error: error instanceof Error ? error.stack ?? error.message : String(error) }));
  process.exitCode = 2;
}
