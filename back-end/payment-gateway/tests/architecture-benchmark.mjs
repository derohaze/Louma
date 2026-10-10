import { randomBytes, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { MongoClient } from "mongodb";
import { RedisHandle } from "../../src/infrastructure/redis/client.ts";
import { GatewayLimiter } from "../infrastructure/rate-limit.ts";

const uri = process.env.GATEWAY_TEST_MONGODB_URI;
const redisUrl = process.env.GATEWAY_TEST_REDIS_URL;
if (
  !/^mongodb:\/\/(?:127\.0\.0\.1|localhost|\[::1\]):\d+\/(?:\?[^#]*)?$/.test(
    uri ?? "",
  )
)
  throw new Error("Explicit loopback replica-set URI required");
if (
  !redisUrl ||
  !["127.0.0.1", "localhost", "[::1]"].includes(new URL(redisUrl).hostname)
)
  throw new Error("Explicit loopback Redis URL required");
const database = `louma_gateway_test_${randomUUID()}`;
const client = new MongoClient(uri);
const redisConfig = {
  url: redisUrl,
  keyPrefix: `gw_bench_${randomUUID().replaceAll("-", "").slice(0, 20)}`,
  connectTimeoutMs: 1000,
  commandTimeoutMs: 1000,
  miningSettingsCacheTtlSeconds: 30,
  poolMembershipCacheTtlSeconds: 60,
  displayNameCacheTtlSeconds: 300,
  transferPreviewMaxPerMinute: 30,
  miningStartMaxPerMinute: 10,
  loginMaxPerMinute: 10,
};
const first = new RedisHandle(redisConfig),
  second = new RedisHandle(redisConfig);
try {
  await client.connect();
  await promisify(execFile)(
    process.execPath,
    [
      "--import",
      "tsx",
      fileURLToPath(new URL("./setup-financial.mjs", import.meta.url)),
      "setup",
      uri,
      database,
    ],
    { windowsHide: true },
  );
  await first.connect();
  await second.connect();
  const a = new GatewayLimiter(first, "test"),
    b = new GatewayLimiter(second, "test");
  if (
    !(await a.ready()) ||
    !(await a.allow("application:fixture", 2)) ||
    !(await b.allow("application:fixture", 2)) ||
    (await a.allow("application:fixture", 2))
  )
    throw new Error("Redis shared limit verification failed");
  if (
    !(await new GatewayLimiter(second, "live").allow("application:fixture", 2))
  )
    throw new Error("Redis environment namespaces overlap");
  console.log(
    "Local Redis: PONG, shared counters and environment separation verified",
  );
  const result = await promisify(execFile)(
    process.execPath,
    [
      "--import",
      "tsx",
      fileURLToPath(
        new URL("../../src/tests/architecture-benchmark.ts", import.meta.url),
      ),
    ],
    {
      windowsHide: true,
      env: {
        ...process.env,
        NODE_ENV: "test",
        MONGODB_URI: uri,
        MONGODB_DATABASE: database,
        ACCESS_TOKEN_SECRET: randomBytes(32).toString("base64"),
        APP_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
        REDIS_URL: redisUrl,
        REDIS_KEY_PREFIX: redisConfig.keyPrefix,
        GATEWAY_ENABLED: "false",
      },
    },
  );
  process.stdout.write(result.stdout);
} finally {
  await first.close();
  await second.close();
  await client.db(database).dropDatabase();
  await client.close();
}
