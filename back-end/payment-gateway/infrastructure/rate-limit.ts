import type { RedisHandle } from "../../src/infrastructure/redis/client.js";
const WINDOW_MS = 60000;
const MAX_BUCKETS = 4096;
const SCRIPT =
  "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('PEXPIRE',KEYS[1],60000) end; return n";
/** Only public IPs/application IDs belong here. Never pass keys, credentials or hashes. */
export class GatewayLimiter {
  private readonly buckets = new Map<
    string,
    {
      count: number;
      expires: number;
    }
  >();
  constructor(
    private readonly redis: RedisHandle,
    private readonly environment: "test" | "live",
  ) {}
  async allow(identity: string, max: number): Promise<boolean> {
    const client = this.redis.usable();
    if (this.redis.enabled) {
      if (!client) return false;
      try {
        const count = await client.eval(
          SCRIPT,
          1,
          this.redis.key("ratelimit", "gateway", this.environment, identity),
        );
        return typeof count === "number" && count <= max;
      } catch {
        this.redis.counters.errors += 1;
        return false;
      }
    }
    if (this.environment === "live") return false;
    const now = Date.now();
    const prior = this.buckets.get(identity);
    const bucket =
      prior && prior.expires > now
        ? prior
        : { count: 0, expires: now + WINDOW_MS };
    if (!prior && this.buckets.size >= MAX_BUCKETS) {
      for (const [key, value] of this.buckets)
        if (value.expires <= now) this.buckets.delete(key);
      if (this.buckets.size >= MAX_BUCKETS) return false;
    }
    bucket.count += 1;
    this.buckets.set(identity, bucket);
    return bucket.count <= max;
  }
  async ready(): Promise<boolean> {
    if (!this.redis.enabled) return this.environment === "test";
    return (await this.redis.describe()).status === "ready";
  }
}
