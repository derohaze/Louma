import type { ObjectId } from "mongodb";
import { CURRENCY } from "./money.js";

/**
 * How long a server-issued transfer authorization stays usable, in milliseconds.
 *
 * Ten minutes is the window between the sender seeing the quote the server computed (recipient,
 * amount, fee, net) and proving a transfer credential over it. It is long enough for a slow
 * authenticator entry and short enough that an authorization left behind on a shared device is not
 * a standing licence to move that amount later. Validity is enforced by the conditional consume in
 * the transfer's own transaction, never by a timer.
 */
export const TRANSFER_AUTHORIZATION_TTL_MS = 10 * 60 * 1000;
/**
 * How long a consumed or expired transfer authorization is kept for audit, in milliseconds.
 *
 * The row is the only record tying a factor proof to the exact intent it authorised, so it outlives
 * its own validity by a month: an incident review can still answer "what did this approval cover?"
 * long after the transfer settled. Short enough that the collection stays proportional to a month of
 * quoting rather than growing for the life of the deployment.
 */
export const TRANSFER_AUTHORIZATION_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * The financially significant content of one transfer, as the server computed it.
 *
 * Every field here is derived server-side — the recipient from the canonical address the wallet
 * holds, the amounts from the ledger's own arithmetic — and the authorization names exactly this
 * object, so a request cannot authorise one intent and execute another.
 */
export interface TransferIntent {
  recipientWalletId: string;
  recipientUserId: string;
  /** The immutable canonical address used by the ledger. */
  recipientAddress: string;
  /** Present when preview used an alias; must remain active at execution time. */
  recipientCustomAddress?: string;
  amountMinor: number;
  feeMinor: number;
  netAmountMinor: number;
  currency: typeof CURRENCY;
  note: string;
}

/**
 * A server-issued, single-use approval of one transfer intent.
 *
 * It is the challenge half of the transfer flow: the preview endpoint computes the intent and issues
 * one of these, the sender proves a credential over it, and the transfer's own transaction consumes
 * it atomically with the money. Because consumption happens inside the financial transaction, a
 * transfer that fails does not burn the approval — and two requests cannot both execute one.
 *
 * The credential versions are the snapshot the proof was taken under: a transfer refuses to settle
 * when the password or the second factor was replaced after the proof (see setTransferPassword and
 * the two-factor endpoints), which is what stops a transfer in flight from landing under a
 * credential its owner has just revoked.
 */
export interface TransferAuthorizationRecord {
  _id: ObjectId;
  publicId: string;
  ownerUserId: string;
  senderWalletId: string;
  intent: TransferIntent;
  /** sha256 over the canonical intent: the idempotency fingerprint and the mismatch guard. */
  intentHash: string;
  passwordChangedAt: Date | null;
  twoFactorEnabledAt: Date | null;
  consumedAt: Date | null;
  consumedByTransactionPublicId: string | null;
  correlationId: string;
  createdAt: Date;
  expiresAt: Date;
  /** TTL anchor (`expiresAt` + retention). Never used for validity. */
  retainUntil: Date;
}

/** The approval the preview endpoint hands the wizard; the id is what the transfer consumes. */
export interface PublicTransferAuthorization {
  id: string;
  expiresAt: string;
  intent: {
    recipientAddress: string;
    amount: string;
    fee: string;
    netAmount: string;
    currency: typeof CURRENCY;
  };
}
