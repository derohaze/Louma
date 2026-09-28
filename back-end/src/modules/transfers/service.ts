import { createHash, randomUUID } from "node:crypto";
import { ObjectId } from "mongodb";
import type { MongoClient } from "mongodb";
import type { Collections } from "../../infrastructure/mongodb/collections.js";
import { recordSecurityEvent } from "../security/audit.js";
import { ensureFeeAccount, resolveRecipient } from "../wallets/service.js";
import { assertBalanced, calculateTransferAmounts, formatMoney, parseMoneyToMinorUnits } from "../ledger/money.js";
import { LEDGER_BALANCE_MAX_MINOR } from "../../shared/types.js";
import { AppError, badRequest, conflict, forbidden, notFound } from "../../shared/errors.js";
import type { PublicTransaction, TransactionDirection, TransactionRecord } from "../../shared/types.js";

const MAX_IDEMPOTENCY_KEY_LENGTH = 128;
const MAX_PAGE_SIZE = 50;
const TRANSFER_PASSWORD_MAX_LENGTH = 128;
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
const FINANCIAL_REJECTION_CODES = new Set(["insufficient_funds", "wallet_frozen", "wallet_limit_exceeded", "self_transfer", "transfer_password_changed", "invalid_transfer_password"]);

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

/**
 * A transfer password is optional: only accounts that set one have a credential, and only those
 * have to send it. Enforcing it before this check is what would make every transfer of an account
 * without a credential fail.
 *
 * Returns which credential version was accepted (`null` when the account has none), so the transfer
 * transaction can refuse to commit under a password that changed while it was being authorised.
 */
async function checkTransferPassword(input: { collections: Collections; ownerUserId: string; password: unknown }): Promise<Date | null> {
  const credential = await input.collections.transferPasswordCredentials.findOne({ ownerUserId: input.ownerUserId });
  if (!credential) return null;
  if (typeof input.password !== "string" || input.password.length > TRANSFER_PASSWORD_MAX_LENGTH || !(await import("argon2")).verify(credential.passwordHash, input.password).catch(() => false)) {
    throw forbidden("invalid_transfer_password", "The transfer password is incorrect.");
  }
  return credential.changedAt;
}

export async function createTransfer(input: {
  collections: Collections;
  mongoClient: MongoClient;
  ownerUserId: string;
  recipientAddress: unknown;
  amount: unknown;
  note?: unknown;
  idempotencyKey: string | undefined;
  transferPassword?: unknown;
  requestId: string;
  /**
   * Failure-injection hook for the integration suite only: production callers never pass it, so it
   * stays undefined on the real path. It fires at fixed points inside the transaction (after the
   * sender debit, after the receiver credit, after the fee posting, before the commit) and throwing
   * from it aborts the transaction — which is how rollback completeness is tested end to end.
   */
  abortSignal?: { throwAt: string } | undefined;
}): Promise<PublicTransaction & { balanceAfter: string; replayed: boolean }> {
  const idempotencyKey = input.idempotencyKey?.trim();
  if (!idempotencyKey || idempotencyKey.length > MAX_IDEMPOTENCY_KEY_LENGTH || !/^[\x21-\x7e]+$/.test(idempotencyKey)) {
    throw conflict("idempotency_key_required", "A valid Idempotency-Key header is required.");
  }
  if (typeof input.recipientAddress !== "string" || input.recipientAddress.length > 128) throw new Error("Enter a valid receiving address.");
  const recipientAddress = input.recipientAddress.trim();
  if (!/^(?:LMA(?:-[A-Z0-9]{4}){3}|@[a-z0-9_]{4,24})$/i.test(recipientAddress)) {
    throw badRequest("invalid_recipient", "Enter a valid Louma wallet address or @handle.");
  }
  const amountMinor = parseMoneyToMinorUnits(input.amount);
  const amounts = calculateTransferAmounts(amountMinor);
  const note = typeof input.note === "string" ? input.note.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 240) : "";
  const requestFingerprint = createHash("sha256").update(JSON.stringify({ recipientAddress: recipientAddress.toLowerCase(), amountMinor, note })).digest("hex");

  const prior = await input.collections.transactions.findOne({ senderUserId: input.ownerUserId, idempotencyKey });
  if (prior) {
    if (prior.requestFingerprint !== requestFingerprint) throw conflict("idempotency_key_reused", "This idempotency key was already used for a different transfer.");
    return { ...publicTransaction(prior, input.ownerUserId, prior.balanceAfterMinor) as PublicTransaction & { balanceAfter: string }, balanceAfter: formatMoney(prior.balanceAfterMinor), replayed: true };
  }
  const recipientWallet = await resolveRecipient({ collections: input.collections, address: recipientAddress, senderUserId: input.ownerUserId });
  /**
   * A frozen recipient is not an error: freezing stops what leaves a wallet, and the freeze page
   * promises that LMA already on its way still arrives. Refusing here would drop the sender's
   * transfer because of a control the recipient chose for themselves.
   */
  const passwordChangedAt = await checkTransferPassword({ collections: input.collections, ownerUserId: input.ownerUserId, password: input.transferPassword });

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
    note,
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

          // The password was verified before this transaction opened. Someone who changes it in the
          // meantime (the reason for changing it is usually a device they no longer trust) must not
          // have this transfer slip through under the credential that was just replaced. A snapshot
          // read alone could not see that change, which is why a password write also bumps the
          // wallet's financialVersion (see setTransferPassword): it conflicts with the guard above,
          // this transaction retries, and the comparison here then reads the new credential.
          const credentialNow = await input.collections.transferPasswordCredentials.findOne(
            { ownerUserId: input.ownerUserId },
            { session, projection: { changedAt: 1 } },
          );
          const credentialChangedAt = credentialNow?.changedAt ?? null;
          if ((credentialChangedAt?.getTime() ?? null) !== (passwordChangedAt?.getTime() ?? null)) {
            throw conflict("transfer_password_changed", "The transfer password changed. Try again.");
          }

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
          await recordSecurityEvent({ collections: input.collections, ownerUserId: input.ownerUserId, sessionId: null, eventType: "transfer_completed", outcome: "success", correlationId: input.requestId, metadata: { transferId, amountMinor, feeMinor: amounts.feeMinor }, mongoSession: session });
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
          metadata: { reason: error.code, recipientAddress, amountMinor, idempotencyKey },
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
  const ownerFilter = input.direction === "sent" ? { senderUserId: input.ownerUserId } : input.direction === "received" ? { receiverUserId: input.ownerUserId } : { participants: input.ownerUserId };
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
