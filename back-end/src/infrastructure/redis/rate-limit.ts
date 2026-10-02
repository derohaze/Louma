import type { RedisHandle } from "./client.js";

/**
 * Distributed fixed-window rate limiting over Redis (see docs/redis.md).
 *
 * One atomic Lua script per check (INCR + conditional EXPIRE + PTTL read), keyed per scope and
 * identity: `louma:ratelimit:<scope>:<id>`. Fail-open by design — see the per-endpoint table in
 * docs/redis.md for why: when Redis is unavailable, throttling degrades to a best-effort
 * in-process limiter rather than turning a cache outage into a denial of legitimate financial
 * traffic. The secrets themselves (passwords, TOTP, transfer credentials) are still verified by
 * MongoDB-backed checks on every attempt; this limiter only bounds attempt *rates*.
 */

export interface RateLimitDecision {
  allowed: boolean;
  /** Remaining attempts in the current window (0 when refused). */
  remaining: number;
  /** Milliseconds until the window resets (0 when allowed and Redis answered). */
  retryAfterMs: number;
  /** True when Redis did not answer and the local fallback decided. */
  degraded: boolean;
}

const CHECK_SCRIPT = `
local current = redis.call("incr", KEYS[1])
if current == 1 then
  redis.call("pexpire", KEYS[1], ARGV[1])
end
return { current, redis.call("pttl", KEYS[1]) }`;

/** Best-effort in-process fallback: per-key window counts, pruned on read. Never grows unbounded. */
const localWindows = new Map<string, { count: number; resetAt: number }>();
const LOCAL_WINDOW_CAP = 4096;

function checkLocal(key: string, limit: number, windowMs: number): RateLimitDecision {
  const now = Date.now();
  if (localWindows.size > LOCAL_WINDOW_CAP) {
    for (const [stored, entry] of localWindows) {
      if (entry.resetAt <= now) localWindows.delete(stored);
      if (localWindows.size <= LOCAL_WINDOW_CAP / 2) break;
    }
  }
  const entry = localWindows.get(key);
  if (!entry || entry.resetAt <= now) {
    localWindows.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: limit - 1, retryAfterMs: 0, degraded: true };
  }
  entry.count += 1;
  if (entry.count > limit) {
    return { allowed: false, remaining: 0, retryAfterMs: Math.max(0, entry.resetAt - now), degraded: true };
  }
  return { allowed: true, remaining: limit - entry.count, retryAfterMs: 0, degraded: true };
}

export async function checkRateLimit(
  redis: RedisHandle,
  scope: string,
  identity: string,
  limit: number,
  windowMs: number,
): Promise<RateLimitDecision> {
  const key = redis.key("ratelimit", `${scope}:${identity}`);
  const client = redis.usable();
  if (!client) return checkLocal(key, limit, windowMs);
  try {
    const [current, ttl] = (await client.eval(CHECK_SCRIPT, 1, key, String(windowMs))) as [number, number];
    if (current > limit) {
      return { allowed: false, remaining: 0, retryAfterMs: Math.max(0, ttl), degraded: false };
    }
    return { allowed: true, remaining: limit - current, retryAfterMs: 0, degraded: false };
  } catch {
    redis.counters.errors += 1;
    return checkLocal(key, limit, windowMs);
  }
}

/** Test hook: drops the in-process fallback table. */
export function clearLocalRateLimits(): void {
  localWindows.clear();
}