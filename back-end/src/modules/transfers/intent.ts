import { createHash } from "node:crypto";
import type { Collections } from "../../infrastructure/mongodb/collections.js";
import { formatMoney } from "../ledger/money.js";
import { badRequest, conflict, forbidden, notFound } from "../../shared/errors.js";
import {
  MAX_NOTE_LENGTH,
  type PublicTransferAuthorization,
  type PublicTransaction,
  type TransactionDirection,
  isTransferTransaction,
  type TransferAuthorizationRecord,
  type TransferIntent,
  type TransferTransactionRecord,
} from "../../shared/types.js";

export const MAX_RECIPIENT_LENGTH = 128;
/** A canonical Louma wallet address or a public `@handle`. The client checks the same shape. */
export const RECIPIENT_PATTERN = /^(?:LMA[0-7][0-9A-HJKMNP-TV-Z]{27}|@[a-z0-9_]{4,24})$/i;
/** A server-issued approval id: the uuid the preview endpoint mints. */
const AUTHORIZATION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/**
 * How many failed transfer-authorization proofs one account may produce inside the window below
 * before further attempts are refused outright.
 *
 * Ten, over fifteen minutes, is sized from the legitimate user: a person mistypes a password or an
 * authenticator code once or twice, and a code from the previous step fails every time until the
 * clock moves on — all of which fit comfortably. An attacker guessing six digits or a password is
 * held to ten attempts per quarter hour per account, which makes the search hopeless (~1e-5 of the
 * 10^6 code space per window) while remaining invisible to the account's owner. The failure events
 * this counts are the same ones the security page already records, so the limit costs no new write.
 */
const AUTHORIZATION_FAILURE_WINDOW_MS = 15 * 60 * 1000;
const AUTHORIZATION_FAILURE_LIMIT = 10;

/**
 * The canonical hash of one transfer intent. It is the idempotency fingerprint *and* the binding
 * between an approval and the money it authorised, so exactly the fields that decide what moves are
 * in it: the recipient wallet, the three amounts, the currency, and the note. Nothing derived — the
 * fees are recomputed from the amount and checked against the stored pair before anything commits —
 * and nothing cosmetic: the addresses the ledger uses are the wallet ids, not the spelling typed.
 */
export function intentHashOf(intent: TransferIntent, senderWalletId: string): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        senderWalletId,
        recipientWalletId: intent.recipientWalletId,
        recipientUserId: intent.recipientUserId,
        recipientAddress: intent.recipientAddress.toLowerCase(),
        amountMinor: intent.amountMinor,
        feeMinor: intent.feeMinor,
        netAmountMinor: intent.netAmountMinor,
        currency: intent.currency,
        note: intent.note,
      }),
    )
    .digest("hex");
}

export function publicAuthorization(record: TransferAuthorizationRecord): PublicTransferAuthorization {
  return {
    id: record.publicId,
    expiresAt: record.expiresAt.toISOString(),
    intent: {
      recipientAddress: record.intent.recipientAddress,
      amount: formatMoney(record.intent.amountMinor),
      fee: formatMoney(record.intent.feeMinor),
      netAmount: formatMoney(record.intent.netAmountMinor),
      currency: record.intent.currency,
    },
  };
}

/**
 * Fetches the approval a transfer is about to consume without enforcing consumed/expired.
 * Usability is enforced after the idempotency replay check in `createTransfer`, so a retry
 * after a committed transfer replays it instead of answering `transfer_authorization_used`.
 * An approval that belongs to another account is answered exactly like one that does not
 * exist, so the endpoint cannot be used to probe for another account's approvals.
 */
export async function loadTransferAuthorization(input: {
  collections: Collections;
  ownerUserId: string;
  authorizationId: unknown;
}): Promise<TransferAuthorizationRecord> {
  if (typeof input.authorizationId !== "string" || !AUTHORIZATION_ID_PATTERN.test(input.authorizationId)) {
    throw badRequest("invalid_authorization", "Confirm the recipient and the amount before sending.");
  }
  const record = await input.collections.transferAuthorizations.findOne({ publicId: input.authorizationId });
  if (!record || record.ownerUserId !== input.ownerUserId) throw notFound();
  return record;
}

/**
 * Refuses further transfer-authorization attempts for an account that has just burned through its
 * allowance, and records the refusal. The count is a read of the security log this API already
 * writes (indexed by owner and time), so no counter document and no extra write is involved; the
 * race between two simultaneous guesses is bounded by the limit rather than exact, which is the
 * right trade for a rate limit on a secret.
 */
