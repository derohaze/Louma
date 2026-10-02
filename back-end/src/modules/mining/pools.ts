import { ObjectId } from "mongodb";
import type { AppConfig } from "../../config/env.js";
import type { Collections } from "../../infrastructure/mongodb/collections.js";
import { invalidate, poolMembershipKey, type CacheContext } from "../../infrastructure/redis/cache.js";
import { secureRandomIntInclusive } from "./rate.js";
import { loadMiningSettings } from "./settings.js";
import { loadPoolId } from "./state.js";
import { badRequest, conflict } from "../../shared/errors.js";

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

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === 11000
  );
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
}): Promise<boolean> {
  const moved = await input.collections.miningPoolMembers.updateOne(
    { ownerUserId: input.ownerUserId, poolId: input.fromPoolId },
    { $set: { poolId: input.prevPoolId, updatedAt: new Date() } },
  );
  if (moved.modifiedCount !== 1) {
    const now = new Date();
    try {
      await input.collections.miningPoolMembers.insertOne({
        _id: new ObjectId(),
        ownerUserId: input.ownerUserId,
        poolId: input.prevPoolId,
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
  });
}

/**
 * Keeps one room at or below its cap after a membership was written outside the join path. Rows are
 * trimmed newest-first, so a just-restored switcher is the first removed when the room filled up
 * while it was away — it then stays pool-less, exactly like a new joiner that could not get a seat,
 * rather than leaving the room above `maxMembers`. Returns whether the account is still a member.
 */
async function enforceMembershipCap(input: {
  collections: Collections;
  config: PoolsConfig;
  ownerUserId: string;
  poolId: MiningPoolId;
}): Promise<boolean> {
  const pool = getPoolById(input.config, input.poolId);
  for (;;) {
    const total = await input.collections.miningPoolMembers.countDocuments({ poolId: pool.id });
    if (total <= pool.maxMembers) return true;
    const window = await input.collections.miningPoolMembers
      .find({ poolId: pool.id }, { projection: { ownerUserId: 1, updatedAt: 1 } })
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

/** One bounded draw from the member's pool (average 1.0x for both pools). */
export function drawPoolFactorBps(config: PoolsConfig, poolId: MiningPoolId): number {
  const pool = getPoolById(config, poolId);
  return secureRandomIntInclusive(pool.rewardMinBps, pool.rewardMaxBps);
}

/** Applies the pool factor to an already-drawn base rate, staying an exact integer ≥ 1. */
export function applyPoolFactor(baseRateUnits: number, factorBps: number): number {
  return Math.max(1, Math.round((baseRateUnits * factorBps) / 10_000));
}

export interface MiningPoolMembershipRecord {
  _id: ObjectId;
  ownerUserId: string;
  poolId: MiningPoolId;
  joinedAt: Date;
  updatedAt: Date;
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
  /** The pool this account mines in, or null when it must join one first. */
  poolId: MiningPoolId | null;
}

export async function getMiningPoolsState(input: {
  collections: Collections;
  config: PoolsConfig;
  ownerUserId: string;
  cache?: CacheContext | undefined;
  membershipCache?: CacheContext | undefined;
}): Promise<PublicMiningPoolsState> {
  const live = await loadMiningSettings(input.collections, input.config, input.cache);
  const poolId = await loadPoolId(input.collections, input.ownerUserId, input.membershipCache);
  const membership = poolId === null ? null : { poolId };
  const defs = poolDefinitions(live);
  const counts = await Promise.all(
    defs.map((pool) => input.collections.miningPoolMembers.countDocuments({ poolId: pool.id })),
  );
  return {
    poolId: (membership?.poolId as MiningPoolId | undefined) ?? null,
    pools: defs.map((pool, index) => {
      const activeMiners = counts[index] ?? 0;
      const joined = membership?.poolId === pool.id;
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
  // Re-joining the same room is a no-op success: return before any write or pool-wide
  // read, so the steady-state join costs one indexed lookup instead of a sort over the pool.
  const current = await input.collections.miningPoolMembers.findOne({ ownerUserId: input.ownerUserId });
  if (current?.poolId === pool.id) {
    return getMiningPoolsState({ collections: input.collections, config: live, ownerUserId: input.ownerUserId, cache: input.cache, membershipCache: input.membershipCache });
  }
  const occupants = await input.collections.miningPoolMembers.countDocuments({ poolId: pool.id });
  if (occupants >= pool.maxMembers) {
    throw conflict("mining_pool_full", `${pool.name} is full. Try the other pool or try again later.`);
  }
  const prevPoolId = current?.poolId ?? null;
  // `updatedAt` is stamped by the server (`$$NOW`) rather than captured before the write: a join
  // delayed between capture and write would otherwise land with an older stamp than a join whose
  // success was already returned, sort as the older row in the trim below, and evict that winner —
  // leaving a member who was told it joined without a membership. Server time orders rows by when
  // they actually landed. `joinedAt` keeps the first-seen time on a switch.
  await input.collections.miningPoolMembers.updateOne(
    { ownerUserId: input.ownerUserId },
    [{ $set: { poolId: pool.id, joinedAt: { $ifNull: ["$joinedAt", "$$NOW"] }, updatedAt: "$$NOW" } }],
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
  // falls back to its previous room while an evicted new joiner would be left pool-less.
  // The scan keeps the index-backed sort (`mining_pool_members_pool_recency`) and its bound
  // (`maxMembers + 1` rows); only the victim choice among the tied-latest rows is in code.
  for (;;) {
    const total = await input.collections.miningPoolMembers.countDocuments({ poolId: pool.id });
    if (total <= pool.maxMembers) break;
    const window = await input.collections.miningPoolMembers
      .find({ poolId: pool.id }, { projection: { ownerUserId: 1, updatedAt: 1 } })
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
    // left pool-less (and unable to mine until it joins again); a new joiner is removed.
    if (prevPoolId !== null && prevPoolId !== pool.id) {
      await restorePreviousMembership({
        collections: input.collections,
        config: input.config,
        ownerUserId: input.ownerUserId,
        prevPoolId,
        fromPoolId: pool.id,
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
  // losing its own trim above) instead of being left pool-less; a new joiner has nowhere to go
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

export async function leaveMiningPool(input: {
  collections: Collections;
  config: PoolsConfig;
  ownerUserId: string;
  cache?: CacheContext | undefined;
  membershipCache?: CacheContext | undefined;
}): Promise<PublicMiningPoolsState> {
  await input.collections.miningPoolMembers.deleteOne({ ownerUserId: input.ownerUserId });
  const handle = input.membershipCache?.redis ?? input.cache?.redis;
  if (handle) await invalidate(handle, poolMembershipKey(handle, input.ownerUserId));
  return getMiningPoolsState({ collections: input.collections, config: input.config, ownerUserId: input.ownerUserId, cache: input.cache, membershipCache: input.membershipCache });
}
