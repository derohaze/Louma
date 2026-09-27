import { createHash, randomUUID } from "node:crypto";
import { ObjectId } from "mongodb";
import type { MongoClient } from "mongodb";
import type { Collections } from "../../infrastructure/mongodb/collections.js";
import { recordSecurityEvent } from "../security/audit.js";
import { ensureFeeAccount, resolveRecipient } from "../wallets/service.js";
import { assertBalanced, calculateTransferAmounts, formatMoney, parseMoneyToMinorUnits } from "../ledger/money.js";
import { badRequest, conflict, forbidden, notFound } from "../../shared/errors.js";
import type { PublicTransaction, TransactionDirection, TransactionRecord } from "../../shared/types.js";

const MAX_IDEMPOTENCY_KEY_LENGTH = 128;
const MAX_PAGE_SIZE = 50;
const TRANSFER_PASSWORD_MAX_LENGTH = 128;

function publicTransaction(transaction: TransactionRecord, ownerUserId: string, balanceAfterMinor?: number): PublicTransaction & { balanceAfter?: string } {
  const direction: TransactionDirection = transaction.senderUserId === ownerUserId ? "sent" : "received";
  return {
    id: transaction.publicId,
    transferId: transaction.transferId,
    direction,
    counterpartyAddress: direction === "sent" ? transaction.receiverAddress : transaction.senderAddress,
    amount: formatMoney(transaction.amountMinor),
    fee: formatMoney(transaction.feeMinor),
    netAmount: formatMoney(transaction.netAmountMinor),
    ...(balanceAfterMinor === undefined ? (transaction.balanceAfterMinor === undefined ? {} : { balanceAfter: formatMoney(transaction.balanceAfterMinor) }) : { balanceAfter: formatMoney(balanceAfterMinor) }),
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
 */
async function checkTransferPassword(input: { collections: Collections; ownerUserId: string; password: unknown }): Promise<void> {
  const credential = await input.collections.transferPasswordCredentials.findOne({ ownerUserId: input.ownerUserId });
  if (!credential) return;
  if (typeof input.password !== "string" || input.password.length > TRANSFER_PASSWORD_MAX_LENGTH || !(await import("argon2")).verify(credential.passwordHash, input.password).catch(() => false)) {
    throw forbidden("invalid_transfer_password", "The transfer password is incorrect.");
  }
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
  if (recipientWallet.status !== "active") throw forbidden("recipient_wallet_unavailable", "The recipient wallet cannot receive transfers.");
  await checkTransferPassword({ collections: input.collections, ownerUserId: input.ownerUserId, password: input.transferPassword });

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

  const session = input.mongoClient.startSession();
  let resultingBalance = 0;
  try {
    await session.withTransaction(async () => {
      const duplicate = await input.collections.transactions.findOne({ senderUserId: input.ownerUserId, idempotencyKey }, { session });
      if (duplicate) {
        if (duplicate.requestFingerprint !== requestFingerprint) throw conflict("idempotency_key_reused", "This idempotency key was already used for a different transfer.");
        resultingBalance = duplicate.balanceAfterMinor;
        return;
      }

      // Share a write-conflict boundary with freeze so a concurrently frozen wallet cannot send.
      const walletGuard = await input.collections.wallets.updateOne(
        { _id: senderWallet._id, ownerUserId: input.ownerUserId, status: "active" },
        { $inc: { financialVersion: 1 } },
        { session },
      );
      if (walletGuard.modifiedCount !== 1) throw forbidden("wallet_frozen", "This wallet is frozen and cannot send transfers.");

      const senderDebit = await input.collections.ledgerAccounts.updateOne(
        { _id: senderAccount._id, accountType: "wallet", balanceMinor: { $gte: amounts.amountMinor } },
        { $inc: { balanceMinor: -amounts.amountMinor } },
        { session },
      );
      if (senderDebit.modifiedCount !== 1) throw conflict("insufficient_funds", "There are not enough available funds for this transfer.");

      const receiverCredit = await input.collections.ledgerAccounts.updateOne(
        { _id: receiverAccount._id, accountType: "wallet", balanceMinor: { $lte: Number.MAX_SAFE_INTEGER - amounts.netAmountMinor } },
        { $inc: { balanceMinor: amounts.netAmountMinor } },
        { session },
      );
      if (receiverCredit.modifiedCount !== 1) throw conflict("wallet_limit_exceeded", "The receiving wallet cannot accept this transfer.");

      if (amounts.feeMinor > 0) {
        const feeCredit = await input.collections.ledgerAccounts.updateOne(
          { _id: feeAccount._id, accountType: "fee_revenue", balanceMinor: { $lte: Number.MAX_SAFE_INTEGER - amounts.feeMinor } },
          { $inc: { balanceMinor: amounts.feeMinor } },
          { session },
        );
        if (feeCredit.modifiedCount !== 1) throw new Error("Failed to post transfer fee");
      }

      const senderAccountAfter = await input.collections.ledgerAccounts.findOne({ _id: senderAccount._id }, { session, projection: { balanceMinor: 1 } });
      if (!senderAccountAfter) throw new Error("Sender ledger account disappeared during transfer");
      transaction.balanceAfterMinor = senderAccountAfter.balanceMinor;
      resultingBalance = senderAccountAfter.balanceMinor;
      await input.collections.transactions.insertOne(transaction as never, { session });
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
      // Both sides are told inside the same transaction: a transfer that rolls back notifies nobody,
      // and a replayed one returns above without writing a second notice. Addresses are the
      // canonical ones the transaction shows, not what the sender typed.
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
    });
  } catch (error) {
    const duplicate = await input.collections.transactions.findOne({ senderUserId: input.ownerUserId, idempotencyKey });
    if (duplicate) {
      if (duplicate.requestFingerprint !== requestFingerprint) throw conflict("idempotency_key_reused", "This idempotency key was already used for a different transfer.");
      return { ...publicTransaction(duplicate, input.ownerUserId, duplicate.balanceAfterMinor) as PublicTransaction & { balanceAfter: string }, balanceAfter: formatMoney(duplicate.balanceAfterMinor), replayed: true };
    }
    throw error;
  } finally {
    await session.endSession();
  }

  const completed = await input.collections.transactions.findOne({ senderUserId: input.ownerUserId, idempotencyKey });
  if (!completed) throw new Error("Transfer transaction did not commit");
  resultingBalance = completed.balanceAfterMinor;
  return {
    ...publicTransaction(completed, input.ownerUserId, resultingBalance) as PublicTransaction & { balanceAfter: string },
    balanceAfter: formatMoney(resultingBalance),
    replayed: completed.publicId !== transactionPublicId,
  };
}

export async function getTransaction(input: { collections: Collections; ownerUserId: string; transactionId: string }) {
  const transaction = await input.collections.transactions.findOne({ transferId: input.transactionId, $or: [{ senderUserId: input.ownerUserId }, { receiverUserId: input.ownerUserId }] });
  if (!transaction) throw notFound();
  return publicTransaction(transaction, input.ownerUserId);
}

export async function listTransactions(input: { collections: Collections; ownerUserId: string; cursor: string | undefined; limit: number | undefined; direction: "sent" | "received" | "all" | undefined }) {
  const limit = Math.min(Math.max(input.limit ?? 20, 1), MAX_PAGE_SIZE);
  const ownerFilter = input.direction === "sent" ? { senderUserId: input.ownerUserId } : input.direction === "received" ? { receiverUserId: input.ownerUserId } : { $or: [{ senderUserId: input.ownerUserId }, { receiverUserId: input.ownerUserId }] };
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
