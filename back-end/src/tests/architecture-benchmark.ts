/**
 * Architecture benchmark: repeatable query + cache measurements for the journal-union/Redis work.
 *
 * Runs against the database in the environment file (e.g. /tmp/louma-direct.env when the SRV
 * lookup is blocked). MongoDB-only by default; set REDIS_URL to also measure the Redis-backed
 * mode. Nothing is written: every scenario reads existing rows (seeded by the integration
 * suites) or measures a guaranteed-miss key.
 *
 * Measures per-query latency (p50/p95/p99 over 25 iterations) for the 8 hottest reads, the
 * full winning plan + docs/keys examined for the 6 critical indexed queries, and cache-aside
 * behavior (disabled vs miss vs hit) for mining settings.
 *
 * Usage:
 *   node --env-file=/tmp/louma-direct.env --import tsx src/tests/architecture-benchmark.ts
 */
import { loadConfig } from "../config/env.js";
import { connectMongo } from "../infrastructure/mongodb/client.js";
import { getCollections } from "../infrastructure/mongodb/collections.js";
import { loadMiningSettings } from "../modules/mining/settings.js";
import { RedisHandle } from "../infrastructure/redis/client.js";
import { readThrough, miningSettingsKey } from "../infrastructure/redis/cache.js";
import { generateWalletAddress } from "../modules/wallets/address.js";

const ITERATIONS = 25;

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? 0;
}

