import { createHash, randomUUID } from "node:crypto";
import { ObjectId } from "mongodb";
import type { MongoClient } from "mongodb";
import type { Collections } from "../../infrastructure/mongodb/collections.js";
import type { AppConfig } from "../../config/env.js";
import { recordSecurityEvent } from "../security/audit.js";
import { consumeTransferCredentialProof, proveTransferCredential, type TransferCredentialProof } from "../security/service.js";
import { ensureFeeAccount, resolveRecipient } from "../wallets/service.js";
import { settleMiningForOwner } from "../mining/service.js";
import { readFinancialControls } from "../financial-controls/service.js";
import { assertBalanced, calculateTransferAmounts, formatMoney, parseMoneyToMinorUnits } from "../ledger/money.js";
import {
  LEDGER_BALANCE_MAX_MINOR,
  TRANSFER_AUTHORIZATION_RETENTION_MS,
  TRANSFER_AUTHORIZATION_TTL_MS,
  type PublicTransferAuthorization,
  type TransferAuthorizationRecord,
  type TransferIntent,
} from "../../shared/types.js";
import { AppError, badRequest, conflict, forbidden, notFound, serviceUnavailable } from "../../shared/errors.js";
import type { PublicTransaction, TransactionDirection, TransactionRecord } from "../../shared/types.js";

const MAX_IDEMPOTENCY_KEY_LENGTH = 128;
const MAX_PAGE_SIZE = 50;
const MAX_RECIPIENT_LENGTH = 128;
/** A Louma wallet address (three groups of four) or a public `@handle`. The client checks the same shape. */
const RECIPIENT_PATTERN = /^(?:LMA(?:-[A-Z0-9]{4}){3}|@[a-z0-9_]{4,24})$/i;
/**
 * Transaction retries are bounded and never blind: each retry first re-reads the idempotency record
 * outside the session, so a retry after an ambiguous commit replays the landed transfer instead of
 * re-executing it. Three attempts cover replica-set elections and primary step-downs without
 * turning a failing database into an infinite loop.
 */
const MAX_TRANSACTION_ATTEMPTS = 3;
const RETRY_BACKOFF_BASE_MS = 20;
/**
 * Retryable server codes for drivers/servers that do not attach error labels (see
 * `isTransientTransactionError`). The driver's `TransientTransactionError` label is authoritative;
 * this set is the conservative fallback.
 */
const TRANSIENT_ERROR_CODES = new Set([6, 7, 63, 64, 89, 91, 134, 189, 197, 216, 226, 241, 251, 256, 261, 262, 276, 286, 9001]);
/** Rejections that are the product working as intended: they belong on the security record. */
const FINANCIAL_REJECTION_CODES = new Set([
  "insufficient_funds",
  "wallet_frozen",
  "wallet_limit_exceeded",
  "self_transfer",
  "transfer_password_changed",
  "invalid_transfer_password",
  "invalid_transfer_authorization",
  "invalid_two_factor_code",
  "transfer_authorization_changed",
  "transfer_authorization_used",
  "transfer_authorization_expired",
  "transfer_authorization_mismatch",
  "two_factor_code_already_used",
  "recovery_code_already_used",
  "transfer_authorization_locked",
  "transfer_conflict",
]);
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

function hasErrorLabel(error: unknown, label: string): boolean {
  if (typeof error !== "object" || error === null) return false;
  const labels = (error as { errorLabels?: unknown }).errorLabels;
  return Array.isArray(labels) && labels.includes(label);
}

function isTransientTransactionError(error: unknown): boolean {
  if (hasErrorLabel(error, "TransientTransactionError")) return true;
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "number" && TRANSIENT_ERROR_CODES.has(code);
}

/** The commit may or may not have landed; only the idempotency record can tell. */
function isUnknownCommitOutcome(error: unknown): boolean {
  return hasErrorLabel(error, "UnknownTransactionCommitOutcome");
}

/**
 * A duplicate key on the idempotency or transfer indexes means a concurrent request with the same
 * logical transfer won the insert race: the loser must converge on the winner's record, not surface
 * an error to a client that did nothing wrong.
 */
