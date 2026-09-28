import type { ClientSession, MongoClient } from "mongodb";
import type { Collections } from "../../infrastructure/mongodb/collections.js";
import type { ReconciliationIssue } from "../../shared/types.js";

/**
 * Internal financial reconciliation. Not a public or customer-facing surface: it exists so the
 * ledger (the authoritative record) can be checked against its projections without a customer ever
 * discovering the discrepancy first. Every check is a plain read-model scan — the tool never writes,
 * so running it is always safe.
 *
 * The work is bounded on purpose: this must not build a set or map sized like the collections, and
 * it must not load a whole collection into memory, including on a database that has grown for years.
 * The cross-collection checks are therefore aggregations — the server walks the joins and only the
 * failures cross into this process.
 */

const SCAN_BATCH_SIZE = 500;

/**
 * Normal side by account type. Wallets and fee revenue are credit-normal (a credit grows the
 * balance); the treasury is the platform's asset side of issuance and is debit-normal (a debit
 * grows it), which is what lets an issuance post debit treasury / credit user without ever driving
 * the treasury negative.
 */
const DEBIT_NORMAL_TYPES = new Set(["system_treasury"]);

function normalSideMultiplier(accountType: string): 1 | -1 {
  return DEBIT_NORMAL_TYPES.has(accountType) ? 1 : -1;
}

/**
 * Recomputes one account's balance from its immutable ledger entries. This is the arithmetic the
 * projection is required to match: the signed sum of entries on the account's normal side. It keeps
 * one running total and one cursor, never a list of entries.
 */
async function ledgerDerivedBalance(
  collections: Collections,
  account: { publicId: string; accountType: string },
  session: ClientSession | undefined,
): Promise<number> {
  const multiplier = normalSideMultiplier(account.accountType);
  let total = 0;
  const cursor = collections.ledgerEntries.find(
    { ledgerAccountId: account.publicId },
    session ? { batchSize: SCAN_BATCH_SIZE, session } : { batchSize: SCAN_BATCH_SIZE },
  );
  while (await cursor.hasNext()) {
    const entry = await cursor.next();
    if (!entry) break;
    total += (entry.side === "credit" ? -entry.amountMinor : entry.amountMinor) * multiplier;
  }
  await cursor.close();
  return total;
}

/**
 * Checks every account's projection against its ledger-derived balance, and every account for a
 * negative projection. Returns one issue per account that fails; the same account can therefore
 * appear more than once across the two checks.
 */
export async function reconcileAccountProjections(input: { collections: Collections; session?: ClientSession }): Promise<ReconciliationIssue[]> {
  const issues: ReconciliationIssue[] = [];
  let cursor = input.collections.ledgerAccounts.find(
    {},
    input.session ? { batchSize: SCAN_BATCH_SIZE, session: input.session } : { batchSize: SCAN_BATCH_SIZE },
  );
  while (await cursor.hasNext()) {
    const account = await cursor.next();
    if (!account) break;
    if (account.balanceMinor < 0) {
      issues.push({ kind: "negative_balance", severity: "critical", detail: `Account ${account.publicId} (${account.accountType}) has a negative projection: ${account.balanceMinor}` });
    }
    const derived = await ledgerDerivedBalance(input.collections, account, input.session);
    if (derived !== account.balanceMinor) {
      issues.push({ kind: "projection_mismatch", severity: "critical", detail: `Account ${account.publicId} (${account.accountType}) projection ${account.balanceMinor} != ledger-derived ${derived}` });
    }
  }
  await cursor.close();
  return issues;
}

/**
 * Options for a reconciliation run.
 *
 * `excludeCorrelationIdPrefixes` exists for test infrastructure only: the integration suite mints
 * funding through a direct, deliberately unrecorded ledger line, and those lines would otherwise be
 * reported as orphaned entries. Production runs pass nothing, and every entry is checked strictly.
 */
