import { connectMongo } from "../infrastructure/mongodb/client.js";
import { getCollections } from "../infrastructure/mongodb/collections.js";
import { migrateMiningSettlementsToTransactions } from "../infrastructure/mongodb/backfills.js";
import { reconcileLedger } from "../modules/ledger/reconciliation.js";

/**
 * Operational runner for the `mining_settlements` → `transactions` migration (ADR-003).
 *
 * Standalone, like the reconciler: it needs database credentials and is never reachable from the
 * customer API. Startup performs the same migration automatically and idempotently, so this script
 * exists for the parts a boot must not do — a full preflight report, a post-migration
 * reconciliation, and a verifiable exit code an operator can gate a deploy on.
 *
 * Fail-closed: without `--execute` the run is a DRY RUN — preflight, per-row classification,
 * and reconciliation are reported, nothing is written. With `--execute`, writes are insert-only
 * (plus the single guarded walletAccountId backfill) and scoped to journal headers whose
 * publicId exists in `mining_settlements`: no other financial document is created or modified.
 *
 * Exit codes: 0 = clean (dry-run with nothing to do, or executed and verified), 1 = rows need
 * review or the ledger does not reconcile, 2 = the run itself failed.
 */

function positiveInteger(name: string, raw: string | undefined, fallback: number): number {
  const value = Number(raw ?? fallback);
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`Invalid environment variable: ${name}`);
  return value;
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

  const execute = process.argv.includes("--execute");
  const dryRun = !execute;

  const { client, db } = await connectMongo(config);
  try {
    const collections = getCollections(db);

    // Explicit target check: the journal uniqueness indexes must exist before any write, or
    // overlapping writers could duplicate. Fail closed when they are missing.
    const indexNames = new Set((await collections.transactions.listIndexes().toArray()).map((index) => index.name));
    const requiredIndexes = ["transactions_mining_session_sequence_unique", "transactions_mining_idempotency_unique"];
    const missingIndexes = requiredIndexes.filter((name) => !indexNames.has(name));
    if (missingIndexes.length > 0) {
      console.error(JSON.stringify({ ok: false, error: `Refusing to run: missing journal indexes: ${missingIndexes.join(", ")}. Start the API once so ensureDatabaseIndexes creates them.` }));
      process.exitCode = 2;
      return;
    }

    // Preflight: what the migration is about to see, counted before it writes anything.
    const preflight = {
      legacySettlements: await collections.miningSettlements.countDocuments({}),
      miningHeaders: await collections.transactions.countDocuments({ type: "mining" }),
      legacySettlementMinor: (
        await collections.miningSettlements
          .aggregate<{ total: number }>([{ $group: { _id: null, total: { $sum: "$amountMinor" } } }])
          .toArray()
      )[0]?.total ?? 0,
      miningHeaderMinor: (
        await collections.transactions
          .aggregate<{ total: number }>([{ $match: { type: "mining" } }, { $group: { _id: null, total: { $sum: "$amountMinor" } } }])
          .toArray()
      )[0]?.total ?? 0,
    };

    const report = await migrateMiningSettlementsToTransactions(db, { dryRun });
    // Post counts: what the target collection holds AFTER this run (== preflight when dry-run).
    const postflight = {
      miningHeaders: await collections.transactions.countDocuments({ type: "mining" }),
      miningHeaderMinor: (
        await collections.transactions
          .aggregate<{ total: number }>([{ $match: { type: "mining" } }, { $group: { _id: null, total: { $sum: "$amountMinor" } } }])
          .toArray()
      )[0]?.total ?? 0,
    };
    const reconciliation = await reconcileLedger({ collections, mongoClient: client });

    // Post-migration verification: every legacy settlement must now be represented by a journal
    // header with the same amount. The comparison is on totals and on the migrated id set, not on
    // counts — a mixed-version deployment legitimately has more headers than settlements.
    const legacyIds = (await collections.miningSettlements.find({}, { projection: { publicId: 1 } }).toArray())
      .map((row) => row.publicId)
      .filter((value): value is string => typeof value === "string");
    const migratedHeaders = legacyIds.length === 0
      ? []
      : await collections.transactions.find({ type: "mining", publicId: { $in: legacyIds } }, { projection: { publicId: 1, amountMinor: 1 } }).toArray();
    const legacyTotal = preflight.legacySettlementMinor;
    const migratedTotal = migratedHeaders.reduce((sum, header) => sum + header.amountMinor, 0);

    const verification = {
      legacyIdsChecked: legacyIds.length,
      legacyIdsRepresented: migratedHeaders.length,
      legacyTotalMinor: legacyTotal,
      representedTotalMinor: migratedTotal,
      totalsMatch: legacyTotal === migratedTotal,
      reconciliationOk: reconciliation.ok,
      reconciliationIssueCount: reconciliation.issues.length,
    };

    console.log(JSON.stringify({ mode: dryRun ? "dry-run" : "execute", preflight, report, postflight, verification }, null, 2));

    const clean =
      verification.legacyIdsRepresented === verification.legacyIdsChecked &&
      verification.totalsMatch &&
      report.mismatchedPublicIds.length === 0 &&
      report.unresolvableWalletAccountIds.length === 0 &&
      reconciliation.ok;
    if (dryRun && clean && report.inserted === 0) {
      console.log("Dry run clean: nothing to migrate.");
    } else if (dryRun) {
      console.log("Dry run complete: re-run with --execute to write (insert-only, scoped to legacy settlement ids).");
    } else if (!clean) {
      console.error("Migration needs review before `mining_settlements` may be dropped. See docs/migrations.md.");
    }
    process.exitCode = clean ? 0 : 1;
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