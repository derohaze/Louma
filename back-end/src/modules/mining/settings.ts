import type { ObjectId } from "mongodb";
import type { AppConfig, MiningConfig, MiningPoolsConfig, MiningPoolSpec } from "../../config/env.js";
import type { Collections } from "../../infrastructure/mongodb/collections.js";
import type { RedisHandle } from "../../infrastructure/redis/client.js";
import { invalidate, miningSettingsKey, readThrough, type CacheContext } from "../../infrastructure/redis/cache.js";
import { LEDGER_AMOUNT_MAX_MINOR, MONEY_SCALE } from "../../shared/types.js";

/**
 * Live mining configuration, read from the `mining_settings` collection.
 *
 * Every tunable of the mining system lives here as one document per key — the
 * pool rooms, the rate band, and the on/off switches — instead of in the
 * environment. The environment only provides the boot defaults: any key present
 * in the collection overrides it, a missing key falls back to the env default,
 * and an invalid stored value is ignored (with a loud warning) rather than
 * bricking mining.
 *
 * Reads are intentionally uncached: one extra indexed find per mining call, and
 * an operator change takes effect on the very next request — no restart, no
 * stale-cache window to reason about. Use `src/scripts/mining-settings.ts` to
 * read and write keys; there is deliberately no customer endpoint for this.
 */

export interface MiningSettingRecord {
  _id: ObjectId;
  key: string;
  value: unknown;
  updatedAt: Date;
  updatedBy: string;
}

/** Every key this module understands. Unknown stored keys are ignored (forward-compatible). */
export const MINING_SETTING_KEYS = [
  "mining.enabled",
  "mining.settlementEnabled",
  "mining.rate",
  "mining.pools.low",
  "mining.pools.medium",
] as const;

export type MiningSettingKey = (typeof MINING_SETTING_KEYS)[number];

export function isMiningSettingKey(key: string): key is MiningSettingKey {
  return (MINING_SETTING_KEYS as readonly string[]).includes(key);
}

export interface ResolvedMiningConfig {
  mining: MiningConfig;
  miningPools: MiningPoolsConfig;
}

export interface SettingsResolution {
  config: ResolvedMiningConfig;
  /** Keys that were stored but unusable, so the env default stayed live. */
  warnings: string[];
}

function isSafePositiveInt(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1;
}

function rateError(value: unknown): string | null {
  if (typeof value !== "object" || value === null) return "must be an object";
  const rate = value as Record<string, unknown>;
  const { minUnits, maxUnits, scale, decimals } = rate;
  if (!isSafePositiveInt(minUnits) || !isSafePositiveInt(maxUnits) || !isSafePositiveInt(scale)) {
    return "minUnits, maxUnits and scale must be positive integers";
  }
  if (typeof decimals !== "number" || !Number.isSafeInteger(decimals) || decimals < 0 || decimals > 8) {
    return "decimals must be an integer 0..8";
  }
  if (scale !== 10 ** (decimals as number)) return "scale must equal 10 ** decimals";
  if ((minUnits as number) > (maxUnits as number)) return "minUnits must not exceed maxUnits";
  // Same bound the env parser enforces: the 24-hour total of the top rate must post as one movement.
  const maxTotal = (BigInt(maxUnits as number) * BigInt(MONEY_SCALE) * BigInt(24 * 60 * 60)) / (BigInt(scale as number) * 3600n);
  if (maxTotal < 1n || maxTotal > BigInt(LEDGER_AMOUNT_MAX_MINOR)) {
    return "the 24-hour total of maxUnits must fit in one ledger movement";
  }
  return null;
}

function poolSpecError(value: unknown): string | null {
  if (typeof value !== "object" || value === null) return "must be an object";
  const spec = value as Record<string, unknown>;
  if (!isSafePositiveInt(spec["baseHashrate"])) return "baseHashrate must be a positive integer";
  const min = spec["rewardMinBps"];
  const max = spec["rewardMaxBps"];
  if (!isSafePositiveInt(min) || !isSafePositiveInt(max)) return "rewardMinBps and rewardMaxBps must be positive integers";
  if ((min as number) > 50_000 || (max as number) > 50_000) return "reward bands are capped at 50000 (5.0x)";
  if ((min as number) > (max as number)) return "rewardMinBps must not exceed rewardMaxBps";
  // Pool choice changes variance, not average issuance: the band must straddle 1.0x and average
  // 1.0x, so e.g. rewardMinBps=rewardMaxBps=50000 (a 5x payout multiplier) is rejected.
  if ((min as number) > 10_000 || (max as number) < 10_000) return "reward band must include 10000 (1.0x)";
  if ((min as number) + (max as number) !== 20_000) return "reward band must average 10000 (1.0x)";
  if (!isSafePositiveInt(spec["maxMembers"])) return "maxMembers must be a positive integer";
  return null;
}

/**
 * Merges stored documents over env-derived defaults. Pure: no clock, no database,
 * no state — every branch is unit-testable without MongoDB.
 */
