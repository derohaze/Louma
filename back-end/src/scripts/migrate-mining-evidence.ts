import { loadConfig } from "../config/env.js";
import { connectMongo } from "../infrastructure/mongodb/client.js";
import { verifyMiningEvidence } from "../infrastructure/mongodb/mining-evidence.js";

// No env file is loaded here. Default is read-only; never exposed through customer routes.
// --execute --writers-drained --confirm-database=<exact name> repairs derived tokens only.
async function main() {
  const args = process.argv.slice(2);
  if (args.some(arg => !["--execute", "--writers-drained"].includes(arg) && !arg.startsWith("--confirm-database="))) {
    throw new Error("Unknown migration argument");
  }
  const config = loadConfig();
  const execute = args.includes("--execute");
  if (execute && (!args.includes("--writers-drained") || !args.includes(`--confirm-database=${config.mongoDatabase}`))) {
    throw new Error("Execution requires drained writers and explicit database confirmation");
  }
  const { client, db } = await connectMongo(config);
  try {
    const before = await verifyMiningEvidence(db, config.encryptionKey);
    const repair = execute ? await verifyMiningEvidence(db, config.encryptionKey, true) : null;
    const after = execute ? await verifyMiningEvidence(db, config.encryptionKey) : before;
    const ok = after.mismatched === 0 && before.scanned === after.scanned &&
      before.identityDigest === after.identityDigest && (repair?.concurrentChanges ?? 0) === 0;
    console.log(JSON.stringify({ database: config.mongoDatabase, dryRun: !execute, before, repair, after, ok }));
    if (!ok) process.exitCode = 1;
  } finally { await client.close(); }
}

main().catch(() => {
  // Driver/config errors can contain connection details; never print credentials or evidence.
  console.error("Mining evidence migration failed. Check configuration, schema and database access; no credentials are logged.");
  process.exitCode = 2;
});
