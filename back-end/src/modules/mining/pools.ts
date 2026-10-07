import { ObjectId, type ClientSession } from "mongodb";
import type { AppConfig } from "../../config/env.js";
import type { Collections } from "../../infrastructure/mongodb/collections.js";
import { invalidate, poolMembershipKey, readThrough, type CacheContext } from "../../infrastructure/redis/cache.js";
import { badRequest, conflict } from "../../shared/errors.js";
import { secureRandomIntInclusive } from "./rate.js";
import { loadMiningSettings } from "./settings.js";

/**
 * Community mining rooms (MVP).
 *
 * Two system pools only, every setting from the environment (`MINING_POOL_LOW_*`,
 * `MINING_POOL_MEDIUM_*`): hashrate, reward-factor band, and member cap. Membership is
 * mandatory for mining: `startMining` refuses when the account holds no membership.
 * The pool does NOT create a reward per user — each cycle's rate is the server-drawn
 * base rate scaled by one bounded random factor from the member's pool (average ≈ 1.0
 * for both pools, so pool choice adds variance, not issuance). Effective power
 * display is `baseHashrate / activeMiners`.
 *
 * One row per account (`mining_pool_members`) is a HOLD, not a permanent membership: being in a
 * room and mining in it are the same fact, so a hold ends with the cycle that justified it.
 *
 * - Joining holds the room for `MINING_POOL_HOLD_SECONDS` — the join -> start step.
 * - Starting a cycle extends the hold to the cycle's end (`expiresAt = endsAt`, a compare-and-set
 *   against the row that is still this account's held room).
 * - A cycle that ends — window over, or stopped early — releases the room. The natural end needs
 *   no write at all: every read treats a hold whose `expiresAt` has passed as absent, and the TTL
 *   index on `expiresAt` reaps the row. `stop`/`leave` release it explicitly.
 * - A released row stays until `release + switchCooldownSeconds` as the throttle's anchor, then
 *   the TTL index reaps it. Reads only ever see a live hold (`status: "held"` and `expiresAt` in
 *   the future); a row without those fields — written before holds existed — reads as released.
 *
 * Validation on every path that can move the room:
 *
 * - `join` refuses while a cycle is running (a running cycle owns the room it drew its rate from;
 *   stopping is what releases it) and refuses a change to a different room inside the cooldown.
 *   Re-joining the room already held is a no-op: continuing in one's own room is never throttled,
 *   which keeps the stop -> rejoin -> start loop free.
 * - `leave` refuses while a cycle is running, for the same reason.
 * - `start` refuses without a live hold, so an expired hold can never open a cycle.
 *
 * No synchronous rounds, no PPS/PPLNS yet: cycles stay individual 24h windows tagged
 * with the pool they started in. Shared-round settlement can be layered on later.
 */

export type MiningPoolId = "low" | "medium";

type PoolsConfig = Pick<AppConfig, "mining" | "miningPools">;

interface StaticPoolMeta {
  id: MiningPoolId;
  name: string;
  riskLevel: "low" | "medium";
  description: string;
}

const POOL_META: StaticPoolMeta[] = [
  {
    id: "low",
    name: "Low Pool",
    riskLevel: "low",
    description: "Steadier rewards, smaller swings. Best for predictable mining.",
  },
  {
    id: "medium",
    name: "Medium Pool",
    riskLevel: "medium",
    description: "Higher variance, bigger upside. Same long-run average as Low.",
  },
];

export interface MiningPoolDefinition extends StaticPoolMeta {
  baseHashrate: number;
  /** Bounded random factor in basis points (10000 = 1.0x), applied to the drawn base rate. */
  rewardMinBps: number;
  rewardMaxBps: number;
  maxMembers: number;
  /** Human-readable reward range in LOUMA per cycle-equivalent, for display only. */
  rewardRangeText: string;
}

function rewardRangeText(minBps: number, maxBps: number): string {
  return `${(minBps / 10_000).toFixed(2)} – ${(maxBps / 10_000).toFixed(2)} LOUMA`;
}

