import type { RedisHandle } from "./client.js";
import { acquireAdvisoryLock, releaseAdvisoryLock } from "./locks.js";

/**
 * Cache-aside for rebuildable read models (see ADR-002 and docs/redis.md).
 *
 * Pattern: Redis GET → on miss, MongoDB read → populate Redis → return. Writes go to MongoDB
 * first and then invalidate the affected keys; a reader that loses a race with a writer serves
 * the previous value for at most the key's TTL, which is why ONLY data whose staleness window
 * is explicitly documented may be cached here:
 *
 * - mining settings (TTL 30s; operator changes propagate within the window)
 * - pool membership (TTL 60s; join/leave invalidates eagerly)
 * - recipient display names for preview masking (TTL 5min; cosmetic only)
 *
 * NEVER cached: wallet balances, transfer history, authorization state, credential state,
 * session state, or anything a money movement reads as authoritative. Those paths read MongoDB.
 *
 * Stampede protection is two layers: an in-process single-flight (concurrent requests in one
 * process share one MongoDB load) plus a best-effort cross-process advisory lock (only the lock
 * holder populates; the losers serve their own MongoDB read without populating). If Redis is
 * down, every read is a direct MongoDB read — slower, never wrong.
 */

/** Largest serialized value the cache accepts. Entries are small read models, never blobs. */
export const MAX_CACHE_VALUE_BYTES = 64 * 1024;

export interface CacheRead<T> {
  value: T;
  fromCache: boolean;
}

/** What a service needs to read through the cache: the handle plus the entry's TTL budget. */
export interface CacheContext {
  redis: RedisHandle;
  ttlSeconds: number;
}

/** In-process single-flight table: one MongoDB load per key per process at a time. */
const inFlight = new Map<string, Promise<unknown>>();

function byteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

export async function readThrough<T>(input: {
  redis: RedisHandle;
  key: string;
  ttlSeconds: number;
  load: () => Promise<T>;
  serialize?: (value: T) => string;
  parse?: (raw: string) => T;
}): Promise<CacheRead<T>> {
  const serialize = input.serialize ?? JSON.stringify;
  const parse = input.parse ?? JSON.parse;
  const client = input.redis.usable();
  if (!client) {
    return { value: await input.load(), fromCache: false };
  }
  try {
    const raw = await client.get(input.key);
    if (raw !== null) {
      input.redis.counters.hits += 1;
      return { value: parse(raw), fromCache: true };
    }
  } catch {
    input.redis.counters.errors += 1;
    return { value: await input.load(), fromCache: false };
  }
  input.redis.counters.misses += 1;

  // Single-flight: concurrent readers in this process share the one MongoDB load.
  const existing = inFlight.get(input.key);
  if (existing) {
    return { value: (await existing) as T, fromCache: false };
  }
  const loading = input.load();
  inFlight.set(input.key, loading);
  try {
    const value = await loading;
    // Only the advisory-lock holder populates, so a fleet restart loads MongoDB once per key
    // instead of once per process. Losers already have their value; they just skip the write.
    const lockKey = input.redis.key("lock", `populate:${input.key}`);
    const lock = await acquireAdvisoryLock(input.redis, lockKey, 5000);
    if (lock.acquired) {
      try {
        const serialized = serialize(value);
        if (byteLength(serialized) <= MAX_CACHE_VALUE_BYTES) {
          await client.set(input.key, serialized, "EX", input.ttlSeconds);
        }
      } catch {
        input.redis.counters.errors += 1;
      } finally {
        await releaseAdvisoryLock(input.redis, lockKey, lock.token);
      }
    }
    return { value, fromCache: false };
  } catch (error) {
    throw error;
  } finally {
    inFlight.delete(input.key);
  }
}

/** Best-effort invalidation after a MongoDB write. Failures are counted, never thrown. */
export async function invalidate(redis: RedisHandle, ...keys: string[]): Promise<void> {
  const client = redis.usable();
  if (!client || keys.length === 0) return;
  try {
    await client.del(...keys);
  } catch {
    redis.counters.errors += 1;
  }
}

/** Test/shutdown hook: drops the in-process single-flight table. */
export function clearInFlight(): void {
  inFlight.clear();
}

/**
 * Canonical cache keys. Built ONLY here: services name the domain object, never the key syntax.
 * Owner ids are server-issued uuids (safe alphabet); anything else must be hashed by the caller.
 */
export function miningSettingsKey(redis: RedisHandle): string {
  return redis.key("cache", "mining-settings:v1");
}

export function poolMembershipKey(redis: RedisHandle, ownerUserId: string): string {
  return redis.key("cache", `pool-membership:${ownerUserId}`);
}

export function displayNameKey(redis: RedisHandle, ownerUserId: string): string {
  return redis.key("cache", `display-name:${ownerUserId}`);
}