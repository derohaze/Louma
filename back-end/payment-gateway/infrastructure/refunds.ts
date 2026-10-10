import { randomUUID } from "node:crypto";
import type { Refund } from "../domain/models.js";
import {
  GatewayError,
  MAX_AMOUNT,
  formatMoney,
  parseMoney,
  reject,
} from "../domain/money.js";
import { hash } from "../security.js";
import { payment } from "./checkout.js";
import { guardApplication, type Principal } from "./merchants.js";
import {
  account,
  event,
  guardReceiver,
  guardWallet,
  move,
  postJournal,
} from "./settlement.js";
import {
  changed,
  duplicate,
  moneyDocument,
  type GatewayStore,
} from "./store.js";
export async function refundRequest(
  store: GatewayStore,
  principal: Principal,
  id: string,
  raw: string,
  key: string,
  reason: string,
): Promise<Refund> {
  const full = raw === "";
  let amount = full ? 0 : parseMoney(raw);
  if ((!full && amount < 1) || amount > MAX_AMOUNT || !key)
    reject("invalid_refund");
  const fingerprint = hash(
    `${id}:${full ? "remaining" : formatMoney(amount)}${reason ? ":reason:" + reason : ""}`,
  );
  const find = async () => {
    const prior = await store.find<Refund>("gateway_refunds", {
      applicationId: principal.app.publicId,
      idempotencyKey: key,
    });
    if (prior && prior.requestFingerprint !== fingerprint)
      reject("idempotency_key_reused", 409);
    return prior;
  };
  let refund = await find();
  if (!refund) {
    const p = await payment(store, principal.app.publicId, id);
    if (full) amount = p.totalMinor - p.refundedMinor;
    if (
      p.status !== "succeeded" ||
      amount < 1 ||
      amount > p.totalMinor - p.refundedMinor
    )
      reject("refund_limit_exceeded", 409);
    refund = {
      publicId: randomUUID(),
      applicationId: principal.app.publicId,
      paymentId: id,
      amountMinor: amount,
      status: "pending",
      idempotencyKey: key,
      reason,
      requestFingerprint: fingerprint,
      transactionId: "",
      createdAt: new Date(),
    };
    try {
      await store.c("gateway_refunds").insertOne(moneyDocument(refund));
    } catch (error) {
      if (!duplicate(error)) throw error;
      refund = await find();
      if (!refund) throw error;
    }
  }
  if (refund.status === "succeeded") return refund;
  const r = refund;
  let failure: unknown;
  try {
    await store.transaction(async (session) => {
      if (store.config.settlementPaused || store.config.merchantPaused)
        reject("settlement_paused", 503);
      const current = await store.require<Refund>(
        "gateway_refunds",
        { publicId: r.publicId },
        session,
      );
      if (current.status === "succeeded") return;
      if (current.status !== "pending") reject("refund_not_payable", 409);
      const p = await payment(store, r.applicationId, r.paymentId, session);
      if (
        p.status !== "succeeded" ||
        r.amountMinor > p.totalMinor - p.refundedMinor
      )
        reject("refund_limit_exceeded", 409);
      await guardApplication(store, principal, session);
      const from = await guardWallet(
          store,
          p.receivingWalletId,
          principal.app.ownerUserId,
          session,
        ),
        to = await guardReceiver(
          store,
          p.payerWalletId,
          p.payerUserId,
          session,
        );
      const debit = await account(store, from.publicId, session),
        credit = await account(store, to.publicId, session);
      await move(store, debit, -r.amountMinor, session);
      await move(store, credit, r.amountMinor, session);
      const transactionId = randomUUID(),
        now = new Date();
      await postJournal(
        store,
        {
          publicId: transactionId,
          type: "merchant_refund",
          paymentId: p.publicId,
          originalPaymentId: p.publicId,
          operationId: r.publicId,
          merchantId: principal.app.publicId,
          senderUserId: from.ownerUserId,
          receiverUserId: to.ownerUserId,
          senderWalletId: from.publicId,
          receiverWalletId: to.publicId,
          participants: [from.ownerUserId, to.ownerUserId],
          senderAddress: from.address,
          receiverAddress: to.address,
          amountMinor: r.amountMinor,
          feeMinor: 0,
          netAmountMinor: r.amountMinor,
          currency: "LMA",
          status: "completed",
          note: "Merchant refund",
          idempotencyKey: r.publicId,
          requestFingerprint: r.requestFingerprint,
          correlationId: r.publicId,
          balanceAfterMinor: debit.balanceMinor - r.amountMinor,
          createdAt: now,
          completedAt: now,
        },
        [
          {
            account: debit,
            walletId: from.publicId,
            side: "debit",
            amount: r.amountMinor,
          },
          {
            account: credit,
            walletId: to.publicId,
            side: "credit",
            amount: r.amountMinor,
          },
        ],
        session,
      );
      changed(
        await store
          .c("gateway_payments")
          .updateOne(
            {
              publicId: p.publicId,
              refundedMinor: { $lte: p.totalMinor - r.amountMinor },
            },
            { $inc: moneyDocument({ refundedMinor: r.amountMinor }) },
            { session },
          ),
        "refund_limit_exceeded",
      );
      changed(
        await store
          .c("gateway_refunds")
          .updateOne(
            { publicId: r.publicId, status: "pending" },
            { $set: { status: "succeeded", transactionId } },
            { session },
          ),
        "refund_already_settled",
      );
      await event(
        store,
        p.applicationId,
        "payment.refunded",
        p.publicId,
        session,
      );
    });
  } catch (error) {
    failure = error;
  }
  const landed = await store.require<Refund>("gateway_refunds", {
    publicId: r.publicId,
  });
  if (
    landed.status === "succeeded" ||
    (failure instanceof GatewayError && failure.code === "insufficient_funds")
  )
    return landed;
  if (failure) throw failure;
  return landed;
}