export interface ReconcileOptions {
  excludeCorrelationIdPrefixes?: string[];
}

function isExcludedEntry(entry: { correlationId: string }, prefixes: string[] | undefined): boolean {
  return prefixes !== undefined && prefixes.some((prefix) => entry.correlationId.startsWith(prefix));
}

/** One entry whose transaction or account reference does not resolve (or disagrees on currency). */
interface BrokenEntry {
  publicId: string;
  transactionId: string;
  ledgerAccountId: string;
  currency: string;
  correlationId: string;
  hasTransaction: boolean;
  accountCurrency?: string | undefined;
}

/** One transaction whose lines are missing, unbalanced, or in the wrong currency. */
interface BrokenTransaction {
  publicId: string;
  currency: string;
  lineCount: number;
  debits: number;
  credits: number;
  balanced: boolean;
}

/**
 * Checks the transactions/entries relationship: every transaction has balanced entries, every entry
 * references an existing transaction and account, transaction ids are unique, and both collections
 * speak the same single currency.
 *
 * The joins run on the server. Keeping every transaction id and per-transaction total in this process
 * — the previous approach — would grow without bound on a ledger that has accumulated for years, and
 * a maintenance job that dies of memory exhaustion is worse than one that runs slowly.
 */
export async function reconcileLedgerTransactions(input: {
  collections: Collections;
  options?: ReconcileOptions;
  session?: ClientSession;
}): Promise<ReconciliationIssue[]> {
  const issues: ReconciliationIssue[] = [];
  const { collections } = input;
  const session = input.session ? { session: input.session } : {};

  // Duplicate transaction ids. A unique index should make this impossible, but the check is the
  // point, and `$group` performs it without this process holding every id.
  const duplicates = await collections.transactions
    .aggregate<{ _id: string }>(
      [
        { $group: { _id: "$publicId", count: { $sum: 1 } } },
        { $match: { count: { $gt: 1 } } },
        { $limit: 1 },
        { $project: { _id: 1 } },
      ],
      { batchSize: SCAN_BATCH_SIZE, ...session },
    )
    .toArray();
  for (const duplicate of duplicates) {
    issues.push({ kind: "duplicate_transaction", severity: "critical", detail: `Transaction publicId ${duplicate._id} exists more than once` });
  }

  // Entries whose transaction does not exist, whose account does not exist, or whose currency
  // disagrees with that account. `$lookup` resolves the references on the server; only failing
  // entries are returned.
  const brokenEntries = collections.ledgerEntries.aggregate<BrokenEntry>(
    [
      { $lookup: { from: "transactions", localField: "transactionId", foreignField: "publicId", as: "transaction" } },
      { $lookup: { from: "ledger_accounts", localField: "ledgerAccountId", foreignField: "publicId", as: "account" } },
      {
        $project: {
          publicId: 1,
          transactionId: 1,
          ledgerAccountId: 1,
          currency: 1,
          correlationId: 1,
          hasTransaction: { $gt: [{ $size: "$transaction" }, 0] },
          accountCurrency: { $arrayElemAt: ["$account.currency", 0] },
        },
      },
      {
        $match: {
          $or: [
            { hasTransaction: false },
            { accountCurrency: { $exists: false } },
            { $expr: { $ne: ["$currency", "$accountCurrency"] } },
          ],
        },
      },
    ],
    { batchSize: SCAN_BATCH_SIZE, ...session },
  );
  while (await brokenEntries.hasNext()) {
    const entry = await brokenEntries.next();
    if (!entry) break;
    if (!entry.hasTransaction && !isExcludedEntry(entry, input.options?.excludeCorrelationIdPrefixes)) {
      issues.push({ kind: "orphan_entry", severity: "critical", detail: `Ledger entry ${entry.publicId} references missing transaction ${entry.transactionId}` });
    }
    if (entry.accountCurrency === undefined) {
      issues.push({ kind: "invalid_reference", severity: "critical", detail: `Ledger entry ${entry.publicId} references missing account ${entry.ledgerAccountId}` });
    } else if (entry.accountCurrency !== entry.currency) {
      issues.push({ kind: "currency_mismatch", severity: "critical", detail: `Ledger entry ${entry.publicId} is ${entry.currency} but account ${entry.ledgerAccountId} holds ${entry.accountCurrency}` });
    }
  }
  await brokenEntries.close();

  // Every transaction must exist, be balanced, single-currency, and carry at least two lines. The
  // line totals are summed by the database, per transaction, so no totals map is kept here.
  const brokenTransactions = collections.transactions.aggregate<BrokenTransaction>(
    [
      { $lookup: { from: "ledger_entries", localField: "publicId", foreignField: "transactionId", as: "lines" } },
      {
        $project: {
          publicId: 1,
          currency: 1,
          lineCount: { $size: "$lines" },
          debits: { $sum: { $map: { input: "$lines", as: "line", in: { $cond: [{ $eq: ["$$line.side", "debit"] }, "$$line.amountMinor", 0] } } } },
          credits: { $sum: { $map: { input: "$lines", as: "line", in: { $cond: [{ $eq: ["$$line.side", "credit"] }, "$$line.amountMinor", 0] } } } },
        },
      },
      { $addFields: { balanced: { $eq: ["$debits", "$credits"] } } },
      { $match: { $or: [{ lineCount: 0 }, { currency: { $ne: "LMA" } }, { balanced: false }] } },
    ],
    { batchSize: SCAN_BATCH_SIZE, ...session },
  );
  while (await brokenTransactions.hasNext()) {
    const transaction = await brokenTransactions.next();
    if (!transaction) break;
    if (transaction.lineCount === 0) {
      issues.push({ kind: "empty_transaction", severity: "critical", detail: `Transaction ${transaction.publicId} has no ledger entries` });
      continue;
    }
    if (transaction.currency !== "LMA") {
      issues.push({ kind: "currency_mismatch", severity: "critical", detail: `Transaction ${transaction.publicId} is in ${transaction.currency}, not LMA` });
    }
    if (!transaction.balanced) {
      issues.push({ kind: "unbalanced_transaction", severity: "critical", detail: `Transaction ${transaction.publicId} debits ${transaction.debits} != credits ${transaction.credits}` });
    }
  }
  await brokenTransactions.close();

  return issues;
}