async function time(label: string, fn: () => Promise<unknown>): Promise<void> {
  const samples: number[] = [];
  for (let i = 0; i < ITERATIONS; i += 1) {
    const start = performance.now();
    await fn();
    samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  console.log(`${label}: p50=${percentile(samples, 50).toFixed(2)}ms p95=${percentile(samples, 95).toFixed(2)}ms p99=${percentile(samples, 99).toFixed(2)}ms`);
}

interface ExplainNode {
  stage?: string;
  indexName?: string;
  inputStage?: ExplainNode;
  inputStages?: ExplainNode[];
}

async function explain(
  run: () => Promise<unknown>,
  collection: string,
  filter: unknown,
): Promise<void> {
  const plan = (await run()) as {
    queryPlanner: { winningPlan: ExplainNode };
    executionStats: { totalDocsExamined: number; totalKeysExamined: number; executionTimeMillis: number };
  };
  const stages: string[] = [];
  const walk = (node: ExplainNode | undefined): void => {
    if (!node || typeof node !== "object") return;
    stages.push(node.stage ? `${node.stage}${node.indexName ? `(${node.indexName})` : ""}` : "?");
    if (node.inputStage) walk(node.inputStage);
    if (Array.isArray(node.inputStages)) node.inputStages.forEach(walk);
  };
  walk(plan.queryPlanner.winningPlan);
  console.log(
    `explain ${collection} ${JSON.stringify(filter)}: plan=${stages.join(" > ")} docs=${plan.executionStats.totalDocsExamined} ` +
      `keys=${plan.executionStats.totalKeysExamined} time=${plan.executionStats.executionTimeMillis}ms`,
  );
}

async function main(): Promise<void> {
  const config = loadConfig();
  const { client, db } = await connectMongo(config);
  try {
    const collections = getCollections(db);
    const anyUser = await collections.users.findOne({}, { projection: { publicId: 1 } });
    const ownerUserId = anyUser?.publicId ?? "benchmark-no-user";
    const primaryWallet = await collections.wallets.findOne({ ownerUserId, isPrimary: true }, { projection: { publicId: 1, addressNormalized: 1 } });
    const senderWalletId = primaryWallet?.publicId ?? "benchmark-no-wallet";
    const walletAddress = primaryWallet?.addressNormalized ?? generateWalletAddress();

    console.log("--- query latency (25 iterations) ---");
    await time("user lookup by publicId", () => collections.users.findOne({ publicId: ownerUserId }));
    await time("primary wallet lookup by owner", () => collections.wallets.findOne({ ownerUserId, isPrimary: true }));
    await time("wallet+ledger balance (2 reads)", async () => {
      const wallet = await collections.wallets.findOne({ ownerUserId, isPrimary: true });
      if (wallet) await collections.ledgerAccounts.findOne({ walletId: wallet.publicId, accountType: "wallet" });
    });
    await time("transfer history page (participants)", () =>
      collections.transactions.find({ type: "transfer", participants: ownerUserId }).sort({ createdAt: -1, publicId: -1 }).limit(21).toArray());
    await time("mining state (settings+cycle+membership)", async () => {
      await collections.miningSettings.find({}).toArray();
      await collections.miningSessions.findOne({ ownerUserId, status: "active" });
      await collections.miningPoolMembers.findOne({ ownerUserId });
    });
    await time("security history page", () =>
      collections.securityEvents.find({ ownerUserId }).sort({ createdAt: -1 }).limit(51).toArray());
    await time("notifications page+unread", async () => {
      await collections.notifications.find({ ownerUserId }).sort({ createdAt: -1, _id: -1 }).limit(21).toArray();
      await collections.notifications.countDocuments({ ownerUserId, readAt: null });
    });
    await time("idempotency lookup", () =>
      collections.transactions.findOne({ type: "transfer", senderWalletId, idempotencyKey: "benchmark-no-such-key" }));

    console.log("--- explain plans (IXSCAN expected, bounded examines) ---");
    const explainFind = (
      collection: { find: (filter: never) => { sort: (s: never) => { limit: (n: number) => { explain: () => Promise<unknown> } } } },
      filter: object,
      sort: object,
    ): (() => Promise<unknown>) =>
      () => collection.find(filter as never).sort(sort as never).limit(5).explain();
    await explain(explainFind(collections.transactions, { type: "transfer", participants: ownerUserId }, { createdAt: -1, publicId: -1 }), "transactions", { type: "transfer", participants: ownerUserId });
    await explain(explainFind(collections.wallets, { ownerUserId, isPrimary: true }, { _id: 1 }), "wallets", { ownerUserId, isPrimary: true });
    await explain(explainFind(collections.wallets, { addressNormalized: walletAddress }, { _id: 1 }), "wallets", { addressNormalized: walletAddress });
    await explain(explainFind(collections.transactions, { type: "transfer", senderWalletId, idempotencyKey: "x" }, { _id: 1 }), "transactions", { type: "transfer", senderWalletId, idempotencyKey: "x" });
    await explain(explainFind(collections.transactions, { type: "mining", miningSessionId: "x", sequenceNumber: 1 }, { _id: 1 }), "transactions", { type: "mining", miningSessionId: "x", sequenceNumber: 1 });
    await explain(explainFind(collections.ledgerEntries, { ledgerAccountId: "x" }, { _id: 1 }), "ledger_entries", { ledgerAccountId: "x" });
    await explain(explainFind(collections.miningSessions, { ownerUserId, status: "active" }, { _id: 1 }), "mining_sessions", { ownerUserId, status: "active" });
    await explain(explainFind(collections.transferAuthorizations, { ownerUserId }, { createdAt: -1 }), "transfer_authorizations", { ownerUserId });

    console.log("--- mining-settings read modes ---");
    const defaults = { mining: config.mining, miningPools: config.miningPools };
    await time("settings MongoDB-only (no cache ctx)", () => loadMiningSettings(collections, defaults));
    const redis = new RedisHandle(config.redis);
    await redis.connect();
    if (!redis.enabled) {
      console.log("settings cache: REDIS_URL unset — MongoDB-only mode (correctness baseline)");
    } else {
      const ctx = { redis, ttlSeconds: config.redis.miningSettingsCacheTtlSeconds };
      await redis.usable()?.del(miningSettingsKey(redis));
      await time("settings cache MISS (populates)", () => loadMiningSettings(collections, defaults, ctx));
      await time("settings cache HIT", () => loadMiningSettings(collections, defaults, ctx));
      // Stampede single-flight across processes: concurrent misses share one MongoDB load.
      await redis.usable()?.del(miningSettingsKey(redis));
      const parallel = await Promise.all(Array.from({ length: 10 }, () => readThrough({ redis, key: miningSettingsKey(redis), ttlSeconds: 30, load: () => collections.miningSettings.find({}).toArray() })));
      console.log(`single-flight: ${parallel.length} concurrent readers served, hits=${redis.counters.hits} misses=${redis.counters.misses} errors=${redis.counters.errors}`);
    }
    await redis.close();
    console.log("BENCHMARK_DONE");
  } finally {
    await client.close();
  }
}

try {
  await main();
} catch (error) {
  console.error("BENCHMARK_FAILED", error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
