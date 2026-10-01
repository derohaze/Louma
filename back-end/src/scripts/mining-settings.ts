import { connectMongo } from "../infrastructure/mongodb/client.js";
import { getCollections } from "../infrastructure/mongodb/collections.js";
import {
  isMiningSettingKey,
  MINING_SETTING_KEYS,
  resetMiningSetting,
  setMiningSetting,
} from "../modules/mining/settings.js";

/**
 * Operational control of the mining system's live settings, for use by the operator.
 *
 *   npm run mining:settings -- --list
 *   npm run mining:settings -- --set mining.pools.medium --value '{"baseHashrate":100,"rewardMinBps":7000,"rewardMaxBps":13000,"maxMembers":50}'
 *   npm run mining:settings -- --set mining.enabled --value 'false'
 *   npm run mining:settings -- --reset mining.pools.medium
 *
 * Stored keys override the env-derived defaults on the very next mining request — no
 * restart. A missing key (or a reset one) falls back to its env default. It is a script,
 * not an endpoint: it needs database credentials on the host, and the customer API has
 * no administrative surface that could rewrite mining economics.
 *
 * Exit codes: 0 = the setting was read or written, 2 = the run itself failed.
 */

function positiveInteger(name: string, raw: string | undefined, fallback: number): number {
  const value = Number(raw ?? fallback);
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`Invalid environment variable: ${name}`);
  return value;
}

function argument(name: string): string | null {
  const index = process.argv.indexOf(name);
  if (index < 0) return null;
  return process.argv[index + 1] ?? "";
}

async function main(): Promise<void> {
  const mongoUri = process.env["MONGODB_URI"]?.trim();
  if (!mongoUri) throw new Error("Missing required environment variable: MONGODB_URI");
  if (!mongoUri.startsWith("mongodb://") && !mongoUri.startsWith("mongodb+srv://")) {
    throw new Error("MONGODB_URI must use the mongodb or mongodb+srv scheme");
  }
  const mongoDatabase = process.env["MONGODB_DATABASE"]?.trim();
  if (!mongoDatabase) throw new Error("Missing required environment variable: MONGODB_DATABASE");

  const config = {
    mongoUri,
    mongoDatabase,
    mongoConnectTimeoutMs: positiveInteger("MONGODB_CONNECT_TIMEOUT_MS", process.env["MONGODB_CONNECT_TIMEOUT_MS"], 5000),
    mongoServerSelectionTimeoutMs: positiveInteger("MONGODB_SERVER_SELECTION_TIMEOUT_MS", process.env["MONGODB_SERVER_SELECTION_TIMEOUT_MS"], 5000),
    mongoMaxPoolSize: positiveInteger("MONGODB_MAX_POOL_SIZE", process.env["MONGODB_MAX_POOL_SIZE"], 20),
  };

  const { client, db } = await connectMongo(config);
  try {
    const collections = getCollections(db);
    const updatedBy = process.env["USER"] ?? process.env["USERNAME"] ?? "unknown";

    if (process.argv.includes("--list")) {
      const docs = await collections.miningSettings.find({}).sort({ key: 1 }).toArray();
      console.log(
        JSON.stringify(
          {
            ok: true,
            knownKeys: MINING_SETTING_KEYS,
            note: "A missing key falls back to its env default on the next mining request.",
            settings: docs.map((doc) => ({ key: doc.key, value: doc.value, updatedAt: doc.updatedAt, updatedBy: doc.updatedBy })),
          },
          null,
          2,
        ),
      );
      return;
    }

    const setKey = argument("--set");
    const resetKey = argument("--reset");
    if (setKey && resetKey) throw new Error("Pass either --set or --reset, not both");
    if (setKey) {
      if (!isMiningSettingKey(setKey)) {
        throw new Error(`Unknown mining setting: ${setKey}. Known keys: ${MINING_SETTING_KEYS.join(", ")}`);
      }
      const raw = argument("--value");
      if (raw === null || raw === "") throw new Error("--set requires --value '<json>'");
      let value: unknown;
      try {
        value = JSON.parse(raw);
      } catch {
        throw new Error("--value must be valid JSON");
      }
      const stored = await setMiningSetting({ collections, key: setKey, value, updatedBy });
      console.log(JSON.stringify({ ok: true, key: stored.key, value: stored.value }, null, 2));
      return;
    }
    if (resetKey) {
      const removed = await resetMiningSetting({ collections, key: resetKey });
      console.log(JSON.stringify({ ok: true, key: resetKey, reset: removed }));
      return;
    }
    throw new Error("Pass --list, --set <key> --value '<json>', or --reset <key>");
  } finally {
    await client.close();
  }
}

try {
  await main();
} catch (error) {
  console.error(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
  process.exitCode = 2;
}
