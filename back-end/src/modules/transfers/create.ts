import { randomUUID } from "node:crypto";
import { ObjectId } from "mongodb";
import type { MongoClient } from "mongodb";
import type { Collections } from "../../infrastructure/mongodb/collections.js";
import { postBalancedJournal } from "../../infrastructure/mongodb/repositories.js";
import type { CacheContext } from "../../infrastructure/redis/cache.js";
import type { AppConfig } from "../../config/env.js";
import { recordSecurityEvent } from "../security/audit.js";
import { consumeTransferCredentialProof, proveTransferCredential, type TransferCredentialProof } from "../security/service.js";
import { ensureFeeAccount, findPrimaryWallet, resolveRecipient } from "../wallets/service.js";
import { settleMiningForOwner } from "../mining/service.js";
import { readFinancialControls } from "../financial-controls/service.js";
import { assertBalanced, calculateTransferAmounts, formatMoney, parseMoneyToMinorUnits } from "../ledger/money.js";
import {
  LEDGER_BALANCE_MAX_MINOR,
  isTransferTransaction,
  type PublicTransaction,
  type TransferTransactionRecord,
} from "../../shared/types.js";
import { AppError, conflict, forbidden, notFound, serviceUnavailable } from "../../shared/errors.js";
import {
  RETRY_BACKOFF_BASE_MS,
  isDuplicateKeyError,
  isTransientTransactionError,
  isUnknownCommitOutcome,
  sleep,
} from "../../shared/mongo-retry.js";
import {
  assertTransferAuthorizationAttemptsRemain,
  findCommittedTransfer,
  intentHashOf,
  loadTransferAuthorization,
  normalizeNote,
  parseRecipientAddress,
  publicTransaction,
} from "./intent.js";

const MAX_IDEMPOTENCY_KEY_LENGTH = 128;
/**
 * Transaction retries are bounded and never blind: each retry first re-reads the idempotency record
 * outside the session, so a retry after an ambiguous commit replays the landed transfer instead of
 * re-executing it. Three attempts cover replica-set elections and primary step-downs without
 * turning a failing database into an infinite loop.
 */
const MAX_TRANSACTION_ATTEMPTS = 3;
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

/** Fires the test-only failure-injection hook; a no-op unless a hook is supplied. */
function maybeAbort(input: { abortSignal?: { throwAt: string } | undefined; point: string }): void {
  if (input.abortSignal?.throwAt === input.point) throw new Error(`Injected failure at ${input.point}`);
}

