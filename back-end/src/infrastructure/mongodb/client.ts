import { MongoClient, type MongoClientOptions } from "mongodb";
import type { AppConfig } from "../../config/env.js";

/**
 * Timeouts come from `MONGODB_CONNECT_TIMEOUT_MS` / `MONGODB_SERVER_SELECTION_TIMEOUT_MS`
 * (defaults: 5s fail-fast). `overrides` exists for the live integration test, which runs
 * over a slow or flaky link and needs a longer server-selection window. Nothing else
 * should need it.
 */
export async function connectMongo(config: AppConfig, overrides: MongoClientOptions = {}) {
  const client = new MongoClient(config.mongoUri, {
    appName: "louma-customer-backend",
    maxPoolSize: 20,
    minPoolSize: 0,
    serverSelectionTimeoutMS: config.mongoServerSelectionTimeoutMs,
    connectTimeoutMS: config.mongoConnectTimeoutMs,
    retryWrites: true,
    ...overrides,
  });

  await client.connect();
  const db = client.db(config.mongoDatabase);
  await db.command({ ping: 1 });
  return { client, db };
}
