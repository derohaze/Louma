import { connectMongo } from "../infrastructure/mongodb/client.js";
import { getCollections } from "../infrastructure/mongodb/collections.js";
import { isTransferTransaction, type LedgerAccountRecord } from "../shared/types.js";
import { TEST_FUNDING_CORRELATION_PREFIXES } from "../modules/ledger/reconciliation.js";

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

    // A transaction is shared when any participant reference names someone outside the test
    // domain. Only a present, non-test id counts: mining settlements carry `ownerUserId`
    // but no sender/receiver, and absent fields must not read as real participants.
    const testIdSet = new Set(userIds);
    const isRealId = (value: unknown): value is string =>
      typeof value === "string" && value.length > 0 && !testIdSet.has(value);
    const sharedTxIds = new Set(
      transactions
        .filter((tx) => {
          // Transfer headers name their parties; mining issuance headers carry `ownerUserId`
          // but no sender/receiver, and absent fields must not read as real participants.
          if (isTransferTransaction(tx)) {
            // `participants` is not a required schema field: a transfer written by an older
            // process after this process's backfill has none, and a bare `.some` would throw
            // before any test account could be removed.
            const participants = Array.isArray(tx.participants) ? tx.participants : [];
            return isRealId(tx.senderUserId) || isRealId(tx.receiverUserId) || participants.some(isRealId);
          }
          return isRealId(tx.ownerUserId);
        })
        .map((tx) => tx.publicId),
    );
    const testOnlyTxIds = transactionIds.filter((id) => !sharedTxIds.has(id));

    // Whole footprints of test-only transactions are removed — every line, including the
    // treasury/fee lines (settlement rewards post treasury debits under a non-funding
    // correlation, so selecting test accounts alone would orphan them) — plus test-account
    // lines and journal-less funding lines. Lines are never selected by transaction alone
    // without the shared-transaction exclusion below: deleting only the test side of a
    // test↔real transfer would leave the kept header and counterparty line unbalanced,
    // which reconciliation reports as critical.
    const fundingPattern = `^(${TEST_FUNDING_CORRELATION_PREFIXES.join("|")})`;
    const entryFilter = {
      $or: [
        ...(testOnlyTxIds.length > 0 ? [{ transactionId: { $in: testOnlyTxIds } }] : []),
        ...(accountIds.length > 0 ? [{ ledgerAccountId: { $in: accountIds } }] : []),
        { correlationId: { $regex: fundingPattern } },
      ],
    };
    const fetched = await collections.ledgerEntries.find(entryFilter).toArray();

    // Shared transactions stay whole (header and every line), and lines posted on real
    // (non-test, non-shared) accounts are never touched: unwinding those would rewrite real
    // balances, which this script must not do. They are retained and reported instead.
    const sharedAccounts = await collections.ledgerAccounts.find({ accountType: { $in: ["fee_revenue", "system_treasury"] } }).toArray();
    const testAccountSet = new Set(accountIds);
    const sharedAccountSet = new Set(sharedAccounts.map((account) => account.publicId));
    const fundingRe = new RegExp(fundingPattern);

    // A test account that owns a line of a shared transaction is kept whole: its kept line can
    // never be deleted (the shared header and the counterparty line survive), and deleting its
    // other lines alone — e.g. the test-funding credit behind a transfer the account made — would
    // leave its projection below zero, which the ledger-account validator refuses. Keeping a line
    // pins its whole transaction, which pins the other accounts on it, and so on: the entire
    // connected component of accounts joined by test-only transactions is retained, whole
    // transactions and all. Nothing in it loses a line or a projection, so no adjustment is needed
    // and every retained account stays rediscoverable on a later run. Accounts and test-only
    // transactions outside the component are removed exactly as before.
    const retainedTestAccountIds = new Set(
      fetched
        .filter((entry) => testAccountSet.has(entry.ledgerAccountId) && sharedTxIds.has(entry.transactionId))
        .map((entry) => entry.ledgerAccountId),
    );
    const retainedTestOnlyTxIds = new Set<string>();
    const testAccountsByTx = new Map<string, Set<string>>();
    const testOnlyTxIdsByAccount = new Map<string, Set<string>>();
    for (const entry of fetched) {
      if (!testAccountSet.has(entry.ledgerAccountId) || sharedTxIds.has(entry.transactionId)) continue;
      const accounts = testAccountsByTx.get(entry.transactionId) ?? new Set<string>();
      accounts.add(entry.ledgerAccountId);
      testAccountsByTx.set(entry.transactionId, accounts);
      const txIds = testOnlyTxIdsByAccount.get(entry.ledgerAccountId) ?? new Set<string>();
      txIds.add(entry.transactionId);
      testOnlyTxIdsByAccount.set(entry.ledgerAccountId, txIds);
    }
    const retainedQueue = [...retainedTestAccountIds];
    while (retainedQueue.length > 0) {
      const accountId = retainedQueue.pop() as string;
      for (const txId of testOnlyTxIdsByAccount.get(accountId) ?? []) {
        if (retainedTestOnlyTxIds.has(txId)) continue;
        retainedTestOnlyTxIds.add(txId);
        for (const memberId of testAccountsByTx.get(txId) ?? []) {
          if (retainedTestAccountIds.has(memberId)) continue;
          retainedTestAccountIds.add(memberId);
          retainedQueue.push(memberId);
        }
      }
    }
    const testOnlyTxIdsToDelete = testOnlyTxIds.filter((id) => !retainedTestOnlyTxIds.has(id));
    const deletableSet = new Set(
      fetched
        .filter(
          (entry) =>
            !sharedTxIds.has(entry.transactionId) &&
            !retainedTestOnlyTxIds.has(entry.transactionId) &&
            !retainedTestAccountIds.has(entry.ledgerAccountId) &&
            (testAccountSet.has(entry.ledgerAccountId) ||
              sharedAccountSet.has(entry.ledgerAccountId) ||
              fundingRe.test(entry.correlationId ?? "")),
        )
        .map((entry) => entry.publicId),
    );
    const entries = fetched.filter((entry) => deletableSet.has(entry.publicId));
    const retainedEntries = fetched.filter((entry) => !deletableSet.has(entry.publicId));

    // The shared accounts lose exactly the lines being deleted, in one atomic decrement per account:
    // the projection is corrected by the same amount the entries contributed, so after the delete the
    // account still equals the sum of what remains.
    const deltas: { account: LedgerAccountRecord; deltaMinor: number }[] = [];
    const signedContribution = (accountType: string, side: string, amountMinor: number): number => {
      // Signed contribution on the account's normal side (see reconciliation.ts): fee revenue is
      // credit-normal, the treasury is debit-normal. A treasury funding debit grows its
      // projection, so its removal must decrement it — not increment it.
      const multiplier = accountType === "system_treasury" ? 1 : -1;
      return (side === "credit" ? -amountMinor : amountMinor) * multiplier;
    };
    for (const account of sharedAccounts) {
      const mine = entries.filter((entry) => entry.ledgerAccountId === account.publicId);
      if (mine.length === 0) continue;
      const deltaMinor = mine.reduce(
        (total, entry) => total + signedContribution(account.accountType, entry.side, entry.amountMinor),
        0,
      );
      deltas.push({ account, deltaMinor });
    }
    // A retained ledger account keeps its lines untouched, so its projection still equals them and
    // no adjustment is applied. It must also keep its wallet (and the wallet's owner): the next
    // cleanup run rediscovers accounts through the user → wallet → account join, so deleting the
    // wallet would strand the kept ledger account as unreachable test debris.
    const removableAccountIds = accounts
      .filter((account) => !retainedTestAccountIds.has(account.publicId))
      .map((account) => account.publicId);
    const retainedWalletIds = new Set(
      accounts
        .filter((account) => retainedTestAccountIds.has(account.publicId))
        .map((account) => account.walletId)
        .filter((walletId): walletId is string => typeof walletId === "string"),
    );
    const walletsToDeleteIds = wallets.filter((wallet) => !retainedWalletIds.has(wallet.publicId)).map((wallet) => wallet.publicId);
    const retainedUserIds = new Set(
      wallets.filter((wallet) => retainedWalletIds.has(wallet.publicId)).map((wallet) => wallet.ownerUserId),
    );
    const usersToDelete = userIds.filter((userId) => !retainedUserIds.has(userId));

    const report = {
      apply,
      testUsers: users.length,
      wallets: wallets.length,
      ledgerAccounts: accounts.length,
      transactions: transactions.length,
      ledgerEntries: entries.length,
      sharedTransactionsRetained: sharedTxIds.size,
      sharedEntriesRetained: retainedEntries.length,
      testAccountsRetained: retainedTestAccountIds.size,
      testOnlyTransactionsRetained: testOnlyTxIds.filter((id) => retainedTestOnlyTxIds.has(id)).length,
      walletsRetained: retainedWalletIds.size,
      usersRetained: retainedUserIds.size,
      sharedProjectionAdjustments: deltas.map((item) => ({ accountType: item.account.accountType, deltaMinor: item.deltaMinor })),
    };
    console.log(JSON.stringify(report, null, 2));
    if (!apply) return;

    // One transaction: entries and their projection adjustments commit together, so a
    // crash cannot leave balances referencing deleted entries (a rerun only sees remains).
    const session = client.startSession();
    try {
      await session.withTransaction(async () => {
        // Delete by explicit entry identity: the scan filter above also matches the retained
        // shared-transaction lines, which must survive with their header.
        if (entries.length > 0) {
          await collections.ledgerEntries.deleteMany({ _id: { $in: entries.map((entry) => entry._id) } }, { session });
        }
        for (const { account, deltaMinor } of deltas) {
          if (deltaMinor !== 0) await collections.ledgerAccounts.updateOne({ _id: account._id }, { $inc: { balanceMinor: -deltaMinor } }, { session });
        }
        if (testOnlyTxIdsToDelete.length > 0) await collections.transactions.deleteMany({ publicId: { $in: testOnlyTxIdsToDelete } }, { session });
        if (removableAccountIds.length > 0) await collections.ledgerAccounts.deleteMany({ publicId: { $in: removableAccountIds } }, { session });
        if (walletsToDeleteIds.length > 0) await collections.wallets.deleteMany({ publicId: { $in: walletsToDeleteIds } }, { session });
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
        if (usersToDelete.length > 0) await collections.users.deleteMany({ publicId: { $in: usersToDelete } }, { session });
      });
    } finally {
      await session.endSession();
    }
    console.log(JSON.stringify({ applied: true, removedUsers: usersToDelete.length, retainedUsers: retainedUserIds.size }, null, 2));
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
