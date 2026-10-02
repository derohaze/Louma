import { randomUUID } from "node:crypto";
import type { RedisHandle } from "./client.js";

/**
 * Advisory distributed locks: operational convenience, never a correctness gate.
 *
 * Used for cache-refresh single-flight across processes and for singleton maintenance work
 * (e.g. only one process trimming a pool). The rule from ADR-002 applies without exception:
 * "Redis lock acquired" must NEVER be the sole proof that a transfer, a mining issuance, or an
 * authorization consumption is allowed — MongoDB uniqueness and conditional updates remain the
 * authority, and a lock that fails (or Redis itself) only causes duplicate non-critical work.
 */

export interface AdvisoryLock {
  acquired: boolean;
  token: string;
}

const RELEASE_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end`;

/** Non-blocking acquire: one round trip, no waiting. Returns `acquired: false` when Redis is down. */
export async function acquireAdvisoryLock(redis: RedisHandle, key: string, ttlMs: number): Promise<AdvisoryLock> {
  const token = randomUUID();
  const client = redis.usable();
  if (!client) return { acquired: false, token };
  try {
    const result = await client.set(key, token, "PX", Math.max(1, Math.floor(ttlMs)), "NX");
    return { acquired: result === "OK", token };
  } catch {
    redis.counters.errors += 1;
    return { acquired: false, token };
  }
}

/** Releases only the lock this holder owns (token compare-and-delete). Never throws. */
export async function releaseAdvisoryLock(redis: RedisHandle, key: string, token: string): Promise<void> {
  const client = redis.usable();
  if (!client) return;
  try {
    await client.eval(RELEASE_SCRIPT, 1, key, token);
  } catch {
    redis.counters.errors += 1;
  }
}

/**
 * Runs `fn` under a best-effort lock. When the lock cannot be acquired — contention or Redis
 * down — the result reports `ran: false` and `fn` is NOT executed; the caller falls back to the
 * uncoordinated path (usually: do the small duplicate work directly).
 */
export async function withAdvisoryLock<T>(
  redis: RedisHandle,
  key: string,
  ttlMs: number,
  fn: () => Promise<T>,
): Promise<{ ran: boolean; result?: T }> {
  const lock = await acquireAdvisoryLock(redis, key, ttlMs);
  if (!lock.acquired) return { ran: false };
  try {
    return { ran: true, result: await fn() };
  } finally {
    await releaseAdvisoryLock(redis, key, lock.token);
  }
}