/**
 * Full internal reconciliation: account projections plus the transaction/entry graph. Intended for
 * operational runs (CLI, scheduled job, admin tooling); the customer API surface never calls it.
 * Defaults are strict — production runs must pass no options.
 *
 * Every read shares one snapshot, so a transfer that commits between the scans cannot present as an
 * otherwise-sound ledger having a projection mismatch, an orphaned entry, or an empty transaction.
 * A snapshot session is used outside a transaction deliberately: the scans are read-only and may run
 * for as long as the ledger is large, which a transaction's lifetime would not permit.
 */
export async function reconcileLedger(input: {
  collections: Collections;
  options?: ReconcileOptions;
  mongoClient?: MongoClient;
}): Promise<{ ok: boolean; issues: ReconciliationIssue[] }> {
  const session = input.mongoClient?.startSession({ snapshot: true });
  try {
    const projectionIssues = await reconcileAccountProjections(session ? { collections: input.collections, session } : { collections: input.collections });
    // Sequential, not concurrent: a session is a single coherent channel, and the snapshot holds
    // whichever order the scans run in.
    const transactionIssues = await reconcileLedgerTransactions({
      collections: input.collections,
      ...(input.options ? { options: input.options } : {}),
      ...(session ? { session } : {}),
    });
    const issues = [...projectionIssues, ...transactionIssues];
    return { ok: issues.length === 0, issues };
  } finally {
    await session?.endSession();
  }
}
