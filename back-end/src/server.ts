import { buildApp } from "./app.js";
import { loadConfig } from "./config/env.js";
import { connectMongo } from "./infrastructure/mongodb/client.js";
import { ensureDatabaseIndexes } from "./infrastructure/mongodb/indexes.js";
import { getCollections } from "./infrastructure/mongodb/collections.js";
import { RedisHandle } from "./infrastructure/redis/client.js";

import { sweepSubscriptions } from "./modules/subscriptions/service.js";
import { GatewayStore } from "../payment-gateway/infrastructure/store.js";
import { migrate, compatible } from "../payment-gateway/infrastructure/migrations.js";
import { startWorker } from "../payment-gateway/worker.js";

const config = loadConfig();
const { client, db } = await connectMongo(config);
// Redis connect does not reject; readiness and gateway rate limits fail closed when configured
// Redis is unavailable. Close it after requests and workers drain, then close MongoDB.
const redis = new RedisHandle(config.redis);
await redis.connect();

try {
  await ensureDatabaseIndexes(db, { retentionTtlEnabled: config.retentionTtlEnabled, observationTtlSeconds: config.lmdg.observationTtlSeconds });
  if (config.embeddedGateway) {
    const gateway = new GatewayStore(client, db, config.embeddedGateway);
    await migrate(gateway);
    await compatible(gateway);
  }
  const walletsNeedingAddressMigration = await db.collection("wallets").countDocuments({ addressVersion: 0 });
  if (walletsNeedingAddressMigration > 0) {
    throw new Error(
      `Refusing to serve while ${walletsNeedingAddressMigration} wallet addresses are still legacy. ` +
        "Run the built `migrate-wallet-addresses` script with --execute, --confirm-database=<database>, and --backup-confirmed against the intended database, then restart.",
    );
  }
  const app = await buildApp({ config, collections: getCollections(db), mongoClient: client, redis });
  if (app.gateway) app.addHook("onClose", startWorker(app.gateway, app.log));
  let afterAddress: string | null = null;
  let sweep: Promise<void> | null = null;
  const timer = setInterval(() => {
    if (sweep) return;
    sweep = sweepSubscriptions({ collections: app.collections, mongoClient: client, afterAddress })
      .then((cursor) => { afterAddress = cursor; })
      .catch((error: unknown) => { app.log.error({ err: error, afterAddress }, "subscription_sweep_failed"); })
      .finally(() => { sweep = null; });
  }, 60_000);
  timer.unref();
  app.addHook("onClose", async () => { clearInterval(timer); await sweep; });
  redis.describe().then((state) => {
    app.log.info({ redis: state.status }, "redis_state_at_boot");
  }).catch(() => undefined);
  const close = async (signal: string) => {
    app.log.info({ signal }, "server_shutdown_started");
    await app.close();
    await redis.close();
    await client.close();
  };

  process.once("SIGINT", () => void close("SIGINT").then(() => process.exit(0)));
  process.once("SIGTERM", () => void close("SIGTERM").then(() => process.exit(0)));

  if (!config.ipinfoToken) {
    // Degrading quietly would hide that signups are being recorded without a location.
    app.log.warn(
      { variable: "IPINFO_TOKEN" },
      "signup_geolocation_disabled: connecting IPs are still stored, city/country/org stay null",
    );
  }

  await app.listen({ host: config.host, port: config.port });
} catch (error) {
  await redis.close();
  await client.close();
  throw error;
}
