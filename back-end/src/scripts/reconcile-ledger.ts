import { connectMongo } from "../infrastructure/mongodb/client.js";
import { getCollections } from "../infrastructure/mongodb/collections.js";
import { reconcileLedger } from "../modules/ledger/reconciliation.js";

/**
 * Operational reconciliation runner. It is a standalone script, not an HTTP endpoint: the customer
 * API never exposes ledger maintenance surfaces, and running this requires database credentials on
 * the host, which is exactly the access level that matches what the tool can do.
 *
 * Configuration is the database slice only (`MONGODB_URI`, `MONGODB_DATABASE`, and the two timeout
 * variables) — deliberately narrower than the full app config, because reading the ledger needs no
 * tokens or keys and a maintenance tool should fail closed on exactly what it uses.
 *
 * Exit codes: 0 = the ledger is consistent, 1 = discrepancies found, 2 = the run itself failed.
 */

function positiveInteger(name: string, raw: string | undefined, fallback: number): number {
  const value = Number(raw ?? fallback);
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`Invalid environment variable: ${name}`);
  return value;
}

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
};

const { client, db } = await connectMongo(config);
try {
  const collections = getCollections(db);
  const result = await reconcileLedger({ collections });
  if (result.ok) {
    console.log(JSON.stringify({ ok: true, issueCount: 0 }));
  } else {
    console.error(JSON.stringify({ ok: false, issueCount: result.issues.length, issues: result.issues }, null, 2));
  }
  process.exitCode = result.ok ? 0 : 1;
} catch (error) {
  console.error(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
  process.exitCode = 2;
} finally {
  await client.close();
}
