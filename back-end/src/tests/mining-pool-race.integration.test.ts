import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Db, MongoClient } from "mongodb";
import { loadConfig, type AppConfig } from "../config/env.js";
import { connectMongo } from "../infrastructure/mongodb/client.js";
import { getCollections, type Collections } from "../infrastructure/mongodb/collections.js";
import { schemas } from "../infrastructure/mongodb/schemas.js";
import { ensureCollection } from "../infrastructure/mongodb/validators.js";
import { joinMiningPool, leaveMiningPool } from "../modules/mining/pools.js";
import { setMiningSetting } from "../modules/mining/settings.js";

/**
 * The mining-pool join capacity race, against a scratch database.
 *
 * A join writes its membership and only then trims the pool back to `maxMembers`, evicting the
 * newest member row by `updatedAt`. That ordering is only sound when `updatedAt` is the time the
 * write actually landed: a join that captured its timestamp before another join's success but wrote
 * after it would sort older, evict the member whose success reply the customer already received, and
 * leave that account thinking it joined while a later start (which reads MongoDB) refuses it as
 * pool-less. These tests pin the interleaving down — one deterministic late write, one concurrent
 * stress — and need a pool whose capacity and rows they fully control, so they run in a scratch
 * database instead of sharing the suites' memberships and live settings.
 *
 * Run with `npm run test:integration` (or point `--test` at this file).
 */
const RUN = randomUUID().slice(0, 8);
const SCRATCH_DATABASE = `louma_poolrace_${RUN}`;

let client: MongoClient;
let db: Db;
let collections: Collections;
let poolsConfig: Pick<AppConfig, "mining" | "miningPools">;

function deferred<T = void>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/**
 * The members collection, except that the first update writing `ownerUserId`'s membership parks
 * until `release` resolves. This is how the race is staged without touching production code: the
 * join does all its reads, captures whatever it captures, and is held exactly at the member write.
 */
