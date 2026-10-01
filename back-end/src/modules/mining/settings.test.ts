import { test } from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../../config/env.js";
import { resolveMiningSettingsFromDocs, isMiningSettingKey, MINING_SETTING_KEYS } from "./settings.js";

const base = {
  MONGODB_URI: "mongodb://127.0.0.1:27017/louma",
  MONGODB_DATABASE: "louma",
  ACCESS_TOKEN_SECRET: Buffer.alloc(32, 1).toString("base64"),
  APP_ENCRYPTION_KEY: Buffer.alloc(32, 2).toString("base64"),
};

function defaults() {
  const config = loadConfig({ ...base });
  return { mining: config.mining, miningPools: config.miningPools };
}

test("an empty collection keeps every env default", () => {
  const { config, warnings } = resolveMiningSettingsFromDocs([], defaults());
  assert.equal(warnings.length, 0);
  assert.equal(config.mining.enabled, true);
  assert.deepEqual(config.miningPools.low, { baseHashrate: 100, rewardMinBps: 8500, rewardMaxBps: 11500, maxMembers: 1000 });
  assert.deepEqual(config.miningPools.medium, { baseHashrate: 100, rewardMinBps: 7000, rewardMaxBps: 13000, maxMembers: 1000 });
});

test("stored keys override their defaults and unknown keys are ignored", () => {
  const { config, warnings } = resolveMiningSettingsFromDocs(
    [
      { key: "mining.enabled", value: false },
      { key: "mining.pools.medium", value: { baseHashrate: 200, rewardMinBps: 9000, rewardMaxBps: 11000, maxMembers: 50 } },
      { key: "something.from.the.future", value: 123 },
    ],
    defaults(),
  );
  assert.equal(warnings.length, 0);
  assert.equal(config.mining.enabled, false);
  assert.equal(config.mining.settlementEnabled, true, "untouched keys keep defaults");
  assert.deepEqual(config.miningPools.medium, { baseHashrate: 200, rewardMinBps: 9000, rewardMaxBps: 11000, maxMembers: 50 });
  assert.equal(config.miningPools.low.maxMembers, 1000);
});

test("an invalid stored value keeps the default and warns instead of bricking mining", () => {
  const { config, warnings } = resolveMiningSettingsFromDocs(
    [
      { key: "mining.enabled", value: "yes" },
      { key: "mining.rate", value: { minUnits: 500, maxUnits: 100, scale: 1000, decimals: 3 } },
      { key: "mining.pools.low", value: { baseHashrate: 100, rewardMinBps: 12000, rewardMaxBps: 11000, maxMembers: 10 } },
      { key: "mining.pools.medium", value: { baseHashrate: 100, rewardMinBps: 7000, rewardMaxBps: 13000, maxMembers: 0 } },
    ],
    defaults(),
  );
  assert.equal(warnings.length, 4);
  assert.equal(config.mining.enabled, true);
  assert.equal(config.mining.rate.minUnits, 10_000, "bad rate doc keeps the env band");
  assert.equal(config.miningPools.low.rewardMaxBps, 11500);
  assert.equal(config.miningPools.medium.maxMembers, 1000);
});

test("a stored rate band applies when it is valid", () => {
  const { config, warnings } = resolveMiningSettingsFromDocs(
    [{ key: "mining.rate", value: { minUnits: 1, maxUnits: 2, scale: 10_000, decimals: 4 } }],
    defaults(),
  );
  assert.equal(warnings.length, 0);
  assert.deepEqual(config.mining.rate, { minUnits: 1, maxUnits: 2, scale: 10_000, decimals: 4 });
});

test("only the five known keys are settable", () => {
  assert.deepEqual([...MINING_SETTING_KEYS], ["mining.enabled", "mining.settlementEnabled", "mining.rate", "mining.pools.low", "mining.pools.medium"]);
  assert.equal(isMiningSettingKey("mining.pools.low"), true);
  assert.equal(isMiningSettingKey("mining.pools.mega"), false);
});
