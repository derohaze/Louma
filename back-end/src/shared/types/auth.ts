import type { ObjectId } from "mongodb";

export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
export const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const PENDING_2FA_TTL_MS = 5 * 60 * 1000;
/**
 * The RFC 6238 time step, in seconds. It is what a consumed authenticator code is recorded against:
 * one accepted step authorises exactly one financial operation, no matter how many requests race.
 */
export const TOTP_PERIOD_SECONDS = 30;
/**
 * How long a consumed authenticator step is remembered, in milliseconds.
 *
 * Only replay inside the accepted window matters for correctness — the row is inserted in the same
 * transaction as the money it authorised — so the record is purely audit after thirty seconds. A
 * week keeps the trail long enough to correlate with the security log (which is kept for months)
 * without keeping every step of every account forever.
 */
export const TWO_FACTOR_USE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export type AccountStatus = "active" | "suspended";
export type SessionStatus = "active" | "pending_two_factor" | "revoked";

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

/**
 * Which financial surface a consumed authenticator step belonged to. Scoped so a login-time code
 * and a transfer-time code are separate consumption windows (see `consumeTransferProof`).
 */
export type TwoFactorUsePurpose = "transfer";

/**
 * One accepted authenticator time step, consumed. The unique index on
 * `(ownerUserId, purpose, timeStep)` is the database guarantee that an accepted code cannot authorise
 * a second financial operation inside the same step — not a check-then-insert.
 */
export interface TwoFactorUseRecord {
  _id: ObjectId;
  ownerUserId: string;
  purpose: TwoFactorUsePurpose;
  /** RFC 6238 step the accepted code belonged to: floor(epoch / TOTP_PERIOD_SECONDS). */
  timeStep: number;
  /** The intent this step authorised, so a step can never be spent on a different transfer. */
  intentHash: string;
  correlationId: string;
  createdAt: Date;
  /** TTL anchor. Never used for validity: the accepted step is decided by the server clock. */
  retainUntil: Date;
}

export interface NotificationRecord {
  _id: ObjectId;
  ownerUserId: string;
  kind: string;
  title: string;
  body: string;
  /**
   * Structured money-movement params for transfer kinds, so clients can render the notice in
   * the reader's language. Title/body stay the English rendering as the fallback for notices
   * written before this field existed and for kinds without params. Absent on old rows.
   */
  data?: NotificationData | null;
  readAt: Date | null;
  createdAt: Date;
}

/** Bounded, array-free params behind a transfer notice: minor-unit integers plus one address. */
export interface NotificationData {
  direction: "sent" | "received";
  /** Gross amount for a sent transfer, net amount for a received one. */
  amountMinor: number;
  /** Zero on received notices: the sender's fee is not the recipient's business. */
  feeMinor: number;
  counterpartyAddress: string;
}

export interface PublicUser {
  id: string;
  email: string;
  displayName: string;
  country: string | null;
  emailVerifiedAt: string | null;
  createdAt: string;
}
