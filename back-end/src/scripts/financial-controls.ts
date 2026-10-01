import { connectMongo } from "../infrastructure/mongodb/client.js";
import { getCollections } from "../infrastructure/mongodb/collections.js";
import { setFinancialControls } from "../modules/financial-controls/service.js";

/**
 * Operational control of the financial surfaces, for use during an incident.
 *
 *   npm run financial:controls -- --status
 *   npm run financial:controls -- --transfers-paused --reason "reconciliation failure INC-1234"
 *   npm run financial:controls -- --transfers-resumed --reason "INC-1234 resolved"
 *
 * It is a script, not an endpoint: it needs database credentials on the host, and the customer API
 * has no administrative surface that could be used to stop or restart money movement. Like the
 * reconciliation runner, it reads only the database slice of the configuration and fails closed on
 * what it does not get.
 *
 * Exit codes: 0 = the control was read or written, 2 = the run itself failed.
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
    const pauseTransfers = process.argv.includes("--transfers-paused");
    const resumeTransfers = process.argv.includes("--transfers-resumed");
    const pausePayouts = process.argv.includes("--payouts-paused");
    const resumePayouts = process.argv.includes("--payouts-resumed");
    if (pauseTransfers && resumeTransfers) throw new Error("Pass either --transfers-paused or --transfers-resumed, not both");
    if (pausePayouts && resumePayouts) throw new Error("Pass either --payouts-paused or --payouts-resumed, not both");
    const writes = pauseTransfers || resumeTransfers || pausePayouts || resumePayouts;

    if (!writes) {
      const current = await collections.financialControls.findOne({ _id: "global" });
      console.log(JSON.stringify({ ok: true, controls: current ?? null }, null, 2));
      return;
    }

    // A pause always names its reason: an unexplained halt to money movement is an incident of its
    // own, and the audit trail has to say who did it and why.
    const reason = argument("--reason") ?? "";
    if ((pauseTransfers || pausePayouts) && reason.trim().length === 0) throw new Error("A pause requires --reason \"<why>\"");
    const current = await collections.financialControls.findOne({ _id: "global" });
    const next = {
      transfersPaused: pauseTransfers ? true : resumeTransfers ? false : current?.transfersPaused ?? false,
      payoutsPaused: pausePayouts ? true : resumePayouts ? false : current?.payoutsPaused ?? false,
      reason: reason.trim().length > 0 ? reason.trim() : current?.reason ?? "",
    };
    const controls = await setFinancialControls({
      collections,
      ...next,
      updatedBy: process.env["USER"] ?? process.env["USERNAME"] ?? "unknown",
    });
    console.log(JSON.stringify({ ok: true, controls }, null, 2));
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