export function poolDefinitions(config: PoolsConfig): MiningPoolDefinition[] {
  return POOL_META.map((meta) => {
    const spec = config.miningPools[meta.id];
    return {
      ...meta,
      baseHashrate: spec.baseHashrate,
      rewardMinBps: spec.rewardMinBps,
      rewardMaxBps: spec.rewardMaxBps,
      maxMembers: spec.maxMembers,
      rewardRangeText: rewardRangeText(spec.rewardMinBps, spec.rewardMaxBps),
    };
  });
}

export function getPoolById(config: PoolsConfig, poolId: string): MiningPoolDefinition {
  const pool = poolDefinitions(config).find((entry) => entry.id === poolId);
  if (!pool) throw badRequest("invalid_pool", "Unknown mining pool.");
  return pool;
}

function poolNameOf(poolId: string): string {
  return POOL_META.find((meta) => meta.id === poolId)?.name ?? "your room";
}

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === 11000
  );
}

/** One bounded draw from the member's pool (average 1.0x for both pools). */
export function drawPoolFactorBps(config: PoolsConfig, poolId: MiningPoolId): number {
  const pool = getPoolById(config, poolId);
  return secureRandomIntInclusive(pool.rewardMinBps, pool.rewardMaxBps);
}

/** Applies the pool factor to an already-drawn base rate, staying an exact integer ≥ 1. */
export function applyPoolFactor(baseRateUnits: number, factorBps: number): number {
  return Math.max(1, Math.round((baseRateUnits * factorBps) / 10_000));
}

export type MiningPoolMembershipStatus = "held" | "released";

export interface MiningPoolMembershipRecord {
  _id: ObjectId;
  ownerUserId: string;
  poolId: MiningPoolId;
  /** `held` while the account is in the room; `released` once it left. Missing = released. */
  status?: MiningPoolMembershipStatus;
  /** When the hold ends; a hold that has passed is not a membership. Missing = released. */
  expiresAt?: Date;
  /**
   * When this account may change to a *different* room again. Written with the application clock —
   * the same clock that reads it — because it only has meaning as a duration (`change + cooldown`);
   * `updatedAt` below stays the database's own stamp for ordering writes.
   */
  changeAvailableAt?: Date;
  /** When the hold was released; `null` while it is held. */
  releasedAt?: Date | null;
  joinedAt: Date;
  /** Last membership write, stamped by the server (`$$NOW`). Orders rows in the cap trim. */
  updatedAt: Date;
}

/**
 * Whether the row is a membership *right now*: held, with a deadline still ahead of the server
 * clock. Every reader — the pool gate, the pools page, and the cap trim — goes through this, so a
 * hold that outlived its cycle can never be mined on, counted, or switched from.
 */
export function isLiveMembership(row: MiningPoolMembershipRecord, nowMs: number): boolean {
  return row.status === "held" && row.expiresAt !== undefined && row.expiresAt.getTime() > nowMs;
}

/** The stored shape used by the cache read: JSON-safe (no `Date`), evaluated against the clock. */
interface MembershipView {
  poolId: MiningPoolId;
  status: MiningPoolMembershipStatus | null;
  expiresAtMs: number | null;
}

function membershipView(row: MiningPoolMembershipRecord | null): MembershipView | null {
  if (!row) return null;
  return {
    poolId: row.poolId,
    status: row.status ?? null,
    expiresAtMs: row.expiresAt ? row.expiresAt.getTime() : null,
  };
}

/**
 * The room this account holds right now, or null. Cached for the state read only (`start`'s gate
 * reads MongoDB directly, see docs/redis.md), and the cached copy keeps the deadline so a stale
 * entry can never outlive the hold it describes.
 */
