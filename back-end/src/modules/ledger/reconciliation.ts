import type { Collections } from "../../infrastructure/mongodb/collections.js";
import type { ReconciliationIssue } from "../../shared/types.js";

/**
 * Internal financial reconciliation. Not a public or customer-facing surface: it exists so the
 * ledger (the authoritative record) can be checked against its projections without a customer ever
 * discovering the discrepancy first. Every check is a plain read-model scan — the tool never writes,
 * so running it is always safe.
 *
 * The batch sizes are bounded on purpose: this must never load a whole collection into memory,
 * including on a database that has grown for years.
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
 * projection is required to match: the signed sum of entries on the account's normal side.
 */
async function ledgerDerivedBalance(collections: Collections, account: { publicId: string; accountType: string }): Promise<number> {
  const multiplier = normalSideMultiplier(account.accountType);
  let total = 0;
  const cursor = collections.ledgerEntries.find({ ledgerAccountId: account.publicId }, { batchSize: SCAN_BATCH_SIZE });
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
export async function reconcileAccountProjections(input: { collections: Collections }): Promise<ReconciliationIssue[]> {
  const issues: ReconciliationIssue[] = [];
  let cursor = input.collections.ledgerAccounts.find({}, { batchSize: SCAN_BATCH_SIZE });
  while (await cursor.hasNext()) {
    const account = await cursor.next();
    if (!account) break;
    if (account.balanceMinor < 0) {
      issues.push({ kind: "negative_balance", severity: "critical", detail: `Account ${account.publicId} (${account.accountType}) has a negative projection: ${account.balanceMinor}` });
    }
    const derived = await ledgerDerivedBalance(input.collections, account);
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

/**
 * Checks the transactions/entries relationship: every transaction has balanced entries, every entry
 * references an existing transaction and account, transaction ids are unique, and both collections
 * speak the same single currency.
 */
export async function reconcileLedgerTransactions(input: { collections: Collections; options?: ReconcileOptions }): Promise<ReconciliationIssue[]> {
  const issues: ReconciliationIssue[] = [];

  // Transaction ids and currencies, plus the set every entry is validated against.
  const transactionIds = new Set<string>();
  const currencyByTransaction = new Map<string, string>();
  let seenDuplicate = false;
  let txCursor = input.collections.transactions.find({}, { batchSize: SCAN_BATCH_SIZE, projection: { publicId: 1, currency: 1 } });
  while (await txCursor.hasNext()) {
    const transaction = await txCursor.next();
    if (!transaction) break;
    if (transactionIds.has(transaction.publicId)) {
      if (!seenDuplicate) {
        issues.push({ kind: "duplicate_transaction", severity: "critical", detail: `Transaction publicId ${transaction.publicId} exists more than once` });
        seenDuplicate = true;
      }
      continue;
    }
    transactionIds.add(transaction.publicId);
    currencyByTransaction.set(transaction.publicId, transaction.currency);
  }
  await txCursor.close();

  // Accounts: publicId -> currency, for reference validation.
  const accountCurrencies = new Map<string, string>();
  let accountCursor = input.collections.ledgerAccounts.find({}, { batchSize: SCAN_BATCH_SIZE, projection: { publicId: 1, currency: 1 } });
  while (await accountCursor.hasNext()) {
    const account = await accountCursor.next();
    if (!account) break;
    accountCurrencies.set(account.publicId, account.currency);
  }
  await accountCursor.close();

  // Entries: sum them per transaction, and check their references.
  const debitTotalByTransaction = new Map<string, number>();
  const creditTotalByTransaction = new Map<string, number>();
  const lineCountByTransaction = new Map<string, number>();
  let entryCursor = input.collections.ledgerEntries.find({}, { batchSize: SCAN_BATCH_SIZE });
  while (await entryCursor.hasNext()) {
    const entry = await entryCursor.next();
    if (!entry) break;

    if (!transactionIds.has(entry.transactionId) && !isExcludedEntry(entry, input.options?.excludeCorrelationIdPrefixes)) {
      issues.push({ kind: "orphan_entry", severity: "critical", detail: `Ledger entry ${entry.publicId} references missing transaction ${entry.transactionId}` });
    }
    const accountCurrency = accountCurrencies.get(entry.ledgerAccountId);
    if (accountCurrency === undefined) {
      issues.push({ kind: "invalid_reference", severity: "critical", detail: `Ledger entry ${entry.publicId} references missing account ${entry.ledgerAccountId}` });
    } else if (accountCurrency !== entry.currency) {
      issues.push({ kind: "currency_mismatch", severity: "critical", detail: `Ledger entry ${entry.publicId} is ${entry.currency} but account ${entry.ledgerAccountId} holds ${accountCurrency}` });
    }

    debitTotalByTransaction.set(entry.transactionId, (debitTotalByTransaction.get(entry.transactionId) ?? 0) + (entry.side === "debit" ? entry.amountMinor : 0));
    creditTotalByTransaction.set(entry.transactionId, (creditTotalByTransaction.get(entry.transactionId) ?? 0) + (entry.side === "credit" ? entry.amountMinor : 0));
    lineCountByTransaction.set(entry.transactionId, (lineCountByTransaction.get(entry.transactionId) ?? 0) + 1);
  }
  await entryCursor.close();

  // Every transaction must exist, be balanced, single-currency, and carry at least two lines.
  let txCursor2 = input.collections.transactions.find({}, { batchSize: SCAN_BATCH_SIZE });
  while (await txCursor2.hasNext()) {
    const transaction = await txCursor2.next();
    if (!transaction) break;
    const lines = lineCountByTransaction.get(transaction.publicId) ?? 0;
    if (lines === 0) {
      issues.push({ kind: "empty_transaction", severity: "critical", detail: `Transaction ${transaction.publicId} has no ledger entries` });
      continue;
    }
    if (transaction.currency !== "LMA") {
      issues.push({ kind: "currency_mismatch", severity: "critical", detail: `Transaction ${transaction.publicId} is in ${transaction.currency}, not LMA` });
    }
    const debits = debitTotalByTransaction.get(transaction.publicId) ?? 0;
    const credits = creditTotalByTransaction.get(transaction.publicId) ?? 0;
    if (debits !== credits) {
      issues.push({ kind: "unbalanced_transaction", severity: "critical", detail: `Transaction ${transaction.publicId} debits ${debits} != credits ${credits}` });
    }
  }
  await txCursor2.close();

  return issues;
}

/**
 * Full internal reconciliation: account projections plus the transaction/entry graph. Intended for
 * operational runs (CLI, scheduled job, admin tooling); the customer API surface never calls it.
 * Defaults are strict — production runs must pass no options.
 */
export async function reconcileLedger(input: { collections: Collections; options?: ReconcileOptions }): Promise<{ ok: boolean; issues: ReconciliationIssue[] }> {
  const [projectionIssues, transactionIssues] = await Promise.all([
    reconcileAccountProjections(input),
    reconcileLedgerTransactions(input),
  ]);
  const issues = [...projectionIssues, ...transactionIssues];
  return { ok: issues.length === 0, issues };
}
