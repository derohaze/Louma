import { connectMongo } from "../infrastructure/mongodb/client.js";
import { getCollections } from "../infrastructure/mongodb/collections.js";
import { migrateWalletAddresses } from "../infrastructure/mongodb/wallet-address-migration.js";
import { generateWalletAddress } from "../modules/wallets/address.js";

const LEGACY_ADDRESS = /^[Ll][Mm][Aa](?:-[0-9A-Fa-f]{4}){3}$/;
const CANONICAL_ADDRESS = /^LMA[0-7][0-9A-HJKMNP-TV-Z]{27}$/;

function positiveInteger(name: string, raw: string | undefined, fallback: number): number {
  const value = Number(raw ?? fallback);
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`Invalid environment variable: ${name}`);
  return value;
}

function hasIndex(indexes: Array<{ name?: string; key: Record<string, unknown>; unique?: boolean; partialFilterExpression?: Record<string, unknown> }>, expected: {
  name: string;
  key: Record<string, number>;
  unique?: boolean;
  partialFilterExpression?: Record<string, unknown>;
}): boolean {
  const index = indexes.find((candidate) => candidate.name === expected.name);
  if (!index || JSON.stringify(index.key) !== JSON.stringify(expected.key)) return false;
  if (expected.unique !== undefined && index.unique !== expected.unique) return false;
  return JSON.stringify(index.partialFilterExpression ?? null) === JSON.stringify(expected.partialFilterExpression ?? null);
}