export async function loadPoolId(
  collections: Collections,
  ownerUserId: string,
  cache?: CacheContext | undefined,
): Promise<string | null> {
  const nowMs = Date.now();
  if (!cache) {
    const row = await collections.miningPoolMembers.findOne({ ownerUserId });
    return row && isLiveMembership(row, nowMs) ? row.poolId : null;
  }
  const read = await readThrough<MembershipView | null>({
    redis: cache.redis,
    key: poolMembershipKey(cache.redis, ownerUserId),
    ttlSeconds: cache.ttlSeconds,
    load: async () => membershipView(await collections.miningPoolMembers.findOne({ ownerUserId })),
  });
  const view = read.value;
  if (!view || view.status !== "held" || view.expiresAtMs === null) return null;
  return view.expiresAtMs > nowMs ? view.poolId : null;
}

export interface PublicMiningPool {
  id: MiningPoolId;
  name: string;
  riskLevel: "low" | "medium";
  baseHashrate: number;
  activeMiners: number;
  maxMembers: number;
  /** True when the room is at capacity and new joins are refused until someone leaves. */
  full: boolean;
  /** Effective share per miner right now: baseHashrate / max(activeMiners, 1). */
  effectivePower: number;
  /** This account's share of the room's power in percent (0 when not a member). */
  mySharePercent: number;
  rewardRangeText: string;
  description: string;
  joined: boolean;
}

export interface PublicMiningPoolsState {
  pools: PublicMiningPool[];
  /** The room this account holds, or null when it holds none. */
  poolId: MiningPoolId | null;
  /** When the current hold ends: the cycle's end, or the join grace. Null when no room is held. */
  holdExpiresAt: string | null;
  /**
   * When a change to a different room becomes available, or null when nothing throttles it. The
   * room already held can always be re-joined; only moving elsewhere waits for this instant.
   */
  switchAvailableAt: string | null;
  /** True while a cycle is running: its room is held for it and cannot be changed. */
  cycleActive: boolean;
}

/** Members of a room right now: live holds only, never released rows kept as throttle anchors. */
function liveHoldFilter(poolId: MiningPoolId, nowMs: number): Record<string, unknown> {
  return { poolId, status: "held", expiresAt: { $gt: new Date(nowMs) } };
}

function countLiveMembers(collections: Collections, poolId: MiningPoolId, nowMs: number): Promise<number> {
  return collections.miningPoolMembers.countDocuments(liveHoldFilter(poolId, nowMs));
}

/** The account's cycle that is still running. An expired-but-unsettled cycle is not running. */
function findRunningCycle(collections: Collections, ownerUserId: string, now: Date): Promise<unknown> {
  return collections.miningSessions.findOne(
    { ownerUserId, status: "active", endsAt: { $gt: now } },
    { projection: { publicId: 1 } },
  );
}

export async function getMiningPoolsState(input: {
  collections: Collections;
  config: PoolsConfig;
  ownerUserId: string;
  cache?: CacheContext | undefined;
  membershipCache?: CacheContext | undefined;
}): Promise<PublicMiningPoolsState> {
  const now = new Date();
  const nowMs = now.getTime();
  const live = await loadMiningSettings(input.collections, input.config, input.cache);
  // The display read is deliberately uncached: this endpoint is where a customer sees whether a
  // room is still theirs, so it pays one indexed read to be exactly current.
  const [row, running] = await Promise.all([
    input.collections.miningPoolMembers.findOne({ ownerUserId: input.ownerUserId }),
    findRunningCycle(input.collections, input.ownerUserId, now),
  ]);
  const held = row && isLiveMembership(row, nowMs) ? row : null;
  const defs = poolDefinitions(live);
  const counts = await Promise.all(defs.map((pool) => countLiveMembers(input.collections, pool.id, nowMs)));
  return {
    poolId: held?.poolId ?? null,
    holdExpiresAt: held?.expiresAt ? held.expiresAt.toISOString() : null,
    switchAvailableAt:
      row?.changeAvailableAt && row.changeAvailableAt.getTime() > nowMs
        ? row.changeAvailableAt.toISOString()
        : null,
    cycleActive: running !== null,
    pools: defs.map((pool, index) => {
      const activeMiners = counts[index] ?? 0;
      const joined = held?.poolId === pool.id;
      return {
        id: pool.id,
        name: pool.name,
        riskLevel: pool.riskLevel,
        baseHashrate: pool.baseHashrate,
        activeMiners,
        maxMembers: pool.maxMembers,
        full: activeMiners >= pool.maxMembers,
        effectivePower: pool.baseHashrate / Math.max(activeMiners, 1),
        mySharePercent: joined && activeMiners > 0 ? (100 / activeMiners) : 0,
        rewardRangeText: pool.rewardRangeText,
        description: pool.description,
        joined,
      };
    }),
  };
}

