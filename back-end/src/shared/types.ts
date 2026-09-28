import type { ObjectId } from "mongodb";

export const CURRENCY = "LMA";
export const MONEY_DECIMALS = 4;
export const MONEY_SCALE = 10_000;
/**
 * The largest amount a single transfer may carry, in minor units.
 *
 * There is no longer a product ceiling here: a wallet must be able to move any amount it can hold,
 * so the only bound left is the one the arithmetic itself imposes. Money is an exact integer of
 * minor units, and a JavaScript number — and therefore a BSON number — represents every integer up
 * to 2^53 exactly.
 *
 * This is the largest whole amount below that boundary. Stopping at a whole amount leaves slack for
 * the fee's rounding step (it adds half a minor unit before dividing), so every intermediate the
 * money arithmetic produces — the fee, the recipient's net, each ledger line — stays an exact
 * integer rather than relying on a rounding that is itself unrepresentable.
 */
export const MAX_TRANSFER_MINOR = Math.floor(Number.MAX_SAFE_INTEGER / MONEY_SCALE) * MONEY_SCALE;
export const MIN_TRANSFER_MINOR = 1;
export const FEE_PERCENT = 1;
export const MAX_NOTE_LENGTH = 240;
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
export const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const PENDING_2FA_TTL_MS = 5 * 60 * 1000;

export type AccountStatus = "active" | "suspended";
export type WalletStatus = "active" | "frozen";
export type SessionStatus = "active" | "pending_two_factor" | "revoked";
export type LedgerSide = "debit" | "credit";
export type TransactionDirection = "sent" | "received";
/**
 * Offline (non-customer) ledger account types. None of them is owned by a wallet, none is reachable
 * through a customer endpoint, and no public API can post to them: they exist so every LMA in the
 * system has a ledger home — revenue taken in, and currency issued from a controlled source.
 */
export type SystemAccountType = "fee_revenue" | "system_treasury";

/**
 * The largest amount a single ledger line may carry, in minor units. It equals the maximum transfer
 * amount — the largest movement the product can produce — so every financial document (account
 * projection, ledger entry, transaction amount) is bounded by it, which keeps every persisted money
 * integer inside the safe-integer range no matter how many operations land.
 */
export const LEDGER_AMOUNT_MAX_MINOR = MAX_TRANSFER_MINOR;

/**
 * The largest value an account projection may hold, in minor units. Unlike a single ledger line
 * (bounded by `LEDGER_AMOUNT_MAX_MINOR`, the largest movement the product can produce), a projection
 * accumulates every movement that lands on the account, so it is bounded by the exact-integer range
 * instead: a wallet or the fee account must not hit a ceiling just because it has been used a lot.
 */
export const LEDGER_BALANCE_MAX_MINOR = Number.MAX_SAFE_INTEGER;

/**
 * Where an account signed up from: the connecting address, captured with the account, plus whatever
 * the ipinfo.io lookup reports for it moments later. The country a person *chooses* is a different
 * field (`profile.country`), because a chosen country and an observed country are not the same fact.
 */
export interface SignupLocation {
  ipAddress: string;
  city: string | null;
  region: string | null;
  country: string | null;
  org: string | null;
  timezone: string | null;
  capturedAt: Date;
  /** Null until the background lookup has run; it stays null when the lookup is disabled. */
  resolvedAt: Date | null;
}

export interface UserRecord {
  _id: ObjectId;
  publicId: string;
  email: string;
  passwordHash: string;
  profile: { displayName: string; country: string | null };
  signupLocation: SignupLocation | null;
  status: AccountStatus;
  emailVerifiedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

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
}

export interface TransactionRecord {
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
   */
  participants: string[];
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

export interface SessionRecord {
  _id: ObjectId;
  publicId: string;
  ownerUserId: string;
  refreshTokenHash: string | null;
  previousRefreshTokenHash: string | null;
  status: SessionStatus;
  twoFactorAttempts: number;
  userAgent: string | null;
  createdAt: Date;
  lastActiveAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
}

export interface SecurityEventRecord {
  _id: ObjectId;
  publicId: string;
  ownerUserId: string | null;
  sessionId: string | null;
  eventType: string;
  outcome: "success" | "failure";
  metadata: Record<string, string | number | boolean | null>;
  correlationId: string;
  createdAt: Date;
}

export interface TwoFactorCredentialRecord {
  _id: ObjectId;
  ownerUserId: string;
  encryptedSecret: string;
  secretIv: string;
  secretAuthTag: string;
  pendingExpiresAt: Date | null;
  enabledAt: Date | null;
  recoveryCodeHashes: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface TransferPasswordCredentialRecord {
  _id: ObjectId;
  ownerUserId: string;
  passwordHash: string;
  changedAt: Date;
}

export interface NotificationRecord {
  _id: ObjectId;
  ownerUserId: string;
  kind: string;
  title: string;
  body: string;
  readAt: Date | null;
  createdAt: Date;
}

export interface PublicUser {
  id: string;
  email: string;
  displayName: string;
  country: string | null;
  emailVerifiedAt: string | null;
  createdAt: string;
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
