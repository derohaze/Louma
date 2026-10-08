import { MongoClient, type MongoClientOptions } from "mongodb";
import type { AppConfig } from "../../config/env.js";

/**
 * Everything `connectMongo` actually needs. It is a slice of `AppConfig` rather than the whole
 * interface so database-only tooling (the ledger reconciler) can connect without holding the
 * application's secrets — tokens and keys are not required to read the ledger.
 */
export type MongoConnectionConfig = Pick<
  AppConfig,
  "mongoUri" | "mongoDatabase" | "mongoConnectTimeoutMs" | "mongoServerSelectionTimeoutMs" | "mongoMaxPoolSize"
>;

/**
 * Timeouts come from `MONGODB_CONNECT_TIMEOUT_MS` / `MONGODB_SERVER_SELECTION_TIMEOUT_MS`
 * (defaults: 5s fail-fast). `overrides` exists for the live integration test, which runs
 * over a slow or flaky link and needs a longer server-selection window. Nothing else
 * should need it.
 */
export async function connectMongo(config: MongoConnectionConfig, overrides: MongoClientOptions = {}) {
  const client = new MongoClient(config.mongoUri, {
    appName: "louma-customer-backend",
    maxPoolSize: config.mongoMaxPoolSize,
    minPoolSize: 0,
    serverSelectionTimeoutMS: config.mongoServerSelectionTimeoutMs,
    connectTimeoutMS: config.mongoConnectTimeoutMs,
    retryWrites: true,
    ...overrides,
  });

  try {
    await client.connect();
    const db = client.db(config.mongoDatabase);
    await db.command({ ping: 1 });
    return { client, db };
  } catch (error) {
    await client.close();
    throw error;
  }
}