/**
 * Puts a switcher back into its previous room after a join to another room did not stick.
 *
 * Both restore paths race with other joins, so this never clobbers a membership another join has
 * already made this account's own. The move is guarded on the row still being the destination room's:
 * if a concurrent join moved it elsewhere, nothing matches and that membership is left alone. When
 * no row exists at all the write is an insert against the unique `ownerUserId` index, whose
 * duplicate-key rejection means another join won the account's membership in the meantime.
 *
 * The previous room's cap is then re-enforced, so a switcher returning to a room that filled while
 * it was away is removed again rather than pushing that room over `maxMembers`. Returns whether the
 * account ended up (and stayed) in its previous room.
 */
async function restorePreviousMembership(input: {
  collections: Collections;
  config: PoolsConfig;
  ownerUserId: string;
  prevPoolId: MiningPoolId;
  fromPoolId: MiningPoolId;
  holdSeconds: number;
  cooldownSeconds: number;
}): Promise<boolean> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + input.holdSeconds * 1000);
  const changeAvailableAt = new Date(now.getTime() + input.cooldownSeconds * 1000);
  const moved = await input.collections.miningPoolMembers.updateOne(
    { ownerUserId: input.ownerUserId, poolId: input.fromPoolId },
    { $set: { poolId: input.prevPoolId, status: "held", expiresAt, changeAvailableAt, releasedAt: null, updatedAt: now } },
  );
  if (moved.modifiedCount !== 1) {
    try {
      await input.collections.miningPoolMembers.insertOne({
        _id: new ObjectId(),
        ownerUserId: input.ownerUserId,
        poolId: input.prevPoolId,
        status: "held",
        expiresAt,
        changeAvailableAt,
        releasedAt: null,
        joinedAt: now,
        updatedAt: now,
      });
    } catch (error) {
      if (isDuplicateKeyError(error)) return false;
      throw error;
    }
  }
  return enforceMembershipCap({
    collections: input.collections,
    config: input.config,
    ownerUserId: input.ownerUserId,
    poolId: input.prevPoolId,
    nowMs: now.getTime(),
  });
}

/**
 * Keeps one room at or below its cap after a membership was written outside the join path. Rows are
 * trimmed newest-first, so a just-restored switcher is the first removed when the room filled up
 * while it was away — it then stays room-less, exactly like a new joiner that could not get a seat,
 * rather than leaving the room above `maxMembers`. Returns whether the account is still a member.
 */
async function enforceMembershipCap(input: {
  collections: Collections;
  config: PoolsConfig;
  ownerUserId: string;
  poolId: MiningPoolId;
  nowMs: number;
}): Promise<boolean> {
  const pool = getPoolById(input.config, input.poolId);
  for (;;) {
    const filter = liveHoldFilter(pool.id, input.nowMs);
    const total = await input.collections.miningPoolMembers.countDocuments(filter);
    if (total <= pool.maxMembers) return true;
    const window = await input.collections.miningPoolMembers
      .find(filter, { projection: { ownerUserId: 1, updatedAt: 1 } })
      .sort({ updatedAt: 1, _id: 1 })
      .limit(pool.maxMembers + 1)
      .toArray();
    if (window.length <= pool.maxMembers) return true;
    const newestAt = window[window.length - 1]!.updatedAt?.getTime();
    const tiedLatest = window.filter((row) => row.updatedAt?.getTime() === newestAt);
    const victim = tiedLatest[0] ?? window[window.length - 1]!;
    await input.collections.miningPoolMembers.deleteOne({ ownerUserId: victim.ownerUserId, poolId: pool.id });
    if (victim.ownerUserId === input.ownerUserId) return false;
  }
}

