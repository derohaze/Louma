import type { ObjectId } from "mongodb";
import { CURRENCY } from "./money.js";

export type WalletStatus = "active" | "frozen";
export type LedgerSide = "debit" | "credit";
export type TransactionDirection = "sent" | "received";
/**
 * Offline (non-customer) ledger account types. None of them is owned by a wallet, none is reachable
 * through a customer endpoint, and no public API can post to them: they exist so every LMA in the
 * system has a ledger home — revenue taken in, and currency issued from a controlled source.
 */
export type SystemAccountType = "fee_revenue" | "system_treasury";

export interface WalletRecord {
  _id: ObjectId;
  publicId: string;
  address: string;
  addressNormalized: string;
  ownerUserId: string;
  status: WalletStatus;
  /**
   * Write-conflict guard for wallet-affecting financial operations, not a balance: a transfer
   * increments it inside its transaction and refuses to commit when the increment did not land,
   * which makes a freeze that races a transfer serialize against it. It carries no money meaning —
   * balances live on the ledger account and are explained by the ledger entries.
   */
  financialVersion: number;
  createdAt: Date;
  updatedAt: Date;
  customAddressChangedAt: Date | null;
  customAddress: string | null;
  customAddressNormalized: string | null;
}

export interface LedgerAccountRecord {
  _id: ObjectId;
  publicId: string;
  /** Null for offline accounts (fee revenue, treasury), which belong to no wallet. */
  walletId: string | null;
  accountType: "wallet" | SystemAccountType;
  currency: typeof CURRENCY;
  /**
   * Concurrency-safe projection of the account's ledger-derived balance, kept in the same
   * transaction as the entries that produce it. The ledger entries remain authoritative: a
   * reconciler can always recompute this number from them alone. Never negative for any account
   * type — issuance credits the user side and debits the treasury side, it never overdraws it.
   */
  balanceMinor: number;
  createdAt: Date;
}

export interface LedgerEntryRecord {
  _id: ObjectId;
  publicId: string;
  transactionId: string;
  lineNumber: number;
  walletId: string | null;
  ledgerAccountId: string;
  side: LedgerSide;
  amountMinor: number;
  currency: typeof CURRENCY;
  correlationId: string;
  createdAt: Date;
}

export interface ReconciliationIssue {
  kind: "projection_mismatch" | "negative_balance" | "unbalanced_transaction" | "empty_transaction" | "orphan_entry" | "duplicate_transaction" | "currency_mismatch" | "invalid_reference";
  severity: "error" | "critical";
  detail: string;
  /** Set on `orphan_entry`: the ids the finding is about, so callers can attribute it without parsing `detail`. */
  entryPublicId?: string;
  transactionId?: string;
}

/**
 * The financial journal: one header per money movement, of any kind.
 *
 * `transactions` is the single authoritative journal of every financial event — a customer
 * transfer today, a mining issuance as well. It is a discriminated union on `type`, never a
 * bag of optional fields: a transfer carries its sender/receiver/idempotency triple, a mining
 * issuance carries its cycle/sequence/treasury triple, and the MongoDB validator enforces the
 * same shape the type system describes, so the database rejects a header the code could not read.
 *
 * Every header has ledger entries under the same `publicId` (see ledger_entries.transactionId):
 * a header without entries is an empty transaction the reconciler reports, and entries without
 * a header are orphans it reports. The journal and the ledger are checked against each other —
 * neither is trusted alone.
 */
export type TransactionRecord = TransferTransactionRecord | MiningTransactionRecord;

export interface TransferTransactionRecord {
  _id: ObjectId;
  publicId: string;
  /** The customer-facing movement identifier; the API also accepts it for lookups. */
  transferId: string;
  senderUserId: string;
  receiverUserId: string;
  senderWalletId: string;
  receiverWalletId: string;
  /**
   * The account ids on both sides, in the order the history index reads them. The wallet asks for
   * one account's history as a single page across both directions, and a list of the participants
   * answers that from one index instead of an `$or` over two whose halves have to be sorted together.
   * Exactly the two parties, never more: history pagination assumes a bounded pair.
   */
  participants: [string, string];
  senderAddress: string;
  receiverAddress: string;
  amountMinor: number;
  feeMinor: number;
  netAmountMinor: number;
  currency: typeof CURRENCY;
  /** Completed-at-write today; the state machine has room for pending states if async flows come. */
  status: "completed";
  type: "transfer";
  note: string;
  idempotencyKey: string;
  requestFingerprint: string;
  correlationId: string;
  balanceAfterMinor: number;
  createdAt: Date;
  completedAt: Date;
}

/**
 * The journal header of one mining settlement: an issuance, not a transfer.
 *
 * This is the authoritative financial record of a mining reward — the former `mining_settlements`
 * document was merged into this shape (see ADR-003). The settlement sequence is the idempotency
 * boundary: `(miningSessionId, sequenceNumber)` is unique per cycle and `idempotencyKey`
 * (`mining:<session>:<sequence>`) is unique overall, so retries converge on the posted header
 * instead of issuing twice. It carries no sender/receiver and never surfaces in transfer history.
 */
export interface MiningTransactionRecord {
  _id: ObjectId;
  publicId: string;
  type: "mining";
  currency: typeof CURRENCY;
  status: "completed";
  ownerUserId: string;
  walletId: string;
  miningSessionId: string;
  sequenceNumber: number;
  amountMinor: number;
  treasuryAccountId: string;
  walletAccountId: string;
  idempotencyKey: string;
  correlationId: string;
  createdAt: Date;
  completedAt: Date;
}

export function isTransferTransaction(record: TransactionRecord): record is TransferTransactionRecord {
  return record.type === "transfer";
}

export function isMiningTransaction(record: TransactionRecord): record is MiningTransactionRecord {
  return record.type === "mining";
}

/**
 * Operator controls for the financial surfaces, held as one document so an incident can stop writes
 * without a deploy. Absence of the document means "not paused": a database that has never been told
 * to stop must serve transfers.
 */
export interface FinancialControlsRecord {
  _id: "global";
  transfersPaused: boolean;
  payoutsPaused: boolean;
  reason: string;
  updatedAt: Date;
  updatedBy: string;
}

export interface PublicWallet {
  id: string;
  address: string;
  status: WalletStatus;
  balance: string;
  currency: typeof CURRENCY;
  createdAt: string;
  customAddressChangedAt: string | null;
  customAddress: string | null;
}

export interface PublicTransaction {
  id: string;
  transferId: string;
  direction: TransactionDirection;
  counterpartyAddress: string;
  amount: string;
  fee: string;
  netAmount: string;
  balanceAfter?: string;
  currency: typeof CURRENCY;
  status: "completed";
  type: "transfer";
  note: string;
  correlationId: string;
  createdAt: string;
  completedAt: string;
}
