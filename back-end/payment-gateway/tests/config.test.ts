import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { loadGatewayConfig } from "../config.js";
import { GatewayLimiter } from "../infrastructure/rate-limit.js";
import {
  disabledRedis,
  RedisHandle,
} from "../../src/infrastructure/redis/client.js";
function environment(): NodeJS.ProcessEnv {
  return {
    GATEWAY_ENABLED: "true",
    GATEWAY_ENVIRONMENT: "test",
    MONGODB_DATABASE: "louma_gateway_test_config",
    GATEWAY_SERVICE_KEY: randomBytes(32).toString("hex"),
    GATEWAY_API_KEY_PEPPER: randomBytes(32).toString("hex"),
    GATEWAY_ENCRYPTION_KEY: randomBytes(32).toString("hex"),
  };
}
test("gateway is optional and rejects mixed environments and malformed configuration", () => {
  assert.equal(loadGatewayConfig({}), null);
  const env = environment();
  assert.equal(loadGatewayConfig(env)?.publicUrl, "http://localhost:8000");
  for (const changes of [
    { MONGODB_DATABASE: "" },
    { NODE_ENV: "production" },
    { GATEWAY_ENVIRONMENT: "sandbox" },
    { GATEWAY_PUBLIC_URL: "http://example.com" },
    { GATEWAY_PUBLIC_URL: "https://checkout.loumapay.com/path" },
    { GATEWAY_PUBLIC_URL: "https://name:secret@example.com" },
    { GATEWAY_API_KEY_PEPPER: env["GATEWAY_SERVICE_KEY"] },
    { GATEWAY_ENCRYPTION_KEY: "aa" },
    { GATEWAY_FEE_BASIS_POINTS: "10000" },
    { GATEWAY_RATE_LIMIT: "0" },
    { GATEWAY_SETTLEMENT_PAUSED: "yes" },
  ])
    assert.throws(() => loadGatewayConfig({ ...env, ...changes }));
});
test("live mode starts with all financial effects gated until explicit enablement", () => {
  const env = {
    ...environment(),
    NODE_ENV: "production",
    GATEWAY_ENVIRONMENT: "live",
    MONGODB_DATABASE: "louma",
    REDIS_URL: "redis://127.0.0.1:6379",
    GATEWAY_PUBLIC_URL: "https://checkout.loumapay.com",
    GATEWAY_DASHBOARD_URL: "https://app.loumapay.com",
  };
  const disabled = loadGatewayConfig(env)!;
  assert.equal(disabled.liveEnabled, false);
  assert.equal(
    disabled.creationPaused &&
      disabled.settlementPaused &&
      disabled.billingPaused,
    true,
  );
  assert.equal(
    loadGatewayConfig({ ...env, GATEWAY_LIVE_ENABLED: "true" })
      ?.settlementPaused,
    false,
  );
  assert.equal(
    loadGatewayConfig({
      ...env,
      GATEWAY_LIVE_ENABLED: "true",
      GATEWAY_SETTLEMENT_PAUSED: "true",
    })?.settlementPaused,
    true,
  );
  assert.throws(() => loadGatewayConfig({ ...env, REDIS_URL: "" }));
});
test("sandbox local limiter enforces capacity and live mode fails closed without Redis", async () => {
  const redis = disabledRedis();
  const limiter = new GatewayLimiter(redis, "test");
  assert.equal(await limiter.allow("application:one", 2), true);
  assert.equal(await limiter.allow("application:one", 2), true);
  assert.equal(await limiter.allow("application:one", 2), false);
  assert.equal(await limiter.allow("application:two", 2), true);
  assert.equal(await limiter.ready(), true);
  const live = new GatewayLimiter(redis, "live");
  assert.equal(await live.allow("application:one", 2), false);
  assert.equal(await live.ready(), false);
});
test("configured but disconnected Redis fails closed in every mode", async () => {
  const redis = new RedisHandle({
    url: "redis://127.0.0.1:6379",
    keyPrefix: "gateway-unit",
    connectTimeoutMs: 100,
    commandTimeoutMs: 100,
    miningSettingsCacheTtlSeconds: 30,
    poolMembershipCacheTtlSeconds: 60,
    displayNameCacheTtlSeconds: 300,
    transferPreviewMaxPerMinute: 30,
    miningStartMaxPerMinute: 10,
    loginMaxPerMinute: 10,
  });
  const limiter = new GatewayLimiter(redis, "test");
  assert.equal(await limiter.allow("application:one", 10), false);
  assert.equal(await limiter.ready(), false);
});