/** Drops this account's cached membership after the recovery paths changed it below. */
async function invalidateMembership(input: {
  cache?: CacheContext | undefined;
  membershipCache?: CacheContext | undefined;
  ownerUserId: string;
}): Promise<void> {
  const handle = input.membershipCache?.redis ?? input.cache?.redis;
  if (handle) await invalidate(handle, poolMembershipKey(handle, input.ownerUserId));
}

/**
 * Releases the account's room hold. Called by `stop`, inside the stop transaction, so the room is
 * freed in the same commit that ends the cycle — a stop can never leave a hold behind it. The row
 * is kept (not deleted) as the room-change throttle's anchor until the cooldown is over; the TTL
 * index reaps it after that.
 */
export async function releasePoolHold(input: {
  collections: Collections;
  ownerUserId: string;
  cooldownSeconds: number;
  nowMs: number;
  session?: ClientSession | undefined;
}): Promise<void> {
  const now = new Date(input.nowMs);
  const options = input.session ? { session: input.session } : {};
  // One instant with two roles: `changeAvailableAt` is how long another room waits, and `expiresAt`
  // keeps this row alive for exactly that long as the throttle's anchor — the TTL index reaps it
  // when the wait is over. The release itself is already visible: a released row is never a live
  // hold, whatever its `expiresAt`.
  const throttleUntil = new Date(input.nowMs + input.cooldownSeconds * 1000);
  await input.collections.miningPoolMembers.updateOne(
    { ownerUserId: input.ownerUserId, status: "held" },
    {
      $set: {
        status: "released",
        releasedAt: now,
        updatedAt: now,
        expiresAt: throttleUntil,
        changeAvailableAt: throttleUntil,
      },
    },
    options,
  );
}

/**
 * Extends the account's hold to the end of the cycle that was just committed. The compare-and-set
 * keeps it honest: only the room this cycle started in, and only while it is still held, is
 * extended — a release that landed in between is never resurrected.
 */
export async function extendPoolHoldToCycle(input: {
  collections: Collections;
  ownerUserId: string;
  poolId: MiningPoolId;
  endsAt: Date;
}): Promise<void> {
  await input.collections.miningPoolMembers.updateOne(
    { ownerUserId: input.ownerUserId, poolId: input.poolId, status: "held" },
    { $set: { expiresAt: input.endsAt } },
  );
}