export async function createTransfer(input: {
  collections: Collections;
  mongoClient: MongoClient;
  /**
   * Present on the HTTP path. A transfer spends the wallet's balance, and mined LMA only reaches that
   * balance once it is settled, so the sender's running cycle is settled before the spend is
   * evaluated. Optional so a direct caller that runs no mining (tests, tooling) is unaffected.
   */
  config?: Pick<AppConfig, "mining" | "miningPools" | "encryptionKey">;
  /** Cache contexts for the mining-settlement side effect (settings read). Absent in tests. */
  cache?: CacheContext | undefined;
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
  // The approval is fetched without enforcing consumed/expired yet: after a commit the
  // approval is consumed, and a client retrying the same request after losing the success
  // response must reach the idempotency replay below — not `transfer_authorization_used`.
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
  const senderWallet = await findPrimaryWallet(input.collections, input.ownerUserId);
  if (!senderWallet) throw notFound();
  if (approval.senderWalletId !== senderWallet.publicId) {
    throw conflict("transfer_authorization_mismatch", "That approval does not belong to this wallet. Confirm the transfer again.");
  }
  if (intentHashOf(approval.intent, senderWallet.publicId) !== approval.intentHash) {
    throw conflict("transfer_authorization_mismatch", "That approval is no longer valid. Confirm the transfer again.");
  }
  // The body's echoes of the approved intent are checked, never used: the client cannot introduce a
  // recipient, an amount, or a note the sender did not approve, whether it is a bug or an attacker.
  const requestedRecipient = parseRecipientAddress(input.recipientAddress);
  const requestedAmountMinor = parseMoneyToMinorUnits(input.amount);
  if (requestedAmountMinor !== amounts.amountMinor || normalizeNote(input.note) !== intent.note) {
    throw conflict("transfer_authorization_mismatch", "This transfer does not match the one you approved. Confirm the recipient and the amount again.");
  }

  const prior = await input.collections.transactions.findOne({ type: "transfer", senderWalletId: senderWallet.publicId, idempotencyKey });
  // Unreachable while the collection validator holds (a transfer filter can only match a
  // transfer header), but a replay must never execute against a misread shape: fail closed.
  if (prior && !isTransferTransaction(prior)) throw new Error("Transfer idempotency record has an unexpected shape");
  if (prior) {
    if (prior.requestFingerprint !== requestFingerprint) throw conflict("idempotency_key_reused", "This idempotency key was already used for a different transfer.");
    return { ...publicTransaction(prior, input.ownerUserId, prior.balanceAfterMinor) as PublicTransaction & { balanceAfter: string }, balanceAfter: formatMoney(prior.balanceAfterMinor), replayed: true };
  }
  // Only now that a replay has been ruled out is the approval's usability enforced. Checking
  // consumed/expired before the lookup above turned every post-commit retry into
  // `transfer_authorization_used` instead of the committed transfer.
  if (approval.consumedAt) {
    throw conflict("transfer_authorization_used", "This transfer was already approved and sent. Confirm the transfer again to send another one.");
  }
  if (approval.expiresAt.getTime() <= Date.now()) {
    throw conflict("transfer_authorization_expired", "That approval has expired. Confirm the recipient and the amount again.");
  }
  // The recipient is the wallet the approval named, not whatever the address resolves to now: a
  // custom address that moved between the quote and the send cannot redirect the money. When the
  // client echoes the typed spelling instead of the canonical address, it must resolve to the same
  // wallet, so "pay the address I approved" stays true in every spelling.
  let recipientWallet = await input.collections.wallets.findOne({ publicId: intent.recipientWalletId });
  if (!recipientWallet) throw notFound();
  if (requestedRecipient.toLowerCase() !== intent.recipientAddress.toLowerCase()) {
    const resolved = await resolveRecipient({ collections: input.collections, address: requestedRecipient, senderWalletId: senderWallet.publicId });
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
  // Credential guesses must feed the per-account failure limit: the in-transaction
  // `transfer_rejected` writer below never runs for a proof that throws here, so a wrong
  // password/code would otherwise never count toward its ten-failure lockout.
  let proof: TransferCredentialProof;
  try {
    proof = await proveTransferCredential({
      collections: input.collections,
      config: input.config,
      ownerUserId: input.ownerUserId,
      password: input.transferPassword,
      twoFactorCode: input.twoFactorCode,
    });
  } catch (error) {
    if (error instanceof AppError && (error.code === "invalid_transfer_password" || error.code === "invalid_two_factor_code" || error.code === "invalid_transfer_authorization")) {
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
  }

  if (senderWallet.status !== "active") {
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
      correlationId: input.requestId,
      cache: input.cache,
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
  const transaction: Omit<TransferTransactionRecord, "_id"> = {
    publicId: transactionPublicId,
    transferId,
    senderUserId: input.ownerUserId,
    receiverUserId: recipientWallet.ownerUserId,
    senderWalletId: senderWallet.publicId,
    receiverWalletId: recipientWallet.publicId,
    participants: [input.ownerUserId, recipientWallet.ownerUserId],
    senderAddress: senderWallet.address,
    receiverAddress: recipientWallet.address,
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
  } satisfies Omit<TransferTransactionRecord, "_id">;

  const ledgerLines = [
    { ledgerAccountId: senderAccount.publicId, walletId: senderWallet.publicId, side: "debit" as const, amountMinor: amounts.amountMinor },
    { ledgerAccountId: receiverAccount.publicId, walletId: recipientWallet.publicId, side: "credit" as const, amountMinor: amounts.netAmountMinor },
    ...(amounts.feeMinor > 0 ? [{ ledgerAccountId: feeAccount.publicId, walletId: null, side: "credit" as const, amountMinor: amounts.feeMinor }] : []),
  ];
  assertBalanced(ledgerLines);

  const transactionOptions = { readConcern: { level: "snapshot" as const }, writeConcern: { w: "majority" as const } };
  let committed = false;
  /**
   * The header this call itself posted inside its winning transaction, so the answer below never
   * depends on a *second* read succeeding: the commit already happened and the money facts are in
   * this object. `_id` exists for the record shape only — it is never written and never published
   * (`publicTransaction` keys its answer on `publicId`).
   */
  let posted: TransferTransactionRecord | null = null;
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= MAX_TRANSACTION_ATTEMPTS && !committed; attempt += 1) {
    if (attempt > 1) {
      // A retry is only safe because of what happens next: the record of a previous attempt that
      // actually committed is found and replayed, so a retry never re-executes money movement.
      const landed = await findCommittedTransfer({ collections: input.collections, ownerUserId: input.ownerUserId, senderWalletId: senderWallet.publicId, idempotencyKey, requestFingerprint });
      if (landed) return { ...landed.public, balanceAfter: formatMoney(landed.record.balanceAfterMinor), replayed: true };
      // The previous attempt assigned `posted` before it rolled back. That header never committed,
      // so it must not survive into this attempt: should this retry converge on another request's
      // committed transfer while the final lookup below fails, the fallback would otherwise return
      // the rolled-back header — with `replayed: false` — and its transfer id and balance would
      // disagree with the money actually posted.
      posted = null;
      await sleep(RETRY_BACKOFF_BASE_MS * 2 ** (attempt - 2));
    }

    const session = input.mongoClient.startSession();
    try {
      await session.withTransaction(
        async () => {
          const duplicate = await input.collections.transactions.findOne({ type: "transfer", senderWalletId: senderWallet.publicId, idempotencyKey }, { session });
          if (duplicate && !isTransferTransaction(duplicate)) throw new Error("Transfer idempotency record has an unexpected shape");
          if (duplicate) {
            if (duplicate.requestFingerprint !== requestFingerprint) throw conflict("idempotency_key_reused", "This idempotency key was already used for a different transfer.");
            return;
          }

          // Share a write-conflict boundary with freeze so a concurrently frozen wallet cannot send.
          const walletGuard = await input.collections.wallets.updateOne(
            { _id: senderWallet._id, ownerUserId: input.ownerUserId, isPrimary: true, status: "active" },
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
          // Posted through the repository so the header↔entries pairing and the balance
          // assertion live in one place no future money path can forget. The abort points
          // below still split the write for rollback-completeness testing.
          await postBalancedJournal(
            input.collections,
            {
              header: transaction,
              lines: ledgerLines.map((line) => ({ ...line, correlationId: input.requestId, createdAt: now })),
              linePublicIds: ledgerLines.map(() => randomUUID()),
            },
            session,
          );
          posted = { ...transaction, _id: new ObjectId() };
          maybeAbort({ abortSignal: input.abortSignal, point: "after_transaction_record" });
          maybeAbort({ abortSignal: input.abortSignal, point: "after_ledger_insert" });
          // Both sides are told inside the same transaction: a transfer that rolls back notifies
          // nobody, and a replayed one returns above without writing a second notice. Addresses are
          // the canonical ones the transaction shows, not what the sender typed. `data` repeats the
          // money facts as structured params so clients can render the notice in any language;
          // title/body stay the English rendering as the fallback.
          await input.collections.notifications.insertMany(
            [
              {
                _id: new ObjectId(),
                ownerUserId: input.ownerUserId,
                kind: "transfer_sent",
                title: "Transfer sent",
                body: `You sent ${formatMoney(amounts.amountMinor)} LMA to ${transaction.receiverAddress}. Fee ${formatMoney(amounts.feeMinor)} LMA.`,
                data: { direction: "sent", amountMinor: amounts.amountMinor, feeMinor: amounts.feeMinor, counterpartyAddress: transaction.receiverAddress },
                readAt: null,
                createdAt: now,
              },
              {
                _id: new ObjectId(),
                ownerUserId: recipientWallet.ownerUserId,
                kind: "transfer_received",
                title: "Transfer received",
                body: `You received ${formatMoney(amounts.netAmountMinor)} LMA from ${transaction.senderAddress}.`,
                data: { direction: "received", amountMinor: amounts.netAmountMinor, feeMinor: 0, counterpartyAddress: transaction.senderAddress },
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
        const landed = await findCommittedTransfer({ collections: input.collections, ownerUserId: input.ownerUserId, senderWalletId: senderWallet.publicId, idempotencyKey, requestFingerprint });
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
  /**
   * The commit is authoritative: everything below only *formats* the answer, and no formatting step
   * may turn a transfer that already moved money into an error. The canonical answer is the stored
   * row — it is also what a replay returns, including a row another request committed under the same
   * key — so it is read first, but a read that fails or finds nothing falls back to the header this
   * call posted. Only when both are unavailable (this call converged on a duplicate and the read that
   * would have identified it failed) is the outcome unknown here: that answers the designed retryable
   * failure, and the client's retry with the same idempotency key returns the committed transfer.
   */
  let completed: TransferTransactionRecord | null = null;
  try {
    const stored = await input.collections.transactions.findOne({ type: "transfer", senderWalletId: senderWallet.publicId, idempotencyKey });
    if (stored && isTransferTransaction(stored)) completed = stored;
  } catch {
    completed = null;
  }
  const record = completed ?? posted;
  if (!record) throw serviceUnavailable("transfer_conflict", "The transfer could not be completed. Try again.");
  return {
    ...publicTransaction(record, input.ownerUserId, record.balanceAfterMinor) as PublicTransaction & { balanceAfter: string },
    balanceAfter: formatMoney(record.balanceAfterMinor),
    replayed: record.publicId !== transactionPublicId,
  };
}
