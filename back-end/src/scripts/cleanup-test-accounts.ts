import { connectMongo } from "../infrastructure/mongodb/client.js";
import { getCollections } from "../infrastructure/mongodb/collections.js";
import type { LedgerAccountRecord } from "../shared/types.js";

/**
 * Removes the accounts the integration suites create, and their whole ledger footprint, without ever
 * leaving a projection disagreeing with the entries it is derived from.
 *
 * Why this exists: an integration run that is killed before its `after()` hook finishes leaves
 * accounts, wallets, ledger lines and — for the funding lines the suites mint through a deliberately
 * unrecorded debit — journal-less ledger entries behind. The next run's reconciliation then reports
 * them (correctly, for a production ledger) as orphaned entries, which reads like a financial defect
 * when it is really abandoned test infrastructure. This script is the maintenance answer: it deletes
 * what a crashed run created, and takes the shared fee and treasury projections back by exactly the
 * net of the entries it deletes.
 *
 * Scope is deliberately narrow: only accounts whose email is in the reserved test domain
 * (`@example.test`). Nothing else in the database is read-modify-written, and the script never
 * rewrites a balance field from a scan — every shared projection moves by an exact `$inc` computed
 * from the entries being removed in the same operation.
 *
 *   npm run cleanup:test-accounts            # report only (default)
 *   npm run cleanup:test-accounts -- --apply  # delete
 *
 * Exit codes: 0 = reported or applied, 2 = the run itself failed.
 */

const TEST_FUNDING_PREFIXES = ["smoke-funding-", "adversarial-funding-", "benchmark-"];

function positiveInteger(name: string, raw: string | undefined, fallback: number): number {
  const value = Number(raw ?? fallback);
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`Invalid environment variable: ${name}`);
  return value;
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const mongoUri = process.env["MONGODB_URI"]?.trim();
  if (!mongoUri) throw new Error("Missing required environment variable: MONGODB_URI");
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
    const users = await collections.users.find({ email: { $regex: "@example\\.test$" } }).toArray();
    const userIds = users.map((user) => user.publicId);
    const wallets = await collections.wallets.find({ ownerUserId: { $in: userIds } }).toArray();
    const walletIds = wallets.map((wallet) => wallet.publicId);
    const accounts = await collections.ledgerAccounts.find({ walletId: { $in: walletIds } }).toArray();
    const accountIds = accounts.map((account) => account.publicId);
    const transactions = await collections.transactions
      .find({ $or: [{ senderUserId: { $in: userIds } }, { receiverUserId: { $in: userIds } }, { ownerUserId: { $in: userIds } }, { participants: { $in: userIds } }] })
      .toArray();
    const transactionIds = transactions.map((transaction) => transaction.publicId);

    // Only entries that belong to test-owned accounts (or the suites' funding lines) are
    // removed. Entries are never selected by transaction alone: a transfer between a test
    // account and a real account shares one transaction id, and matching on it would delete
    // the real wallet's entry while only fee/treasury projections are reversed.
    const entryFilter = {
      $or: [
        { ledgerAccountId: { $in: accountIds } },
        { correlationId: { $regex: `^(${TEST_FUNDING_PREFIXES.join("|")})` } },
      ],
    };
    const entries = await collections.ledgerEntries.find(entryFilter).toArray();

    // The shared accounts lose exactly the lines being deleted, in one atomic decrement per account:
    // the projection is corrected by the same amount the entries contributed, so after the delete the
    // account still equals the sum of what remains.
    const sharedAccounts = await collections.ledgerAccounts.find({ accountType: { $in: ["fee_revenue", "system_treasury"] } }).toArray();
    const deltas: { account: LedgerAccountRecord; deltaMinor: number }[] = [];
    for (const account of sharedAccounts) {
      const mine = entries.filter((entry) => entry.ledgerAccountId === account.publicId);
      if (mine.length === 0) continue;
      // Signed contribution on the account's normal side (see reconciliation.ts): fee revenue is
      // credit-normal, the treasury is debit-normal. A treasury funding debit grows its
      // projection, so its removal must decrement it — not increment it.
      const multiplier = account.accountType === "system_treasury" ? 1 : -1;
      const deltaMinor = mine.reduce(
        (total, entry) => total + (entry.side === "credit" ? -entry.amountMinor : entry.amountMinor) * multiplier,
        0,
      );
      deltas.push({ account, deltaMinor });
    }

    const report = {
      apply,
      testUsers: users.length,
      wallets: wallets.length,
      ledgerAccounts: accounts.length,
      transactions: transactions.length,
      ledgerEntries: entries.length,
      sharedProjectionAdjustments: deltas.map((item) => ({ accountType: item.account.accountType, deltaMinor: item.deltaMinor })),
    };
    console.log(JSON.stringify(report, null, 2));
    if (!apply) return;

    // One transaction: entries and their projection adjustments commit together, so a
    // crash cannot leave balances referencing deleted entries (a rerun only sees remains).
    // Only transactions with no real-wallet participation are removed; shared transfers keep
    // their header so the surviving counterparty entry still resolves.
    const realInvolvedIds = new Set(
      transactions
        .filter((tx) => !userIds.includes(tx.senderUserId) || !userIds.includes(tx.receiverUserId))
        .map((tx) => tx.publicId),
    );
    const deletableTransactionIds = transactionIds.filter((id) => !realInvolvedIds.has(id));
    const session = client.startSession();
    try {
      await session.withTransaction(async () => {
        await collections.ledgerEntries.deleteMany(entryFilter, { session });
        for (const { account, deltaMinor } of deltas) {
          if (deltaMinor !== 0) await collections.ledgerAccounts.updateOne({ _id: account._id }, { $inc: { balanceMinor: -deltaMinor } }, { session });
        }
        if (deletableTransactionIds.length > 0) await collections.transactions.deleteMany({ publicId: { $in: deletableTransactionIds } }, { session });
        await collections.ledgerAccounts.deleteMany({ publicId: { $in: accountIds } }, { session });
        await collections.wallets.deleteMany({ publicId: { $in: walletIds } }, { session });
        await collections.transferAuthorizations.deleteMany({ ownerUserId: { $in: userIds } }, { session });
        await collections.twoFactorUses.deleteMany({ ownerUserId: { $in: userIds } }, { session });
        await collections.transferPasswordCredentials.deleteMany({ ownerUserId: { $in: userIds } }, { session });
        await collections.twoFactorCredentials.deleteMany({ ownerUserId: { $in: userIds } }, { session });
        await collections.notifications.deleteMany({ ownerUserId: { $in: userIds } }, { session });
        await collections.securityEvents.deleteMany({ ownerUserId: { $in: userIds } }, { session });
        await collections.sessions.deleteMany({ ownerUserId: { $in: userIds } }, { session });
        await collections.miningSessions.deleteMany({ ownerUserId: { $in: userIds } }, { session });
        await collections.miningSettlements.deleteMany({ ownerUserId: { $in: userIds } }, { session });
        await collections.miningDeviceLeases.deleteMany({ ownerUserId: { $in: userIds } }, { session });
        await collections.users.deleteMany({ publicId: { $in: userIds } }, { session });
      });
    } finally {
      await session.endSession();
    }
    console.log(JSON.stringify({ applied: true, removedUsers: userIds.length }, null, 2));
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