export async function joinMiningPool(input: {
  collections: Collections;
  config: PoolsConfig;
  ownerUserId: string;
  poolId: string;
  cache?: CacheContext | undefined;
  membershipCache?: CacheContext | undefined;
}): Promise<PublicMiningPoolsState> {
  const live = await loadMiningSettings(input.collections, input.config, input.cache);
  const pool = getPoolById(live, input.poolId);
  const now = new Date();
  const nowMs = now.getTime();
  const current = await input.collections.miningPoolMembers.findOne({ ownerUserId: input.ownerUserId });
  // Re-joining the room this account already holds is a no-op success: return before any write or
  // pool-wide read, so the steady-state join costs one indexed lookup instead of a sort over the pool.
  if (current && isLiveMembership(current, nowMs) && current.poolId === pool.id) {
    return getMiningPoolsState({ collections: input.collections, config: live, ownerUserId: input.ownerUserId, cache: input.cache, membershipCache: input.membershipCache });
  }
  // A running cycle owns its room: it drew its rate from this room and the account's presence in it
  // is what the pool gate means. Stopping releases the room, and only then can the account move.
  if (await findRunningCycle(input.collections, input.ownerUserId, now)) {
    throw conflict(
      "mining_cycle_active",
      "A mining cycle is running. Stop mining to release your room, then join another.",
    );
  }
  // Churn throttle: one change to a *different* room per cooldown, anchored on the instant the last
  // change wrote (`changeAvailableAt`, application clock — the same clock that reads it). Re-joining
  // the room already held never reaches this branch, so stopping and continuing in the same room is
  // free.
  if (current && current.poolId !== pool.id) {
    const availableAtMs = current.changeAvailableAt?.getTime() ?? 0;
    if (nowMs < availableAtMs) {
      const waitMinutes = Math.max(1, Math.ceil((availableAtMs - nowMs) / 60_000));
      throw conflict(
        "mining_pool_switch_cooldown",
        `Changing rooms is limited to once every ${Math.round(live.miningPools.switchCooldownSeconds / 60)} minutes. Join ${poolNameOf(current.poolId)} again now, or try this room in ${waitMinutes} minute${waitMinutes === 1 ? "" : "s"}.`,
      );
    }
  }
  const occupants = await countLiveMembers(input.collections, pool.id, nowMs);
  if (occupants >= pool.maxMembers) {
    throw conflict("mining_pool_full", `${pool.name} is full. Try the other pool or try again later.`);
  }
  const prevPoolId = current && isLiveMembership(current, nowMs) ? current.poolId : null;
  // `updatedAt` is stamped by the server (`$$NOW`) rather than captured before the write: a join
  // delayed between capture and write would otherwise land with an older stamp than a join whose
  // success was already returned, sort as the older row in the trim below, and evict that winner —
  // leaving a member who was told it joined without a membership. Server time orders rows by when
  // they actually landed. `joinedAt` keeps the first-seen time on a switch, while the two deadlines
  // this row carries — the join grace and the next change — are durations measured on the
  // application clock, so they compare consistently with the clock that reads them.
  await input.collections.miningPoolMembers.updateOne(
    { ownerUserId: input.ownerUserId },
    [
      {
        $set: {
          poolId: pool.id,
          status: "held",
          expiresAt: new Date(nowMs + live.miningPools.holdSeconds * 1000),
          changeAvailableAt: new Date(nowMs + live.miningPools.switchCooldownSeconds * 1000),
          releasedAt: null,
          joinedAt: { $ifNull: ["$joinedAt", "$$NOW"] },
          updatedAt: "$$NOW",
        },
      },
    ],
    { upsert: true },
  );
  // The pre-check above races: two joins against one seat can both pass `countDocuments`
  // before either upsert lands. Trim the pool back to the cap after the write instead.
  //
  // Ordering is by the freshly written `updatedAt`, never the preserved `joinedAt`: a
  // switching member keeps its original `joinedAt`, so ordering by it would let a later
  // writer sort earlier and pass while the earlier writer had already returned — leaving
  // the pool over capacity with nobody removing anything. By `updatedAt` the last writer
  // always sorts last. Writers tied on the same-millisecond `$$NOW` stamp evict the older
  // document (the switching member — a new join mints a fresh `_id`), because the switcher
  // falls back to its previous room while an evicted new joiner would be left room-less.
  // The scan keeps the index-backed sort (`mining_pool_members_pool_recency`) and its bound
  // (`maxMembers + 1` rows); only the victim choice among the tied-latest rows is in code.
  for (;;) {
    const filter = liveHoldFilter(pool.id, nowMs);
    const total = await input.collections.miningPoolMembers.countDocuments(filter);
    if (total <= pool.maxMembers) break;
    const window = await input.collections.miningPoolMembers
      .find(filter, { projection: { ownerUserId: 1, updatedAt: 1 } })
      .sort({ updatedAt: 1, _id: 1 })
      .limit(pool.maxMembers + 1)
      .toArray();
    if (window.length <= pool.maxMembers) break;
    const newestAt = window[window.length - 1]!.updatedAt?.getTime();
    const tiedLatest = window.filter((row) => row.updatedAt?.getTime() === newestAt);
    const victim = tiedLatest[0] ?? window[window.length - 1]!;
    if (victim.ownerUserId !== input.ownerUserId) {
      // Someone else's racing join sorts after this one: evict it and re-check, so the cap
      // holds even when that joiner already checked and returned.
      await input.collections.miningPoolMembers.deleteOne({ ownerUserId: victim.ownerUserId, poolId: pool.id });
      continue;
    }
    // This join lost the race. A switcher goes back to its previous room instead of being
    // left room-less (and unable to mine until it joins again); a new joiner is removed.
    if (prevPoolId !== null && prevPoolId !== pool.id) {
      await restorePreviousMembership({
        collections: input.collections,
        config: input.config,
        ownerUserId: input.ownerUserId,
        prevPoolId,
        fromPoolId: pool.id,
        holdSeconds: live.miningPools.holdSeconds,
        cooldownSeconds: live.miningPools.switchCooldownSeconds,
      });
    } else {
      await input.collections.miningPoolMembers.deleteOne({ ownerUserId: input.ownerUserId, poolId: pool.id });
    }
    // MongoDB moved above, so the cached membership may now be wrong: invalidate before the
    // rejection leaves, exactly as the success path does.
    await invalidateMembership(input);
    throw conflict("mining_pool_full", `${pool.name} is full. Try the other pool or try again later.`);
  }
  // A racing trim may have evicted this membership after it was counted above: confirm it is
  // still there before reporting success, or a join that did not stick would read as joined.
  // A switcher evicted by someone else's trim goes back to its previous room (same fallback as
  // losing its own trim above) instead of being left room-less; a new joiner has nowhere to go
  // back to and is removed.
  const mine = await input.collections.miningPoolMembers.findOne({ ownerUserId: input.ownerUserId, poolId: pool.id });
  if (!mine) {
    if (prevPoolId !== null && prevPoolId !== pool.id) {
      // A racing trim removed the membership after it was counted. Put the switcher back, atomically
      // and within its old room's cap, then invalidate the cached membership it changed — a cached
      // "no pool" would otherwise outlive this write until its TTL.
      await restorePreviousMembership({
        collections: input.collections,
        config: input.config,
        ownerUserId: input.ownerUserId,
        prevPoolId,
        fromPoolId: pool.id,
        holdSeconds: live.miningPools.holdSeconds,
        cooldownSeconds: live.miningPools.switchCooldownSeconds,
      });
      await invalidateMembership(input);
    }
    throw conflict("mining_pool_full", `${pool.name} is full. Try the other pool or try again later.`);
  }
  // The membership changed: invalidate eagerly so the next read is authoritative. MongoDB first,
  // cache second — a lost invalidation only serves the previous room until the TTL.
  await invalidateMembership(input);
  return getMiningPoolsState({ collections: input.collections, config: live, ownerUserId: input.ownerUserId, cache: input.cache, membershipCache: input.membershipCache });
}