export async function assertTransferAuthorizationAttemptsRemain(input: { collections: Collections; ownerUserId: string }): Promise<void> {
  const since = new Date(Date.now() - AUTHORIZATION_FAILURE_WINDOW_MS);
  const failures = await input.collections.securityEvents.countDocuments({
    ownerUserId: input.ownerUserId,
    outcome: "failure",
    createdAt: { $gt: since },
    eventType: "transfer_rejected",
    // Only guesses count. A stale approval, a replayed code, or a credential replaced mid-flight is
    // the system working as intended and must not push an honest account toward a lockout.
    "metadata.reason": { $in: ["invalid_transfer_password", "invalid_two_factor_code", "invalid_transfer_authorization"] },
  });
  if (failures < AUTHORIZATION_FAILURE_LIMIT) return;
  throw forbidden("transfer_authorization_locked", "Too many failed authorization attempts. Try again later.");
}

/**
 * The replay lookup, shared by the pre-check, the catch paths, and the post-commit read. A hit whose
 * fingerprint differs is idempotency-key reuse and is rejected from here too, so every path answers
 * the reuse attempt the same way.
 */
export async function findCommittedTransfer(input: {
  collections: Collections;
  ownerUserId: string;
  senderWalletId: string;
  idempotencyKey: string;
  requestFingerprint: string;
}): Promise<{ record: TransferTransactionRecord; public: PublicTransaction & { balanceAfter: string } } | null> {
  const duplicate = await input.collections.transactions.findOne({ type: "transfer", senderWalletId: input.senderWalletId, idempotencyKey: input.idempotencyKey });
  if (!duplicate) return null;
  if (!isTransferTransaction(duplicate)) return null;
  if (duplicate.requestFingerprint !== input.requestFingerprint) throw conflict("idempotency_key_reused", "This idempotency key was already used for a different transfer.");
  return {
    record: duplicate,
    public: publicTransaction(duplicate, input.ownerUserId, duplicate.balanceAfterMinor) as PublicTransaction & { balanceAfter: string },
  };
}

export function publicTransaction(transaction: TransferTransactionRecord, ownerUserId: string, balanceAfterMinor?: number): PublicTransaction & { balanceAfter?: string } {
  const direction: TransactionDirection = transaction.senderUserId === ownerUserId ? "sent" : "received";
  /**
   * `balanceAfterMinor` is the *sender's* balance at the time of the transfer, which is only ever
   * the caller's own balance when the caller sent it. Sending it to the recipient would publish the
   * other side's balance, so a received transfer simply has no `balanceAfter`.
   */
  const ownBalanceAfter = direction === "sent" ? balanceAfterMinor ?? transaction.balanceAfterMinor : undefined;
  return {
    id: transaction.publicId,
    transferId: transaction.transferId,
    direction,
    counterpartyAddress: direction === "sent" ? transaction.receiverAddress : transaction.senderAddress,
    amount: formatMoney(transaction.amountMinor),
    fee: formatMoney(transaction.feeMinor),
    netAmount: formatMoney(transaction.netAmountMinor),
    ...(ownBalanceAfter === undefined ? {} : { balanceAfter: formatMoney(ownBalanceAfter) }),
    currency: transaction.currency,
    status: transaction.status,
    type: transaction.type,
    note: transaction.note,
    correlationId: transaction.correlationId,
    createdAt: transaction.createdAt.toISOString(),
    completedAt: transaction.completedAt.toISOString(),
  };
}

export function parseRecipientAddress(value: unknown): string {
  if (typeof value !== "string" || value.length > MAX_RECIPIENT_LENGTH) throw new Error("Enter a valid receiving address.");
  const address = value.trim();
  if (!RECIPIENT_PATTERN.test(address)) {
    throw badRequest("invalid_recipient", "Enter a valid Louma wallet address or @handle.");
  }
  return address.slice(0, 3).toUpperCase() === "LMA" ? address.toUpperCase() : `@${address.replace(/^@/, "").toLowerCase()}`;
}

/**
 * Shows just enough of the recipient's name for the sender to recognise who they are paying, and
 * never enough to harvest the name itself: only the first and last characters survive.
 */
export function maskDisplayName(displayName: string): string | null {
  const characters = [...displayName.trim()];
  if (characters.length === 0) return null;
  if (characters.length <= 2) return `${characters[0]}•••`;
  return `${characters[0]}•••${characters.at(-1)}`;
}

export function normalizeNote(value: unknown): string {
  return typeof value === "string" ? value.replace(/[ -]/g, "").trim().slice(0, MAX_NOTE_LENGTH) : "";
}