export function resolveMiningSettingsFromDocs(
  docs: { key: string; value: unknown }[],
  defaults: ResolvedMiningConfig,
): SettingsResolution {
  const warnings: string[] = [];
  const mining: MiningConfig = { ...defaults.mining, rate: { ...defaults.mining.rate } };
  // Spread first: the hold/cooldown policy is env-only and every stored pool override must keep it.
  const pools: MiningPoolsConfig = {
    ...defaults.miningPools,
    low: { ...defaults.miningPools.low },
    medium: { ...defaults.miningPools.medium },
  };
  for (const doc of docs) {
    if (!isMiningSettingKey(doc.key)) continue;
    switch (doc.key) {
      case "mining.enabled":
      case "mining.settlementEnabled": {
        if (typeof doc.value !== "boolean") {
          warnings.push(`${doc.key}: expected a boolean, keeping default`);
          break;
        }
        mining[doc.key === "mining.enabled" ? "enabled" : "settlementEnabled"] = doc.value;
        break;
      }
      case "mining.rate": {
        const problem = rateError(doc.value);
        if (problem) {
          warnings.push(`mining.rate: ${problem}, keeping default`);
          break;
        }
        const rate = doc.value as { minUnits: number; maxUnits: number; scale: number; decimals: number };
        mining.rate = { ...rate };
        break;
      }
      case "mining.pools.low":
      case "mining.pools.medium": {
        const problem = poolSpecError(doc.value);
        if (problem) {
          warnings.push(`${doc.key}: ${problem}, keeping default`);
          break;
        }
        const spec = doc.value as MiningPoolSpec;
        pools[doc.key === "mining.pools.low" ? "low" : "medium"] = { ...spec };
        break;
      }
    }
  }
  return { config: { mining, miningPools: pools }, warnings };
}

type EnvDefaults = Pick<AppConfig, "mining" | "miningPools">;

/**
 * Reads the live mining configuration: stored keys win, missing keys use env defaults.
 *
 * Hot path (every transfer settles mining first): with `cache` the settings documents go through
 * cache-aside — one MongoDB read per TTL window per process instead of one per call. The cached
 * value is the raw documents, so `resolveMiningSettingsFromDocs` still validates every read and a
 * bad row can never be cemented by the cache. Writes (`setMiningSetting`/`resetMiningSetting`)
 * invalidate eagerly; the TTL only bounds a lost-invalidation race. Without `cache` the behavior
 * is exactly the historical one: one indexed read per call, effective immediately.
 */
export async function loadMiningSettings(
  collections: Collections,
  defaults: EnvDefaults,
  cache?: CacheContext | undefined,
): Promise<ResolvedMiningConfig> {
  let docs: { key: string; value: unknown }[];
  try {
    if (!cache) {
      docs = await collections.miningSettings.find({}).toArray();
    } else {
      const read = await readThrough({
        redis: cache.redis,
        key: miningSettingsKey(cache.redis),
        ttlSeconds: cache.ttlSeconds,
        load: () => collections.miningSettings.find({}).toArray(),
      });
      docs = Array.isArray(read.value) ? read.value : [];
    }
  } catch {
    // A failed read must not substitute the enabling env defaults over a stored pause:
    // with the store unreadable the safe answer is mining off until the next successful read.
    console.warn("[mining-settings] read failed; mining and settlement disabled until readable");
    return { mining: { ...defaults.mining, enabled: false, settlementEnabled: false }, miningPools: defaults.miningPools };
  }
  const { config, warnings } = resolveMiningSettingsFromDocs(docs, defaults);
  for (const warning of warnings) console.warn(`[mining-settings] ${warning}`);
  return config;
}

/**
 * Stores one setting key. Validation fails the write immediately, so a bad value
 * can never sit in the collection waiting to be silently ignored at read time.
 */
export async function setMiningSetting(input: {
  collections: Collections;
  key: string;
  value: unknown;
  updatedBy: string;
  /** When present, the settings cache entry is invalidated after the write lands. */
  redis?: RedisHandle;
}): Promise<MiningSettingRecord> {
  if (!isMiningSettingKey(input.key)) {
    throw new Error(`Unknown mining setting: ${input.key}. Known keys: ${MINING_SETTING_KEYS.join(", ")}`);
  }
  let problem: string | null = null;
  if (input.key === "mining.enabled" || input.key === "mining.settlementEnabled") {
    if (typeof input.value !== "boolean") problem = "expected a boolean";
  } else if (input.key === "mining.rate") {
    problem = rateError(input.value);
  } else {
    problem = poolSpecError(input.value);
  }
  if (problem) throw new Error(`Invalid value for ${input.key}: ${problem}`);
  const now = new Date();
  await input.collections.miningSettings.updateOne(
    { key: input.key },
    { $set: { value: input.value, updatedAt: now, updatedBy: input.updatedBy } },
    { upsert: true },
  );
  const stored = await input.collections.miningSettings.findOne({ key: input.key });
  if (!stored) throw new Error(`Failed to store mining setting ${input.key}`);
  // MongoDB first, cache second: a failed invalidation only leaves the previous value cached
  // until the TTL, and the next operator write retries the invalidation.
  if (input.redis) await invalidate(input.redis, miningSettingsKey(input.redis));
  return stored;
}

/** Removes an override, so the key falls back to its env default on the next read. */
export async function resetMiningSetting(input: {
  collections: Collections;
  key: string;
  /** When present, the settings cache entry is invalidated after the write lands. */
  redis?: RedisHandle;
}): Promise<boolean> {
  if (!isMiningSettingKey(input.key)) {
    throw new Error(`Unknown mining setting: ${input.key}. Known keys: ${MINING_SETTING_KEYS.join(", ")}`);
  }
  const removed = await input.collections.miningSettings.deleteOne({ key: input.key });
  if (input.redis) await invalidate(input.redis, miningSettingsKey(input.redis));
  return removed.deletedCount === 1;
}
