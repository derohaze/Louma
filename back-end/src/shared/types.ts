import type { ObjectId } from "mongodb";

export const CURRENCY = "LMA";
export const MONEY_DECIMALS = 4;
export const MONEY_SCALE = 10_000;
export const MAX_TRANSFER_MINOR = 10_000_000_000;
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

export interface UserRecord {
  _id: ObjectId;
  publicId: string;
  email: string;
  passwordHash: string;
  profile: { displayName: string; country: string | null };
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
  createdAt: Date;
  updatedAt: Date;
  customAddressChangedAt: Date | null;
  customAddress: string | null;
  customAddressNormalized: string | null;
}

export interface LedgerAccountRecord {
  _id: ObjectId;
  publicId: string;
  walletId: string | null;
  accountType: "wallet" | "fee_revenue";
  currency: typeof CURRENCY;
  /** Normal-side balance is a concurrency-safe projection; the ledger entries remain authoritative. */
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

export interface TransactionRecord {
  _id: ObjectId;
  publicId: string;
  transferId: string;
  senderUserId: string;
  receiverUserId: string;
  senderWalletId: string;
  receiverWalletId: string;
  senderAddress: string;
  receiverAddress: string;
  amountMinor: number;
  feeMinor: number;
  netAmountMinor: number;
  currency: typeof CURRENCY;
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

export interface PasswordResetTokenRecord {
  _id: ObjectId;
  ownerUserId: string;
  tokenHash: string;
  createdAt: Date;
  expiresAt: Date;
  usedAt: Date | null;
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
