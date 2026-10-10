import { randomUUID } from "node:crypto";
import { ObjectId, type ClientSession, type Document } from "mongodb";
import type {
  Account,
  Application,
  Approval,
  Payment,
  Wallet,
} from "../domain/models.js";
import { MAX_AMOUNT, MAX_BALANCE, reject } from "../domain/money.js";
import { payment } from "./checkout.js";
import { guardApplication } from "./merchants.js";
import {
  changed,
  duplicate,
  moneyDocument,
  type GatewayStore,
} from "./store.js";
import { firstSubscription } from "./billing.js";
export async function event(
  store: GatewayStore,
  app: string,
  kind: string,
  resource: string,
  session: ClientSession,
): Promise<void> {
  await store
    .c("gateway_events")
    .insertOne(
      {
        publicId: randomUUID(),
        applicationId: app,
        type: kind,
        resourceId: resource,
        createdAt: new Date(),
        expanded: false,
      },
      { session },
    );
}
function sameDate(
  a: Date | null | undefined,
  b: Date | null | undefined,
): boolean {
  return (a?.getTime() ?? null) === (b?.getTime() ?? null);
}
export async function guardPayer(
  store: GatewayStore,
  a: Approval,
  session: ClientSession,
): Promise<void> {
  if (store.config.environment === "test") {
    if (
      a.proof.kind !== "none" ||
      a.proof.passwordChangedAt ||
      a.proof.twoFactorEnabledAt
    )
      reject("invalid_sandbox_proof");
    return;
  }
  changed(
    await store
      .c("sessions")
      .updateOne(
        {
          publicId: a.sessionId,
          ownerUserId: a.ownerUserId,
          status: "active",
          expiresAt: { $gt: new Date() },
        },
        { $inc: { gatewayFinancialVersion: 1 } },
        { session },
      ),
    "session_revoked",
  );
  const password = await store.find<{
    changedAt: Date;
  }>("transfer_password_credentials", { ownerUserId: a.ownerUserId }, session);
  const factor = await store.find<{
    enabledAt: Date;
  }>(
    "two_factor_credentials",
    { ownerUserId: a.ownerUserId, enabledAt: { $ne: null } },
    session,
  );
  if (
    !sameDate(password?.changedAt, a.proof.passwordChangedAt) ||
    !sameDate(factor?.enabledAt, a.proof.twoFactorEnabledAt)
  )
    reject("credential_changed", 409);
  if (a.proof.kind === "none" && (password || factor))
    reject("credential_required", 403);
  if (a.proof.kind === "password" && !password) reject("invalid_proof", 403);
  // Credential changes increment wallet.financialVersion in the host. The wallet guard below
  // makes an in-flight settlement conflict, retry and recheck these snapshots.
  if (a.proof.kind === "totp") {
    const step = Math.floor(Date.now() / 30000);
    if (
      !factor ||
      !Number.isInteger(a.proof.timeStep) ||
      a.proof.timeStep < step - 4 ||
      a.proof.timeStep > step + 1
    )
      reject("proof_expired", 409);
    const now = new Date();
    try {
      await store
        .c("two_factor_uses")
        .insertOne(
          {
            ownerUserId: a.ownerUserId,
            purpose: "transfer",
            timeStep: a.proof.timeStep,
            intentHash: a.intentHash,
            correlationId: a.publicId,
            createdAt: now,
            retainUntil: new Date(now.getTime() + 7 * 86400000),
          },
          { session },
        );
    } catch (error) {
      if (duplicate(error)) reject("two_factor_code_already_used", 409);
      throw error;
    }
  } else if (a.proof.kind === "recovery_code") {
    if (
      !/^[a-f\d]{24}$/i.test(a.proof.credentialId) ||
      a.proof.verifiedHashes.length !== a.proof.remainingHashes.length + 1
    )
      reject("invalid_proof", 403);
    changed(
      await store
        .c("two_factor_credentials")
        .updateOne(
          {
            _id: new ObjectId(a.proof.credentialId),
            ownerUserId: a.ownerUserId,
            enabledAt: a.proof.twoFactorEnabledAt,
            recoveryCodeHashes: a.proof.verifiedHashes,
          },
          {
            $set: {
              recoveryCodeHashes: a.proof.remainingHashes,
              updatedAt: new Date(),
            },
          },
          { session },
        ),
      "recovery_code_already_used",
    );
  }
}
export async function guardWallet(
  store: GatewayStore,
  id: string,
  owner: string,
  session: ClientSession,
): Promise<Wallet> {
  const wallet = await store.find<Wallet>(
    "wallets",
    { publicId: id, ownerUserId: owner, status: "active" },
    session,
  );
  if (!wallet) return reject("wallet_frozen_or_unowned", 403);
  changed(
    await store
      .c("wallets")
      .updateOne(
        {
          publicId: id,
          ownerUserId: owner,
          status: "active",
          financialVersion: { $lt: 2147483647 },
        },
        { $inc: { financialVersion: 1 } },
        { session },
      ),
    "wallet_frozen_or_unowned",
  );
  return wallet;
}
export async function guardReceiver(
  store: GatewayStore,
  id: string,
  owner: string,
  session: ClientSession,
): Promise<Wallet> {
  const wallet = await store.require<Wallet>(
    "wallets",
    { publicId: id, ownerUserId: owner },
    session,
  );
  changed(
    await store
      .c("wallets")
      .updateOne(
        {
          publicId: id,
          ownerUserId: owner,
          financialVersion: { $lt: 2147483647 },
        },
        { $inc: { financialVersion: 1 } },
        { session },
      ),
    "wallet_ownership_changed",
  );
  return wallet;
}
export function account(
  store: GatewayStore,
  walletId: string,
  session: ClientSession,
): Promise<Account> {
  return store.require(
    "ledger_accounts",
    { walletId, accountType: "wallet", currency: "LMA" },
    session,
  );
}
export async function move(
  store: GatewayStore,
  a: Account,
  delta: number,
  session: ClientSession,
): Promise<void> {
  if (!Number.isSafeInteger(delta) || Math.abs(delta) > MAX_AMOUNT)
    throw new Error("Invalid financial delta");
  changed(
    await store
      .c("ledger_accounts")
      .updateOne(
        {
          publicId: a.publicId,
          currency: "LMA",
          balanceMinor:
            delta < 0 ? { $gte: -delta } : { $lte: MAX_BALANCE - delta },
        },
        { $inc: moneyDocument({ balanceMinor: delta }) },
        { session },
      ),
    delta < 0 ? "insufficient_funds" : "wallet_limit_exceeded",
  );
}
export interface JournalLine {
  account: Account;
  walletId: string | null;
  side: "debit" | "credit";
  amount: number;
}
export async function postJournal(
  store: GatewayStore,
  header: Document,
  lines: JournalLine[],
  session: ClientSession,
): Promise<void> {
  let debit = 0n,
    credit = 0n;
  for (const line of lines) {
    if (
      !Number.isSafeInteger(line.amount) ||
      line.amount < 1 ||
      line.amount > MAX_AMOUNT
    )
      throw new Error("Invalid journal amount");
    if (line.side === "debit") debit += BigInt(line.amount);
    else credit += BigInt(line.amount);
  }
  if (
    lines.length < 2 ||
    lines.length > 3 ||
    debit !== credit ||
    debit > BigInt(MAX_BALANCE)
  )
    throw new Error("Unbalanced journal");
  await store.c("transactions").insertOne(moneyDocument(header), { session });
  for (const [i, line] of lines.entries()) {
    await store
      .c("ledger_entries")
      .insertOne(
        moneyDocument({
          publicId: randomUUID(),
          transactionId: header["publicId"],
          lineNumber: i + 1,
          walletId: line.walletId,
          ledgerAccountId: line.account.publicId,
          side: line.side,
          amountMinor: line.amount,
          currency: "LMA",
          correlationId: header["correlationId"],
          createdAt: header["createdAt"],
        }),
        { session },
      );
  }
}
export async function settlePayment(
  store: GatewayStore,
  p: Payment,
  session: ClientSession,
): Promise<void> {
  if (store.config.settlementPaused || store.config.merchantPaused)
    reject("settlement_paused", 503);
  const app = await store.require<Application>(
    "gateway_applications",
    { publicId: p.applicationId },
    session,
  );
  await guardApplication(
    store,
    { app, credential: { publicId: p.credentialId } },
    session,
  );
  if (app.walletId !== p.receivingWalletId || app.ownerUserId === p.payerUserId)
    reject("self_payment_or_wallet_changed", 409);
  changed(
    await store
      .c("users")
      .updateOne(
        { publicId: p.payerUserId, status: "active" },
        { $inc: { gatewayFinancialVersion: 1 } },
        { session },
      ),
    "payer_suspended",
  );
  const payer = await guardWallet(
    store,
    p.payerWalletId,
    p.payerUserId,
    session,
  );
  const receiver = await guardReceiver(
    store,
    p.receivingWalletId,
    app.ownerUserId,
    session,
  );
  const from = await account(store, payer.publicId, session),
    to = await account(store, receiver.publicId, session);
  await move(store, from, -p.totalMinor, session);
  await move(store, to, p.netMinor, session);
  const lines: JournalLine[] = [
    {
      account: from,
      walletId: payer.publicId,
      side: "debit",
      amount: p.totalMinor,
    },
    {
      account: to,
      walletId: receiver.publicId,
      side: "credit",
      amount: p.netMinor,
    },
  ];
  if (p.feeMinor > 0) {
    const revenue = await store.require<Account>(
      "ledger_accounts",
      { accountType: "fee_revenue", currency: "LMA" },
      session,
    );
    await move(store, revenue, p.feeMinor, session);
    lines.push({
      account: revenue,
      walletId: null,
      side: "credit",
      amount: p.feeMinor,
    });
  }
  p.transactionId = randomUUID();
  p.status = "succeeded";
  const now = new Date();
  await postJournal(
    store,
    {
      publicId: p.transactionId,
      type: "merchant_payment",
      paymentId: p.publicId,
      operationId: p.publicId,
      merchantId: app.publicId,
      senderUserId: payer.ownerUserId,
      receiverUserId: receiver.ownerUserId,
      senderWalletId: payer.publicId,
      receiverWalletId: receiver.publicId,
      participants: [payer.ownerUserId, receiver.ownerUserId],
      senderAddress: payer.address,
      receiverAddress: receiver.address,
      amountMinor: p.totalMinor,
      feeMinor: p.feeMinor,
      netAmountMinor: p.netMinor,
      currency: "LMA",
      status: "completed",
      note: p.description,
      idempotencyKey: p.publicId,
      requestFingerprint: p.intentHash,
      correlationId: p.publicId,
      balanceAfterMinor: from.balanceMinor - p.totalMinor,
      createdAt: now,
      completedAt: now,
    },
    lines,
    session,
  );
  changed(
    await store
      .c("gateway_payments")
      .updateOne(
        { publicId: p.publicId, status: "requires_action" },
        {
          $set: {
            status: "succeeded",
            payerUserId: p.payerUserId,
            payerWalletId: p.payerWalletId,
            transactionId: p.transactionId,
            subscriptionId: p.subscriptionId,
            invoiceId: p.invoiceId,
          },
        },
        { session },
      ),
    "payment_already_settled",
  );
  await event(store, p.applicationId, "payment.succeeded", p.publicId, session);
  await event(
    store,
    p.applicationId,
    "checkout.session.completed",
    p.publicId,
    session,
  );
}
export async function confirm(
  store: GatewayStore,
  owner: string,
  id: string,
  approvalId: string,
  intent: string,
): Promise<Payment> {
  const prior = await payment(store, "", id);
  if (prior.intentHash !== intent) reject("intent_mismatch", 409);
  if (prior.status === "succeeded") {
    if (prior.payerUserId !== owner) reject("not_found", 404);
    return prior;
  }
  if (store.config.settlementPaused || store.config.merchantPaused)
    reject("settlement_paused", 503);
  let failure: unknown;
  try {
    await store.transaction(async (session) => {
      const p = await payment(store, "", id, session);
      if (p.status === "succeeded") {
        if (p.payerUserId !== owner) reject("not_found", 404);
        return;
      }
      if (p.status !== "requires_action" || p.expiresAt.getTime() <= Date.now())
        reject("checkout_not_payable", 409);
      const a = await store.find<Approval>(
        "gateway_approvals",
        {
          publicId: approvalId,
          paymentId: id,
          ownerUserId: owner,
          intentHash: intent,
          consumed: false,
          expiresAt: { $gt: new Date() },
        },
        session,
      );
      if (!a) return reject("approval_expired_or_used", 409);
      await guardPayer(store, a, session);
      changed(
        await store
          .c("gateway_approvals")
          .updateOne(
            { publicId: a.publicId, consumed: false },
            { $set: { consumed: true } },
            { session },
          ),
        "approval_used",
      );
      p.payerUserId = owner;
      p.payerWalletId = a.walletId;
      if (p.interval) {
        if (!a.recurringConsent || a.policyVersion !== "2026-10-08")
          reject("recurring_consent_required");
        await firstSubscription(store, p, a, session);
      }
      await settlePayment(store, p, session);
    });
  } catch (error) {
    failure = error;
  }
  const landed = await payment(store, "", id);
  if (landed.status === "succeeded" && landed.payerUserId === owner)
    return landed;
  if (failure) throw failure;
  return reject("payment_outcome_unknown", 503);
}