function membershipUpdateDelayedFor(
  collection: Collections["miningPoolMembers"],
  ownerUserId: string,
  onParked: () => void,
  release: Promise<void>,
): Collections["miningPoolMembers"] {
  let delayedOnce = false;
  return new Proxy(collection, {
    get(target, property, receiver) {
      if (property === "updateOne") {
        return async (filter: unknown, update: unknown, options?: unknown) => {
          if (!delayedOnce && (filter as { ownerUserId?: unknown } | null)?.ownerUserId === ownerUserId) {
            delayedOnce = true;
            onParked();
            await release;
          }
          return (target.updateOne as unknown as (f: unknown, u: unknown, o?: unknown) => Promise<unknown>)(filter, update, options);
        };
      }
      const value = Reflect.get(target, property, target) as unknown;
      return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
  });
}

before(async () => {
  const config = loadConfig();
  const connection = await connectMongo(
    { ...config, mongoDatabase: SCRATCH_DATABASE },
    { serverSelectionTimeoutMS: 30_000, connectTimeoutMS: 20_000 },
  );
  client = connection.client;
  db = connection.db;
  await ensureCollection(db, "mining_pool_members", schemas["mining_pool_members"]!);
  await ensureCollection(db, "mining_settings", schemas["mining_settings"]!);
  collections = getCollections(db);
  // No room-change throttle here: these tests stage interleavings of the cap trim, and a switcher
  // must be able to move rooms inside one test. The throttle has its own test below, with the
  // policy configured explicitly.
  poolsConfig = { mining: config.mining, miningPools: { ...config.miningPools, switchCooldownSeconds: 0 } };
  // Exactly one seat in the Low room: the race is for the last seat.
  await setMiningSetting({
    collections,
    key: "mining.pools.low",
    value: { baseHashrate: 100, rewardMinBps: 8500, rewardMaxBps: 11500, maxMembers: 1 },
    updatedBy: "pool-race-test",
  });
});

after(async () => {
  if (!client) return;
  await db.dropDatabase().catch(() => undefined);
  await client.close();
});

test("a join whose write lands after another join's success loses the seat, not the successful member", async () => {
  const switcher = `race-late-${RUN}`;
  const winner = `race-early-${RUN}`;

  // `switcher` starts in Medium, so losing the race must put it back there rather than leaving it
  // pool-less (which is what an account that was told it joined would otherwise become).
  const moved = await joinMiningPool({ collections, config: poolsConfig, ownerUserId: switcher, poolId: "medium" });
  assert.equal(moved.poolId, "medium");

  const parked = deferred();
  const release = deferred();
  const delayed = membershipUpdateDelayedFor(collections.miningPoolMembers, switcher, () => parked.resolve(), release.promise);
  const lateJoin = joinMiningPool({
    collections: { ...collections, miningPoolMembers: delayed },
    config: poolsConfig,
    ownerUserId: switcher,
    poolId: "low",
  });
  await parked.promise;

  // The other join runs entirely while the late write is parked, so it holds the seat and has
  // already been answered success when the late write finally lands.
  const joined = await joinMiningPool({ collections, config: poolsConfig, ownerUserId: winner, poolId: "low" });
  assert.equal(joined.poolId, "low");

  release.resolve();
  await assert.rejects(lateJoin, (error: unknown) => (error as { code?: unknown }).code === "mining_pool_full");

  const kept = await collections.miningPoolMembers.findOne({ ownerUserId: winner, poolId: "low" });
  assert.ok(kept, "the member whose join returned success must still hold its seat");
  const restored = await collections.miningPoolMembers.findOne({ ownerUserId: switcher });
  assert.equal(restored?.poolId, "medium", "the late switcher returns to its previous room");
  assert.equal(await collections.miningPoolMembers.countDocuments({ poolId: "low" }), 1, "the cap still holds");
});

test("room changes are throttled, while the room already held stays free to re-join", async () => {
  const throttleConfig: Pick<AppConfig, "mining" | "miningPools"> = {
    mining: poolsConfig.mining,
    miningPools: { ...poolsConfig.miningPools, switchCooldownSeconds: 60 },
  };
  const account = `throttle-${RUN}`;

  const first = await joinMiningPool({ collections, config: throttleConfig, ownerUserId: account, poolId: "medium" });
  assert.equal(first.poolId, "medium");
  assert.ok(first.switchAvailableAt, "the anchor publishes when the next change becomes available");
  assert.ok(first.holdExpiresAt, "and the hold publishes when the room lapses without a start");

  await assert.rejects(
    joinMiningPool({ collections, config: throttleConfig, ownerUserId: account, poolId: "low" }),
    (error: unknown) => (error as { code?: unknown }).code === "mining_pool_switch_cooldown",
  );
  // The room already held is always available: continuing to mine is never the churn being bounded.
  const again = await joinMiningPool({ collections, config: throttleConfig, ownerUserId: account, poolId: "medium" });
  assert.equal(again.poolId, "medium");

  // Leaving releases the room but keeps the anchor: another room still waits the cooldown out...
  const left = await leaveMiningPool({ collections, config: throttleConfig, ownerUserId: account });
  assert.equal(left.poolId, null);
  await assert.rejects(
    joinMiningPool({ collections, config: throttleConfig, ownerUserId: account, poolId: "low" }),
    (error: unknown) => (error as { code?: unknown }).code === "mining_pool_switch_cooldown",
  );
  // ...while the room it just left can be taken again immediately.
  const back = await joinMiningPool({ collections, config: throttleConfig, ownerUserId: account, poolId: "medium" });
  assert.equal(back.poolId, "medium");
});

test("racing joins never leave a caller told it joined without a membership", async () => {
  await collections.miningPoolMembers.deleteMany({ poolId: "low" });
  const racers = Array.from({ length: 8 }, (_, index) => `race-concurrent-${RUN}-${index}`);
  const settled = await Promise.allSettled(
    racers.map((ownerUserId) => joinMiningPool({ collections, config: poolsConfig, ownerUserId, poolId: "low" })),
  );

  const members = await collections.miningPoolMembers.find({ poolId: "low" }).toArray();
  assert.ok(members.length <= 1, `the cap must hold once every racer settles, got ${members.length}`);
  const answeredJoined = racers.filter((_, index) => settled[index]?.status === "fulfilled");
  assert.ok(answeredJoined.length >= 1, "at least one racer must win the seat");
  for (const ownerUserId of answeredJoined) {
    assert.ok(
      members.some((member) => member.ownerUserId === ownerUserId),
      `${ownerUserId} was answered success and must still be a member`,
    );
  }
  for (const result of settled) {
    if (result.status === "rejected") {
      assert.equal((result.reason as { code?: unknown }).code, "mining_pool_full");
    }
  }
});