function isDuplicateKeyError(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === 11000;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Fires the test-only failure-injection hook; a no-op unless a hook is supplied. */
function maybeAbort(input: { abortSignal?: { throwAt: string } | undefined; point: string }): void {
  if (input.abortSignal?.throwAt === input.point) throw new Error(`Injected failure at ${input.point}`);
}

/**
 * The canonical hash of one transfer intent. It is the idempotency fingerprint *and* the binding
 * between an approval and the money it authorised, so exactly the fields that decide what moves are
 * in it: the recipient wallet, the three amounts, the currency, and the note. Nothing derived — the
 * fees are recomputed from the amount and checked against the stored pair before anything commits —
 * and nothing cosmetic: the addresses the ledger uses are the wallet ids, not the spelling typed.
 */
function intentHashOf(intent: TransferIntent): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
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

function publicAuthorization(record: TransferAuthorizationRecord): PublicTransferAuthorization {
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
 * Loads the approval a transfer is about to consume and refuses every way it can be unusable.
 *
 * This is the cheap, pre-transaction half of the check; the authoritative half is the conditional
 * consume inside the transfer's own transaction, because only there is it atomic with the money. An
 * approval that belongs to another account is answered exactly like one that does not exist, so the
 * endpoint cannot be used to probe for another account's approvals.
 */
async function loadTransferAuthorization(input: {
  collections: Collections;
  ownerUserId: string;
  authorizationId: unknown;
}): Promise<TransferAuthorizationRecord> {
  if (typeof input.authorizationId !== "string" || !AUTHORIZATION_ID_PATTERN.test(input.authorizationId)) {
    throw badRequest("invalid_authorization", "Confirm the recipient and the amount before sending.");
  }
  const record = await input.collections.transferAuthorizations.findOne({ publicId: input.authorizationId });
  if (!record || record.ownerUserId !== input.ownerUserId) throw notFound();
  if (record.consumedAt) {
    throw conflict("transfer_authorization_used", "This transfer was already approved and sent. Confirm the transfer again to send another one.");
  }
  if (record.expiresAt.getTime() <= Date.now()) {
    throw conflict("transfer_authorization_expired", "That approval has expired. Confirm the recipient and the amount again.");
  }
  return record;
}

/**
 * Refuses further transfer-authorization attempts for an account that has just burned through its
 * allowance, and records the refusal. The count is a read of the security log this API already
 * writes (indexed by owner and time), so no counter document and no extra write is involved; the
 * race between two simultaneous guesses is bounded by the limit rather than exact, which is the
 * right trade for a rate limit on a secret.
 */
async function assertTransferAuthorizationAttemptsRemain(input: { collections: Collections; ownerUserId: string }): Promise<void> {
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
async function findCommittedTransfer(input: {
  collections: Collections;
  ownerUserId: string;
  idempotencyKey: string;
  requestFingerprint: string;
}): Promise<{ record: TransactionRecord; public: PublicTransaction & { balanceAfter: string } } | null> {
  const duplicate = await input.collections.transactions.findOne({ senderUserId: input.ownerUserId, idempotencyKey: input.idempotencyKey });
  if (!duplicate) return null;
  if (duplicate.requestFingerprint !== input.requestFingerprint) throw conflict("idempotency_key_reused", "This idempotency key was already used for a different transfer.");
  return {
    record: duplicate,
    public: publicTransaction(duplicate, input.ownerUserId, duplicate.balanceAfterMinor) as PublicTransaction & { balanceAfter: string },
  };
}

function publicTransaction(transaction: TransactionRecord, ownerUserId: string, balanceAfterMinor?: number): PublicTransaction & { balanceAfter?: string } {
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

function parseRecipientAddress(value: unknown): string {
  if (typeof value !== "string" || value.length > MAX_RECIPIENT_LENGTH) throw new Error("Enter a valid receiving address.");
  const address = value.trim();
  if (!RECIPIENT_PATTERN.test(address)) {
    throw badRequest("invalid_recipient", "Enter a valid Louma wallet address or @handle.");
  }
  return address;
}

/**
 * Shows just enough of the recipient's name for the sender to recognise who they are paying, and
 * never enough to harvest the name itself: only the first and last characters survive.
 */
function maskDisplayName(displayName: string): string | null {
  const characters = [...displayName.trim()];
  if (characters.length === 0) return null;
  if (characters.length <= 2) return `${characters[0]}•••`;
  return `${characters[0]}•••${characters.at(-1)}`;
}

/**
 * The staged transfer form's own read: it resolves the address the sender typed and, once an amount
 * is offered, quotes exactly what the ledger would charge for it — and issues the approval the
 * transfer will consume.
 *
 * The tax and the balance the sender confirms are the server's numbers, computed by the same
 * arithmetic the transfer itself uses, instead of the page's own copy of the rule. When an amount is
 * present the read also mints a `transfer_authorizations` row: the canonical recipient, the three
 * amounts, the currency and the note, hashed. That row is the only description of the transfer the
 * sender is asked to approve — the transfer executes *it*, not the request that follows — so the
 * parameters cannot change between the approval the sender gave and the money that moves, however
 * the client is written or whatever it is tricked into sending.
 *
 * Issuing an approval moves no money: it is a promise the server makes to itself about one intent,
 * and it stops existing when it is consumed or expires.
 */
export async function previewTransfer(input: {
  collections: Collections;
  ownerUserId: string;
  recipientAddress: unknown;
  amount?: unknown;
  note?: unknown;
  /** The request the approval is issued for, so the approval can be correlated to it afterwards. */
  requestId: string;
}) {
  const recipientAddress = parseRecipientAddress(input.recipientAddress);
  // Resolving is also the check the sender is asking for: a typo, an address that never existed, or
  // the sender's own wallet all fail here, before any amount is discussed.
  const recipientWallet = await resolveRecipient({ collections: input.collections, address: recipientAddress, senderUserId: input.ownerUserId });
  const recipientOwner = await input.collections.users.findOne({ publicId: recipientWallet.ownerUserId }, { projection: { "profile.displayName": 1 } });
  const recipient = {
    /** The canonical address the transfer will credit — not the spelling the sender typed. */
    address: recipientWallet.customAddress ?? recipientWallet.address,
    displayName: maskDisplayName(recipientOwner?.profile.displayName ?? ""),
  };
  if (input.amount === undefined) return { recipient, quote: null, authorization: null };

  const amounts = calculateTransferAmounts(parseMoneyToMinorUnits(input.amount));
  const note = normalizeNote(input.note);
  const senderWallet = await input.collections.wallets.findOne({ ownerUserId: input.ownerUserId });
  if (!senderWallet) throw notFound();
  const senderAccount = await input.collections.ledgerAccounts.findOne(
    { walletId: senderWallet.publicId, accountType: "wallet", currency: "LMA" },
    { projection: { balanceMinor: 1 } },
  );
  if (!senderAccount) throw new Error("Wallet ledger account is missing");
  const now = new Date();
  const intent: TransferIntent = {
    recipientWalletId: recipientWallet.publicId,
    recipientUserId: recipientWallet.ownerUserId,
    recipientAddress: recipient.address,
    amountMinor: amounts.amountMinor,
    feeMinor: amounts.feeMinor,
    netAmountMinor: amounts.netAmountMinor,
    currency: "LMA",
    note,
  };
  const record: TransferAuthorizationRecord = {
    _id: new ObjectId(),
    publicId: randomUUID(),
    ownerUserId: input.ownerUserId,
    senderWalletId: senderWallet.publicId,
    intent,
    intentHash: intentHashOf(intent),
    // The credential versions the approval was *consumed* under, written by the consume itself:
    // what was proven is a fact about the transfer, not about the quote.
    passwordChangedAt: null,
    twoFactorEnabledAt: null,
    consumedAt: null,
    consumedByTransactionPublicId: null,
    correlationId: input.requestId,
    createdAt: now,
    expiresAt: new Date(now.getTime() + TRANSFER_AUTHORIZATION_TTL_MS),
    retainUntil: new Date(now.getTime() + TRANSFER_AUTHORIZATION_TTL_MS + TRANSFER_AUTHORIZATION_RETENTION_MS),
  };
  await input.collections.transferAuthorizations.insertOne(record);
  return {
    recipient,
    quote: {
      amount: formatMoney(amounts.amountMinor),
      fee: formatMoney(amounts.feeMinor),
      netAmount: formatMoney(amounts.netAmountMinor),
      balance: formatMoney(senderAccount.balanceMinor),
      balanceAfter: formatMoney(Math.max(senderAccount.balanceMinor - amounts.amountMinor, 0)),
      sufficient: senderAccount.balanceMinor >= amounts.amountMinor,
    },
    authorization: publicAuthorization(record),
  };
}

function normalizeNote(value: unknown): string {
  return typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 240) : "";
}

export async function createTransfer(input: {
  collections: Collections;
  mongoClient: MongoClient;
  /**
   * Present on the HTTP path. A transfer spends the wallet's balance, and mined LMA only reaches that
   * balance once it is settled, so the sender's running cycle is settled before the spend is
   * evaluated. Optional so a direct caller that runs no mining (tests, tooling) is unaffected.
   */
  config?: Pick<AppConfig, "mining" | "encryptionKey">;
  ownerUserId: string;
  /** The approval the preview endpoint issued. Required: the transfer executes it, never the body. */
  authorizationId: unknown;
  /** Echoes of the approved intent. They are checked against it, never used to build the transfer. */
  recipientAddress: unknown;
  amount: unknown;
  note?: unknown;
  idempotencyKey: string | undefined;
  transferPassword?: unknown;
  twoFactorCode?: unknown;
  requestId: string;
  /**
   * Failure-injection hook for the integration suite only: production callers never pass it, so it
   * stays undefined on the real path. It fires at fixed points inside the transaction (after the
   * sender debit, after the receiver credit, after the fee posting, before the commit) and throwing
   * from it aborts the transaction — which is how rollback completeness is tested end to end.
   */
  abortSignal?: { throwAt: string } | undefined;
}): Promise<PublicTransaction & { balanceAfter: string; replayed: boolean }> {
  // An operator pause stops money movement before anything is read or written (see
  // financial-controls). A transaction already under way can still commit: the pause is a brake, not
  // a rollback, and everything that commits remains reconcileable.
  const controls = await readFinancialControls(input.collections);
  if (controls.transfersPaused) {
    throw serviceUnavailable("transfers_paused", "Transfers are temporarily paused. Try again later.");
  }
  const idempotencyKey = input.idempotencyKey?.trim();
  if (!idempotencyKey || idempotencyKey.length > MAX_IDEMPOTENCY_KEY_LENGTH || !/^[\x21-\x7e]+$/.test(idempotencyKey)) {
    throw conflict("idempotency_key_required", "A valid Idempotency-Key header is required.");
  }
  const approval = await loadTransferAuthorization({
    collections: input.collections,
    ownerUserId: input.ownerUserId,
    authorizationId: input.authorizationId,
  });
  const intent = approval.intent;
  // The approved amounts are re-derived from the approved amount instead of trusted as stored: the
  // fee rule lives in one place, and a row that somehow disagrees with it cannot unbalance a ledger.
  const amounts = calculateTransferAmounts(intent.amountMinor);
  if (amounts.feeMinor !== intent.feeMinor || amounts.netAmountMinor !== intent.netAmountMinor) {
    throw conflict("transfer_authorization_mismatch", "That approval does not match the transfer it describes. Confirm the transfer again.");
  }
  /**
   * The fingerprint is the approved intent's own hash, so "same key, same parameters" is decided by
   * the same object the money is executed from — not by a second reading of the request body. Reusing
   * a key for a different payment is therefore impossible to miss: the intents differ, so the hashes
   * (and the fingerprints) differ.
   */
  const requestFingerprint = approval.intentHash;
  // The body's echoes of the approved intent are checked, never used: the client cannot introduce a
  // recipient, an amount, or a note the sender did not approve, whether it is a bug or an attacker.
  const requestedRecipient = parseRecipientAddress(input.recipientAddress);
  const requestedAmountMinor = parseMoneyToMinorUnits(input.amount);
  if (requestedAmountMinor !== amounts.amountMinor || normalizeNote(input.note) !== intent.note) {
    throw conflict("transfer_authorization_mismatch", "This transfer does not match the one you approved. Confirm the recipient and the amount again.");
  }

  const prior = await input.collections.transactions.findOne({ senderUserId: input.ownerUserId, idempotencyKey });
  if (prior) {
    if (prior.requestFingerprint !== requestFingerprint) throw conflict("idempotency_key_reused", "This idempotency key was already used for a different transfer.");
    return { ...publicTransaction(prior, input.ownerUserId, prior.balanceAfterMinor) as PublicTransaction & { balanceAfter: string }, balanceAfter: formatMoney(prior.balanceAfterMinor), replayed: true };
  }
  // The recipient is the wallet the approval named, not whatever the address resolves to now: a
  // custom address that moved between the quote and the send cannot redirect the money. When the
  // client echoes the typed spelling instead of the canonical address, it must resolve to the same
  // wallet, so "pay the address I approved" stays true in every spelling.
  let recipientWallet = await input.collections.wallets.findOne({ publicId: intent.recipientWalletId });
  if (!recipientWallet) throw notFound();
  if (requestedRecipient.toLowerCase() !== intent.recipientAddress.toLowerCase()) {
    const resolved = await resolveRecipient({ collections: input.collections, address: requestedRecipient, senderUserId: input.ownerUserId });
    if (resolved.publicId !== intent.recipientWalletId) {
      throw conflict("transfer_authorization_mismatch", "The recipient changed after it was approved. Confirm the transfer again.");
    }
    recipientWallet = resolved;
  }
  if (recipientWallet.ownerUserId !== intent.recipientUserId) {
    throw conflict("transfer_authorization_mismatch", "The recipient changed after it was approved. Confirm the transfer again.");
  }
  await assertTransferAuthorizationAttemptsRemain({ collections: input.collections, ownerUserId: input.ownerUserId });
  /**
   * The credential is proven now, and consumed inside the transaction below. Nothing is written here:
   * a proof that is followed by a rejection, a conflict, or a failed commit leaves the account's
   * password and authenticator exactly as usable as they were.
   */
  const proof: TransferCredentialProof = await proveTransferCredential({
    collections: input.collections,
    config: input.config,
    ownerUserId: input.ownerUserId,
    password: input.transferPassword,
    twoFactorCode: input.twoFactorCode,
  });

  const senderWallet = await input.collections.wallets.findOne({ ownerUserId: input.ownerUserId, status: "active" });
  if (!senderWallet) {
    const wallet = await input.collections.wallets.findOne({ ownerUserId: input.ownerUserId });
    if (!wallet) throw notFound();
    throw forbidden("wallet_frozen", "This wallet is frozen and cannot send transfers.");
  }
  if (senderWallet.publicId === recipientWallet.publicId) throw conflict("self_transfer", "You cannot transfer to your own wallet.");

  const [senderAccount, receiverAccount] = await Promise.all([
    input.collections.ledgerAccounts.findOne({ walletId: senderWallet.publicId, accountType: "wallet", currency: "LMA" }),
    input.collections.ledgerAccounts.findOne({ walletId: recipientWallet.publicId, accountType: "wallet", currency: "LMA" }),
  ]);
  if (!senderAccount || !receiverAccount) throw new Error("Wallet ledger account is missing");
  // Settle the sender's mined reward first: the balance this transfer is checked against must
  // include everything the account has actually earned, and the displayed number is never an input.
  if (input.config) {
    await settleMiningForOwner({
      collections: input.collections,
      mongoClient: input.mongoClient,
      config: input.config,
      ownerUserId: input.ownerUserId,
      wallet: senderWallet,
      walletAccount: senderAccount,
      correlationId: input.requestId,
    });
  }
  const feeAccountPublicId = await ensureFeeAccount(input.collections);
  const feeAccount = await input.collections.ledgerAccounts.findOne({ publicId: feeAccountPublicId, accountType: "fee_revenue", currency: "LMA" });
  if (!feeAccount) throw new Error("Fee revenue ledger account is missing");

  /**
   * Generated once per request, before any transaction attempt: a retry must not mint new
   * identifiers, or an attempt that committed just before its error would leave records the replay
   * could not recognise.
   */
  const transactionPublicId = randomUUID();
  const transferId = randomUUID();
  const now = new Date();
  const transaction: Omit<TransactionRecord, "_id"> = {
    publicId: transactionPublicId,
    transferId,
    senderUserId: input.ownerUserId,
    receiverUserId: recipientWallet.ownerUserId,
    senderWalletId: senderWallet.publicId,
    receiverWalletId: recipientWallet.publicId,
    participants: [input.ownerUserId, recipientWallet.ownerUserId],
    senderAddress: senderWallet.customAddress ?? senderWallet.address,
    receiverAddress: recipientWallet.customAddress ?? recipientWallet.address,
    amountMinor: amounts.amountMinor,
    feeMinor: amounts.feeMinor,
    netAmountMinor: amounts.netAmountMinor,
    currency: "LMA",
    status: "completed",
    type: "transfer",
    note: intent.note,
    idempotencyKey,
    requestFingerprint,
    correlationId: input.requestId,
    balanceAfterMinor: 0,
    createdAt: now,
    completedAt: now,
  } satisfies Omit<TransactionRecord, "_id">;

  const ledgerLines = [
    { ledgerAccountId: senderAccount.publicId, walletId: senderWallet.publicId, side: "debit" as const, amountMinor: amounts.amountMinor },
    { ledgerAccountId: receiverAccount.publicId, walletId: recipientWallet.publicId, side: "credit" as const, amountMinor: amounts.netAmountMinor },
    ...(amounts.feeMinor > 0 ? [{ ledgerAccountId: feeAccount.publicId, walletId: null, side: "credit" as const, amountMinor: amounts.feeMinor }] : []),
  ];
  assertBalanced(ledgerLines);

  const transactionOptions = { readConcern: { level: "snapshot" as const }, writeConcern: { w: "majority" as const } };
  let committed = false;
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= MAX_TRANSACTION_ATTEMPTS && !committed; attempt += 1) {
    if (attempt > 1) {
      // A retry is only safe because of what happens next: the record of a previous attempt that
      // actually committed is found and replayed, so a retry never re-executes money movement.
      const landed = await findCommittedTransfer({ collections: input.collections, ownerUserId: input.ownerUserId, idempotencyKey, requestFingerprint });
      if (landed) return { ...landed.public, balanceAfter: formatMoney(landed.record.balanceAfterMinor), replayed: true };
      await sleep(RETRY_BACKOFF_BASE_MS * 2 ** (attempt - 2));
    }

    const session = input.mongoClient.startSession();
    try {
      await session.withTransaction(
        async () => {
          const duplicate = await input.collections.transactions.findOne({ senderUserId: input.ownerUserId, idempotencyKey }, { session });
          if (duplicate) {
            if (duplicate.requestFingerprint !== requestFingerprint) throw conflict("idempotency_key_reused", "This idempotency key was already used for a different transfer.");
            return;
          }

          // Share a write-conflict boundary with freeze so a concurrently frozen wallet cannot send.
          const walletGuard = await input.collections.wallets.updateOne(
            { _id: senderWallet._id, ownerUserId: input.ownerUserId, status: "active" },
            { $inc: { financialVersion: 1 } },
            { session },
          );
          if (walletGuard.modifiedCount !== 1) throw forbidden("wallet_frozen", "This wallet is frozen and cannot send transfers.");

          // The credential was proven before this transaction opened. Someone who replaces it in the
          // meantime (the reason for replacing it is usually a device they no longer trust) must not
          // have this transfer slip through under the credential that was just replaced. A materialised
          // snapshot read alone could not see the change, which is why a password write also bumps the
          // wallet's financialVersion (see setTransferPassword): it conflicts with the guard above, this
          // transaction retries, and the comparison here then reads the new credential.
          const [passwordNow, twoFactorNow] = await Promise.all([
            input.collections.transferPasswordCredentials.findOne({ ownerUserId: input.ownerUserId }, { session, projection: { changedAt: 1 } }),
            input.collections.twoFactorCredentials.findOne({ ownerUserId: input.ownerUserId, enabledAt: { $ne: null } }, { session, projection: { enabledAt: 1 } }),
          ]);
          const unchanged =
            (passwordNow?.changedAt?.getTime() ?? null) === (proof.passwordChangedAt?.getTime() ?? null) &&
            (twoFactorNow?.enabledAt?.getTime() ?? null) === (proof.twoFactorEnabledAt?.getTime() ?? null);
          if (!unchanged) throw conflict("transfer_authorization_changed", "Your transfer credentials changed. Try again.");

          /**
           * The approval is consumed here, inside the transaction that moves the money.
           *
           * Both directions of this placement matter. A transfer that fails — insufficient funds, a
           * lost connection, a conflict — rolls the consumption back with everything else, so the
           * sender keeps the approval they were given and can retry without re-approving; nothing is
           * burned while the transfer later fails. And because the consumption is atomic with the
           * debit, the two requests that race on one approval cannot both pass this update: the
           * loser's write conflicts (or matches no document once the winner committed), its
           * transaction retries, and it converges on "this was already approved and sent" rather than
           * executing the payment a second time.
           */
          const consumedAt = new Date();
          const consumed = await input.collections.transferAuthorizations.updateOne(
            { _id: approval._id, ownerUserId: input.ownerUserId, consumedAt: null, expiresAt: { $gt: consumedAt } },
            {
              $set: {
                consumedAt,
                consumedByTransactionPublicId: transactionPublicId,
                passwordChangedAt: proof.passwordChangedAt,
                twoFactorEnabledAt: proof.twoFactorEnabledAt,
              },
            },
            { session },
          );
          if (consumed.modifiedCount !== 1) {
            // Fail closed: an approval that is gone, expired, or already spent must not authorise
            // money. The reason is read back so the client is told which of the three it was.
            const current = await input.collections.transferAuthorizations.findOne(
              { _id: approval._id },
              { session, projection: { consumedAt: 1, expiresAt: 1 } },
            );
            if (current?.consumedAt) throw conflict("transfer_authorization_used", "This transfer was already approved and sent. Confirm the transfer again to send another one.");
            if (current && current.expiresAt.getTime() <= consumedAt.getTime()) throw conflict("transfer_authorization_expired", "That approval has expired. Confirm the recipient and the amount again.");
            throw conflict("transfer_authorization_used", "That approval can no longer be used. Confirm the transfer again.");
          }
          maybeAbort({ abortSignal: input.abortSignal, point: "after_authorization_consume" });

          // The factor proof is consumed the same way, and for the same reason: an accepted
          // authenticator step or recovery code authorises exactly this one financial operation,
          // and it is consumed if and only if this operation commits.
          await consumeTransferCredentialProof({
            collections: input.collections,
            proof,
            ownerUserId: input.ownerUserId,
            intentHash: requestFingerprint,
            correlationId: input.requestId,
            session,
          });
          maybeAbort({ abortSignal: input.abortSignal, point: "after_credential_consume" });

          // The database, not this code, decides whether the funds are there: the debit only lands
          // while the projection still covers the full amount, so two concurrent spends of the same
          // balance cannot both pass this condition.
          const senderDebit = await input.collections.ledgerAccounts.updateOne(
            { _id: senderAccount._id, accountType: "wallet", balanceMinor: { $gte: amounts.amountMinor } },
            { $inc: { balanceMinor: -amounts.amountMinor } },
            { session },
          );
          if (senderDebit.modifiedCount !== 1) throw conflict("insufficient_funds", "There are not enough available funds for this transfer.");
          maybeAbort({ abortSignal: input.abortSignal, point: "after_sender_debit" });

          const receiverCredit = await input.collections.ledgerAccounts.updateOne(
            { _id: receiverAccount._id, accountType: "wallet", balanceMinor: { $lte: LEDGER_BALANCE_MAX_MINOR - amounts.netAmountMinor } },
            { $inc: { balanceMinor: amounts.netAmountMinor } },
            { session },
          );
          if (receiverCredit.modifiedCount !== 1) throw conflict("wallet_limit_exceeded", "The receiving wallet cannot accept this transfer.");
          maybeAbort({ abortSignal: input.abortSignal, point: "after_receiver_credit" });

          if (amounts.feeMinor > 0) {
            const feeCredit = await input.collections.ledgerAccounts.updateOne(
              { _id: feeAccount._id, accountType: "fee_revenue", balanceMinor: { $lte: LEDGER_BALANCE_MAX_MINOR - amounts.feeMinor } },
              { $inc: { balanceMinor: amounts.feeMinor } },
              { session },
            );
            if (feeCredit.modifiedCount !== 1) throw new Error("Failed to post transfer fee");
          }
          maybeAbort({ abortSignal: input.abortSignal, point: "after_fee_credit" });

          const senderAccountAfter = await input.collections.ledgerAccounts.findOne({ _id: senderAccount._id }, { session, projection: { balanceMinor: 1 } });
          if (!senderAccountAfter) throw new Error("Sender ledger account disappeared during transfer");
          transaction.balanceAfterMinor = senderAccountAfter.balanceMinor;
          await input.collections.transactions.insertOne(transaction as never, { session });
          maybeAbort({ abortSignal: input.abortSignal, point: "after_transaction_record" });
          const ledgerEntries = ledgerLines.map((line, index) => ({
            publicId: randomUUID(),
            transactionId: transactionPublicId,
            lineNumber: index + 1,
            walletId: line.walletId,
            ledgerAccountId: line.ledgerAccountId,
            side: line.side,
            amountMinor: line.amountMinor,
            currency: "LMA",
            correlationId: input.requestId,
            createdAt: now,
          }));
          await input.collections.ledgerEntries.insertMany(ledgerEntries as never, { session, ordered: true });
          maybeAbort({ abortSignal: input.abortSignal, point: "after_ledger_insert" });
          // Both sides are told inside the same transaction: a transfer that rolls back notifies
          // nobody, and a replayed one returns above without writing a second notice. Addresses are
          // the canonical ones the transaction shows, not what the sender typed.
          await input.collections.notifications.insertMany(
            [
              {
                _id: new ObjectId(),
                ownerUserId: input.ownerUserId,
                kind: "transfer_sent",
                title: "Transfer sent",
                body: `You sent ${formatMoney(amounts.amountMinor)} LMA to ${transaction.receiverAddress}. Fee ${formatMoney(amounts.feeMinor)} LMA.`,
                readAt: null,
                createdAt: now,
              },
              {
                _id: new ObjectId(),
                ownerUserId: recipientWallet.ownerUserId,
                kind: "transfer_received",
                title: "Transfer received",
                body: `You received ${formatMoney(amounts.netAmountMinor)} LMA from ${transaction.senderAddress}.`,
                readAt: null,
                createdAt: now,
              },
            ],
            { session, ordered: true },
          );
          await recordSecurityEvent({ collections: input.collections, ownerUserId: input.ownerUserId, sessionId: null, eventType: "transfer_completed", outcome: "success", correlationId: input.requestId, metadata: { transferId, amountMinor: intent.amountMinor, feeMinor: amounts.feeMinor, approvalId: approval.publicId }, mongoSession: session });
          maybeAbort({ abortSignal: input.abortSignal, point: "before_commit" });
        },
        transactionOptions,
      );
      committed = true;
    } catch (error) {
      lastError = error;
      const transient = isTransientTransactionError(error);
      const duplicateKey = isDuplicateKeyError(error);
      // A transient failure or a lost insert race leaves this attempt cleanly rolled back, and the
      // loop's replay check before the next attempt keeps the retry from re-executing anything.
      if ((transient || duplicateKey) && attempt < MAX_TRANSACTION_ATTEMPTS) continue;
      // Ambiguous outcomes — unknown commit, a duplicate key, or retries exhausted on a transient
      // error — are decided by the idempotency record: if money already moved, replay it.
      if (isUnknownCommitOutcome(error) || duplicateKey || transient) {
        const landed = await findCommittedTransfer({ collections: input.collections, ownerUserId: input.ownerUserId, idempotencyKey, requestFingerprint });
        if (landed) return { ...landed.public, balanceAfter: formatMoney(landed.record.balanceAfterMinor), replayed: true };
        // Nothing landed and the attempts are spent. The outcome of the last attempt is uncertain, so
        // it is answered as a retryable failure: never as a success (that could hide a transfer that
        // did not commit), never by executing again (that is what the idempotency record exists to
        // prevent), and with a distinct code so a caller knows the difference between "the request was
        // refused" and "the database was busy". The client retries with the same key, which either
        // replays the attempt that did commit or runs the one that did not.
        throw serviceUnavailable("transfer_conflict", "The transfer could not be completed. Try again.");
      }
      // A product rejection (insufficient funds, freeze, …) rolled its attempt back, so the event is
      // written outside any session: the failure must still be on the record, with enough metadata
      // to correlate it against the request that produced it.
      if (error instanceof AppError && FINANCIAL_REJECTION_CODES.has(error.code)) {
        await recordSecurityEvent({
          collections: input.collections,
          ownerUserId: input.ownerUserId,
          sessionId: null,
          eventType: "transfer_rejected",
          outcome: "failure",
          correlationId: input.requestId,
          metadata: { reason: error.code, recipientAddress: intent.recipientAddress, amountMinor: intent.amountMinor, idempotencyKey },
        }).catch(() => undefined);
      }
      throw error;
    } finally {
      await session.endSession();
    }
  }

  if (!committed) throw lastError ?? new Error("Transfer transaction did not commit");
  const completed = await input.collections.transactions.findOne({ senderUserId: input.ownerUserId, idempotencyKey });
  if (!completed) throw new Error("Transfer transaction did not commit");
  return {
    ...publicTransaction(completed, input.ownerUserId, completed.balanceAfterMinor) as PublicTransaction & { balanceAfter: string },
    balanceAfter: formatMoney(completed.balanceAfterMinor),
    replayed: completed.publicId !== transactionPublicId,
  };
}

/**
 * One transfer, by either identifier the API hands out: the public `id` and the `transferId` are
 * both uuids a client may have kept, and looking up only one of them answered 404 for the other.
 */
export async function getTransaction(input: { collections: Collections; ownerUserId: string; transactionId: string }) {
  const transaction = await input.collections.transactions.findOne({
    $and: [
      { $or: [{ senderUserId: input.ownerUserId }, { receiverUserId: input.ownerUserId }] },
      { $or: [{ transferId: input.transactionId }, { publicId: input.transactionId }] },
    ],
  });
  if (!transaction) throw notFound();
  return publicTransaction(transaction, input.ownerUserId);
}

export async function listTransactions(input: { collections: Collections; ownerUserId: string; cursor: string | undefined; limit: number | undefined; direction: "sent" | "received" | "all" | undefined }) {
  const limit = Math.min(Math.max(input.limit ?? 20, 1), MAX_PAGE_SIZE);
  if (input.direction === "sent" || input.direction === "received") {
    const ownerFilter = input.direction === "sent" ? { senderUserId: input.ownerUserId } : { receiverUserId: input.ownerUserId };
    const filter: Record<string, unknown> = { ...ownerFilter };
    if (input.cursor) {
      const cursor = await input.collections.transactions.findOne({ publicId: input.cursor, ...ownerFilter }, { projection: { createdAt: 1, publicId: 1 } });
      if (!cursor) throw notFound();
      filter["$and"] = [ownerFilter, { $or: [{ createdAt: { $lt: cursor.createdAt } }, { createdAt: cursor.createdAt, publicId: { $lt: cursor.publicId } }] }];
    }
    const transactions = await input.collections.transactions.find(filter).sort({ createdAt: -1, publicId: -1 }).limit(limit + 1).toArray();
    const hasMore = transactions.length > limit;
    const page = transactions.slice(0, limit);
    return { transactions: page.map((item) => publicTransaction(item, input.ownerUserId)), nextCursor: hasMore ? page.at(-1)?.publicId ?? null : null };
  }
  // `participants` is not a required schema field, so a transfer written by an older process after
  // this process's startup backfill has no participant list. Reading only that field would silently
  // drop such a transfer from both sides' combined history until the next backfill, so the `all`
  // direction keeps a legacy fallback on the sender/receiver pair the record always implies.
  //
  // The fallback must not slow the normal page: a single `$or` over all three predicates would make
  // the server fetch and sort the account's whole history on every page instead of the ordered scan
  // the participants index was built for. The two sources are therefore read as two bounded,
  // indexed pages — the participants page off its history index, the not-yet-backfilled remainder
  // off the sender/receiver indexes — and merged in memory over at most 2 * (limit + 1) rows. In
  // steady state the legacy side is empty and costs one cheap empty page.
  const ownerFilter = { $or: [{ participants: input.ownerUserId }, { senderUserId: input.ownerUserId }, { receiverUserId: input.ownerUserId }] };
  let pageBound: Record<string, unknown> | null = null;
  if (input.cursor) {
    const cursor = await input.collections.transactions.findOne({ publicId: input.cursor, ...ownerFilter }, { projection: { createdAt: 1, publicId: 1 } });
    if (!cursor) throw notFound();
    pageBound = { $or: [{ createdAt: { $lt: cursor.createdAt } }, { createdAt: cursor.createdAt, publicId: { $lt: cursor.publicId } }] };
  }
  const participantsFilter: Record<string, unknown> = { participants: input.ownerUserId };
  // `$ne` also matches documents where the field is missing, which is exactly the legacy shape.
  // It is disjoint from the participants branch, so the merge below never sees a row twice.
  const legacyFilter: Record<string, unknown> = {
    $and: [
      { $or: [{ senderUserId: input.ownerUserId }, { receiverUserId: input.ownerUserId }] },
      { participants: { $ne: input.ownerUserId } },
    ],
  };
  const primaryFilter: Record<string, unknown> = pageBound ? { $and: [participantsFilter, pageBound] } : participantsFilter;
  const legacyPageFilter: Record<string, unknown> = pageBound ? { $and: [legacyFilter, pageBound] } : legacyFilter;
  const [primary, legacy] = await Promise.all([
    input.collections.transactions.find(primaryFilter).sort({ createdAt: -1, publicId: -1 }).limit(limit + 1).toArray(),
    input.collections.transactions.find(legacyPageFilter).sort({ createdAt: -1, publicId: -1 }).limit(limit + 1).toArray(),
  ]);
  const seen = new Set<string>();
  const merged = [...primary, ...legacy]
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (b.publicId < a.publicId ? -1 : b.publicId > a.publicId ? 1 : 0))
    .filter((item) => {
      if (seen.has(item.publicId)) return false;
      seen.add(item.publicId);
      return true;
    });
  const hasMore = merged.length > limit;
  const page = merged.slice(0, limit);
  return { transactions: page.map((item) => publicTransaction(item, input.ownerUserId)), nextCursor: hasMore ? page.at(-1)?.publicId ?? null : null };
}