async function main(): Promise<void> {
  const mongoUri = process.env["MONGODB_URI"]?.trim();
  if (!mongoUri || (!mongoUri.startsWith("mongodb://") && !mongoUri.startsWith("mongodb+srv://"))) {
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
  const confirmedDatabase = process.argv.find((argument) => argument.startsWith("--confirm-database="))?.split("=", 2)[1];
  const backupConfirmed = process.argv.includes("--backup-confirmed");
  if (execute && (confirmedDatabase !== mongoDatabase || !backupConfirmed)) {
    throw new Error("Execute requires --confirm-database=<MONGODB_DATABASE> and --backup-confirmed after a verified backup/export.");
  }

  const { client, db } = await connectMongo(config);
  try {
    const collections = getCollections(db);
    const [walletIndexRows, ledgerIndexRows] = await Promise.all([
      collections.wallets.listIndexes().toArray(),
      collections.ledgerAccounts.listIndexes().toArray(),
    ]);
    const missingIndexes = [
      ...[
        { name: "wallets_address_unique", key: { addressNormalized: 1 }, unique: true },
        { name: "wallets_owner_primary_unique", key: { ownerUserId: 1, isPrimary: 1 }, unique: true, partialFilterExpression: { isPrimary: true } },
        { name: "wallets_address_legacy_migration", key: { addressVersion: 1, _id: 1 }, partialFilterExpression: { addressVersion: 0 } },
      ].filter((expected) => !hasIndex(walletIndexRows, expected)).map((index) => index.name),
      ...[
        { name: "ledger_accounts_wallet_unique", key: { walletId: 1, accountType: 1 }, unique: true, partialFilterExpression: { accountType: "wallet" } },
      ].filter((expected) => !hasIndex(ledgerIndexRows, expected)).map((index) => index.name),
    ];
    if (missingIndexes.length > 0) {
      throw new Error(`Refusing to run: missing wallet indexes ${missingIndexes.join(", ")}. Start the updated API once to backfill fields and create indexes.`);
    }

    const wallets = collections.wallets;
    const totalBefore = await wallets.countDocuments({});
    const userCount = await collections.users.countDocuments({});
    const usersMissingPrimary = await collections.users.aggregate<{ count: number }>([
      {
        $lookup: {
          from: "wallets",
          let: { userId: "$publicId" },
          pipeline: [
            { $match: { $expr: { $and: [{ $eq: ["$ownerUserId", "$$userId"] }, { $eq: ["$isPrimary", true] }] } } },
            { $limit: 1 },
          ],
          as: "primaryWallet",
        },
      },
      { $match: { $expr: { $eq: [{ $size: "$primaryWallet" }, 0] } } },
      { $count: "count" },
    ]).toArray();
    const primaryCount = userCount - (usersMissingPrimary[0]?.count ?? 0);
    const accountsWithoutPrimary = usersMissingPrimary[0]?.count ?? 0;
    const oldFormatInvalid = await wallets.countDocuments({
      addressVersion: 0,
      $or: [{ address: { $not: { $regex: LEGACY_ADDRESS } } }, { addressNormalized: { $not: { $regex: LEGACY_ADDRESS } } }],
    });
    const canonicalInvalid = await wallets.countDocuments({
      addressVersion: 1,
      $or: [{ address: { $not: { $regex: CANONICAL_ADDRESS } } }, { addressNormalized: { $not: { $regex: CANONICAL_ADDRESS } } }],
    });
    const missingAddressVersion = await wallets.countDocuments({ addressVersion: { $nin: [0, 1] } });
    const walletAccountCount = await collections.ledgerAccounts.countDocuments({ accountType: "wallet" });
    const walletsWithoutExactlyOneLedgerAccount = await wallets.aggregate<{ _id: 1 }>([
      {
        $lookup: {
          from: "ledger_accounts",
          let: { walletId: "$publicId" },
          pipeline: [
            { $match: { $expr: { $and: [{ $eq: ["$walletId", "$$walletId"] }, { $eq: ["$accountType", "wallet"] }] } } },
            { $limit: 2 },
          ],
          as: "walletLedgerAccounts",
        },
      },
      { $match: { $expr: { $ne: [{ $size: "$walletLedgerAccounts" }, 1] } } },
      { $limit: 1 },
    ]).toArray();
    const blockers = [
      ...(accountsWithoutPrimary > 0 ? [`${accountsWithoutPrimary} users have no primary wallet`] : []),
      ...(oldFormatInvalid > 0 ? [`${oldFormatInvalid} legacy wallet addresses are malformed`] : []),
      ...(canonicalInvalid > 0 ? [`${canonicalInvalid} canonical wallet addresses are malformed`] : []),
      ...(missingAddressVersion > 0 ? [`${missingAddressVersion} wallets need addressVersion backfill; start the updated API first`] : []),
      ...(walletsWithoutExactlyOneLedgerAccount.length > 0 ? ["one or more wallets do not have exactly one wallet ledger account"] : []),
      ...(walletAccountCount !== totalBefore ? [`wallet ledger account count ${walletAccountCount} does not match wallet count ${totalBefore}`] : []),
    ];
    if (blockers.length > 0) throw new Error(`Preflight blocked: ${blockers.join("; ")}`);

    const preflight = {
      database: mongoDatabase,
      users: userCount,
      usersWithPrimaryWallet: primaryCount,
      wallets: totalBefore,
      legacyAddresses: await wallets.countDocuments({ addressVersion: 0 }),
      canonicalAddresses: await wallets.countDocuments({ addressVersion: 1 }),
      walletLedgerAccounts: walletAccountCount,
      primaryWalletUniqueIndex: true,
      canonicalAddressUniqueIndex: true,
    };
    const report = await migrateWalletAddresses({ wallets, dryRun: !execute, generateAddress: generateWalletAddress });
    const totalAfter = await wallets.countDocuments({});
    const legacyAfter = await wallets.countDocuments({ addressVersion: 0 });
    const canonicalAfter = await wallets.countDocuments({ addressVersion: 1 });
    const invalidAfter = await wallets.countDocuments({
      addressVersion: 1,
      $or: [{ address: { $not: { $regex: CANONICAL_ADDRESS } } }, { addressNormalized: { $not: { $regex: CANONICAL_ADDRESS } } }],
    });
    const verification = {
      walletCountPreserved: totalBefore === totalAfter,
      noLegacyWalletAddressesRemain: legacyAfter === 0,
      everyWalletHasCanonicalAddress: canonicalAfter === totalAfter,
      noMalformedCanonicalAddresses: invalidAfter === 0,
      walletLedgerAccountsUnchanged: walletAccountCount === await collections.ledgerAccounts.countDocuments({ accountType: "wallet" }),
    };
    console.log(JSON.stringify({ mode: execute ? "execute" : "dry-run", preflight, report, verification }, null, 2));

    const clean = verification.walletCountPreserved && verification.noLegacyWalletAddressesRemain && verification.everyWalletHasCanonicalAddress && verification.noMalformedCanonicalAddresses && verification.walletLedgerAccountsUnchanged;
    if (!execute) {
      console.log("Dry run complete. A legacy address will be replaced in place; transaction snapshots and ledger records are not modified.");
      process.exitCode = 0;
    } else if (!clean) {
      console.error("Address migration verification failed; inspect the report before serving traffic.");
      process.exitCode = 1;
    }
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
