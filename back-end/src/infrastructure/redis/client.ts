import { Redis } from "ioredis";
import type { RedisConfig } from "../../config/env.js";

/**
 * Redis connection handle: the only place an ioredis client is constructed.
 *
 * Redis is ephemeral infrastructure (see ADR-002 and docs/redis.md): it may accelerate reads,
 * throttle abuse, and coordinate non-critical work, but it is NEVER the authority for money,
 * identity, or authorization. Every consumer of this handle therefore treats an outage as a
 * degraded mode, not an error:
 *
 * - when `REDIS_URL` is unset the handle is disabled and every operation is a local no-op;
 * - when Redis is unreachable, commands fail fast (no offline queue, bounded retries, per-command
 *   timeout) and callers fall back to MongoDB or to in-process state;
 * - a Redis failure degrades performance, never correctness.
 *
 * Business logic must not import ioredis or hold this client: it goes through `cache.ts`
 * (cache-aside reads), `rate-limit.ts` (throttles), and `locks.ts` (advisory coordination), which
 * own the key namespaces and the fallback behavior.
 */

export type RedisStatus = "disabled" | "connecting" | "ready" | "degraded";

export interface RedisCounters {
  commands: number;
  errors: number;
  hits: number;
  misses: number;
  reconnects: number;
}

export type RedisEvent =
  | { kind: "connected" }
  | { kind: "reconnecting"; attempt: number; delayMs: number }
  | { kind: "error"; message: string }
  | { kind: "closed" };

const MAX_KEY_LENGTH = 256;

/** A command that outlives this budget is answered as a Redis miss, never awaited further. */
export function commandTimeoutMs(config: Pick<RedisConfig, "commandTimeoutMs">): number {
  return config.commandTimeoutMs;
}

/**
 * A handle with Redis disabled: every operation is a local no-op and every read falls back to
 * MongoDB. Tests that need the MongoDB-only path (correctness without Redis) use this instead
 * of a live server; no Redis process is required.
 */
export function disabledRedis(keyPrefix = "louma-test"): RedisHandle {
  return new RedisHandle({
    url: null,
    keyPrefix,
    connectTimeoutMs: 200,
    commandTimeoutMs: 200,
    miningSettingsCacheTtlSeconds: 30,
    poolMembershipCacheTtlSeconds: 60,
    displayNameCacheTtlSeconds: 300,
    transferPreviewMaxPerMinute: 30,
    miningStartMaxPerMinute: 10,
    loginMaxPerMinute: 10,
  });
}

export class RedisHandle {
  readonly enabled: boolean;
  readonly keyPrefix: string;
  readonly counters: RedisCounters = { commands: 0, errors: 0, hits: 0, misses: 0, reconnects: 0 };
  private client: Redis | null = null;
  private status: RedisStatus;
  private readonly config: RedisConfig;
  private readonly onEvent: (event: RedisEvent) => void;

  constructor(config: RedisConfig, onEvent: (event: RedisEvent) => void = () => undefined) {
    this.config = config;
    this.onEvent = onEvent;
    this.enabled = config.url !== null;
    this.status = this.enabled ? "connecting" : "disabled";
    this.keyPrefix = config.keyPrefix;
  }

  /**
   * Opens the connection. Resolves once the client is constructed — NOT once Redis answers —
   * so a dead Redis never blocks process startup; readiness is reported through `describe()`
   * and the `/ready` endpoint instead. Safe to call when disabled (no-op).
   */
  async connect(): Promise<void> {
    if (!this.enabled || this.client) return;
    const client = new Redis(this.config.url as string, {
      lazyConnect: true,
      connectTimeout: this.config.connectTimeoutMs,
      commandTimeout: this.config.commandTimeoutMs,
      // Fail fast, never queue: a command issued while disconnected rejects immediately so the
      // caller falls back to MongoDB instead of hanging the request behind a growing buffer.
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      retryStrategy: (times: number) => {
        const delayMs = Math.min(50 * 2 ** Math.min(times, 8), 5000);
        this.counters.reconnects += 1;
        this.status = "degraded";
        this.onEvent({ kind: "reconnecting", attempt: times, delayMs });
        return delayMs;
      },
    });
    client.on("ready", () => {
      this.status = "ready";
      this.onEvent({ kind: "connected" });
    });
    client.on("error", (error: unknown) => {
      this.counters.errors += 1;
      if (this.status === "ready") this.status = "degraded";
      this.onEvent({ kind: "error", message: error instanceof Error ? error.message : String(error) });
    });
    client.on("close", () => {
      if (this.status === "ready") this.status = "degraded";
    });
    this.client = client;
    // A refused initial connection must not reject startup: Redis is optional infrastructure.
    try {
      await client.connect();
    } catch {
      this.counters.errors += 1;
      this.status = "degraded";
    }
  }

  /** Namespaced key builder. Rejects control characters and overlong keys at construction. */
  key(namespace: "cache" | "ratelimit" | "lock", ...parts: string[]): string {
    const body = parts.join(":");
    if (body.length === 0 || /[\s\x00-\x1f\x7f]/.test(body)) {
      throw new Error("Redis key parts must be non-empty printable strings");
    }
    const full = `${this.keyPrefix}:${namespace}:${body}`;
    if (full.length > MAX_KEY_LENGTH) throw new Error("Redis key exceeds the length budget");
    return full;
  }

  /** The raw client, or null when Redis is disabled or currently unusable. Never throws. */
  usable(): Redis | null {
    if (!this.enabled || !this.client) return null;
    if (this.client.status !== "ready") return null;
    return this.client;
  }

  /** Dependency health for `/ready`: MongoDB gates traffic, Redis is reported, never gating. */
  async describe(): Promise<{ status: RedisStatus; latencyMs: number | null }> {
    if (!this.enabled) return { status: "disabled", latencyMs: null };
    const client = this.client;
    if (!client || client.status !== "ready") return { status: this.status, latencyMs: null };
    const started = Date.now();
    try {
      await client.ping();
      return { status: "ready", latencyMs: Date.now() - started };
    } catch {
      this.counters.errors += 1;
      return { status: "degraded", latencyMs: null };
    }
  }

  async close(): Promise<void> {
    const client = this.client;
    this.client = null;
    if (client) {
      this.status = this.enabled ? "degraded" : "disabled";
      try {
        await client.quit();
      } catch {
        client.disconnect();
      }
      this.onEvent({ kind: "closed" });
    }
  }
}