/**
 * Leaves the held room. Refused while a cycle runs — the cycle lives in that room, and stopping is
 * what ends both — and idempotent otherwise: with no live hold there is nothing to write.
 */
export async function leaveMiningPool(input: {
  collections: Collections;
  config: PoolsConfig;
  ownerUserId: string;
  cache?: CacheContext | undefined;
  membershipCache?: CacheContext | undefined;
}): Promise<PublicMiningPoolsState> {
  const live = await loadMiningSettings(input.collections, input.config, input.cache);
  const now = new Date();
  const nowMs = now.getTime();
  if (await findRunningCycle(input.collections, input.ownerUserId, now)) {
    throw conflict(
      "mining_cycle_active",
      "A mining cycle is running. Stop mining to leave the room — stopping releases it for you.",
    );
  }
  const current = await input.collections.miningPoolMembers.findOne({ ownerUserId: input.ownerUserId });
  if (current && isLiveMembership(current, nowMs)) {
    await releasePoolHold({
      collections: input.collections,
      ownerUserId: input.ownerUserId,
      cooldownSeconds: live.miningPools.switchCooldownSeconds,
      nowMs,
    });
    await invalidateMembership(input);
  }
  return getMiningPoolsState({ collections: input.collections, config: live, ownerUserId: input.ownerUserId, cache: input.cache, membershipCache: input.membershipCache });
}
