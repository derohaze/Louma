import { randomUUID } from "node:crypto";
import type { ClientSession } from "mongodb";
import type {
  Application,
  Approval,
  Invoice,
  Payment,
  Price,
  Subscription,
} from "../domain/models.js";
import { calculateFee, GatewayError, reject } from "../domain/money.js";
import { event, settlePayment } from "./settlement.js";
import {
  changed,
  duplicate,
  moneyDocument,
  type GatewayStore,
} from "./store.js";
const ZERO = new Date("0001-01-01T00:00:00.000Z");
export function period(anchor: Date, interval: string, cycle: number): Date {
  if (!Number.isInteger(cycle) || cycle < 0 || cycle > 1200)
    return reject("invalid_cycle");
  if (interval !== "month" && interval !== "year")
    return reject("invalid_interval");
  const result = new Date(anchor);
  result.setUTCDate(1);
  result.setUTCMonth(
    result.getUTCMonth() + cycle * (interval === "year" ? 12 : 1),
  );
  const last = new Date(result);
  last.setUTCMonth(last.getUTCMonth() + 1);
  last.setUTCDate(0);
  result.setUTCDate(Math.min(anchor.getUTCDate(), last.getUTCDate()));
  return result;
}
function invoiceDefaults(): Pick<Invoice, "attempts" | "leaseUntil" | "fence"> {
  return { attempts: 0, leaseUntil: ZERO, fence: 0 };
}
export async function firstSubscription(
  store: GatewayStore,
  p: Payment,
  a: Approval,
  session: ClientSession,
): Promise<void> {
  const price = await store.require<Price>(
    "gateway_prices",
    { publicId: p.priceId, applicationId: p.applicationId, status: "active" },
    session,
  );
  if (price.amountMinor !== p.totalMinor || price.interval !== p.interval)
    reject("price_changed", 409);
  const now = new Date(),
    due = period(now, p.interval, 1);
  p.subscriptionId = randomUUID();
  p.invoiceId = randomUUID();
  const sub: Subscription = {
    publicId: p.subscriptionId,
    applicationId: p.applicationId,
    receivingWalletId: p.receivingWalletId,
    payerUserId: a.ownerUserId,
    payerWalletId: a.walletId,
    priceId: price.publicId,
    priceVersion: price.version,
    amountMinor: p.totalMinor,
    interval: p.interval,
    status: "active",
    mandateActive: true,
    consentAt: now,
    policyVersion: a.policyVersion,
    anchorAt: now,
    cycle: 1,
    dueAt: due,
    cancelAtEnd: false,
    version: 0,
    createdAt: now,
  };
  await store
    .c("gateway_subscriptions")
    .insertOne(moneyDocument(sub), { session });
  const inv: Invoice = {
    publicId: p.invoiceId,
    applicationId: p.applicationId,
    subscriptionId: sub.publicId,
    cycle: 0,
    amountMinor: p.totalMinor,
    feeMinor: p.feeMinor,
    feePolicy: p.feePolicy,
    status: "paid",
    paymentId: p.publicId,
    periodStart: now,
    periodEnd: due,
    dueAt: now,
    createdAt: now,
    ...invoiceDefaults(),
  };
  await store.c("gateway_invoices").insertOne(moneyDocument(inv), { session });
  await event(
    store,
    p.applicationId,
    "subscription.created",
    sub.publicId,
    session,
  );
  await event(store, p.applicationId, "invoice.paid", inv.publicId, session);
}
export async function cancelSubscription(
  store: GatewayStore,
  input: {
    applicationId: string;
    ownerUserId: string;
    id: string;
    atPeriodEnd: boolean;
  },
): Promise<void> {
  await store.transaction(async (session) => {
    const filter = {
      publicId: input.id,
      ...(input.applicationId
        ? { applicationId: input.applicationId }
        : { payerUserId: input.ownerUserId }),
    };
    const sub = await store.require<Subscription>(
      "gateway_subscriptions",
      filter,
      session,
    );
    if (sub.status === "canceled" || (input.atPeriodEnd && sub.cancelAtEnd))
      return;
    if (!["active", "past_due", "paused"].includes(sub.status))
      reject("invalid_transition", 409);
    changed(
      await store.c("gateway_subscriptions").updateOne(
        filter,
        {
          $set: {
            cancelAtEnd: input.atPeriodEnd,
            ...(!input.atPeriodEnd
              ? { status: "canceled", mandateActive: false }
              : {}),
          },
          $inc: { version: 1 },
        },
        { session },
      ),
      "subscription_changed",
    );
    await event(
      store,
      sub.applicationId,
      input.atPeriodEnd
        ? "subscription.cancellation_scheduled"
        : "subscription.canceled",
      input.id,
      session,
    );
  });
}
export async function schedule(
  store: GatewayStore,
  now: Date,
  stopping: () => boolean = () => false,
): Promise<void> {
  if (stopping()) return;
  const rows = await store
    .c("gateway_subscriptions")
    .find({ status: { $in: ["active", "past_due"] }, dueAt: { $lte: now } })
    .sort({ dueAt: 1 })
    .limit(50)
    .toArray();
  for (const row of rows) {
    if (stopping()) return;
    const invoiceId = randomUUID(),
      paymentId = randomUUID();
    try {
      await store.transaction(async (session) => {
        const sub = await store.require<Subscription>(
          "gateway_subscriptions",
          { publicId: row["publicId"] },
          session,
        );
        if (["canceled", "paused"].includes(sub.status) || sub.dueAt > now)
          return;
        if (sub.cancelAtEnd || !sub.mandateActive) {
          await store.c("gateway_subscriptions").updateOne(
            { publicId: sub.publicId },
            {
              $set: { status: "canceled", mandateActive: false },
              $inc: { version: 1 },
            },
            { session },
          );
          await event(
            store,
            sub.applicationId,
            "subscription.canceled",
            sub.publicId,
            session,
          );
          return;
        }
        if (
          await store.find(
            "gateway_invoices",
            { subscriptionId: sub.publicId, cycle: sub.cycle },
            session,
          )
        )
          return;
        const inv: Invoice = {
          publicId: invoiceId,
          applicationId: sub.applicationId,
          subscriptionId: sub.publicId,
          cycle: sub.cycle,
          amountMinor: sub.amountMinor,
          feeMinor: calculateFee(sub.amountMinor, store.config.fee),
          feePolicy: store.config.fee,
          status: "open",
          paymentId,
          periodStart: sub.dueAt,
          periodEnd: period(sub.anchorAt, sub.interval, sub.cycle + 1),
          dueAt: sub.dueAt,
          createdAt: now,
          ...invoiceDefaults(),
        };
        await store
          .c("gateway_invoices")
          .insertOne(moneyDocument(inv), { session });
      });
    } catch (error) {
      if (!duplicate(error)) throw error;
    }
  }
}
export async function claimInvoice(
  store: GatewayStore,
  now: Date,
): Promise<Invoice | null> {
  return (await store.c("gateway_invoices").findOneAndUpdate(
    { status: "open", dueAt: { $lte: now }, leaseUntil: { $lte: now } },
    {
      $set: { leaseUntil: new Date(now.getTime() + 30000) },
      $inc: { fence: 1 },
    },
    { sort: { dueAt: 1 }, returnDocument: "after" },
  )) as Invoice | null;
}
export async function renew(
  store: GatewayStore,
  claim: Invoice,
  now: Date,
): Promise<void> {
  let failure: unknown;
  try {
    await store.transaction(async (session) => {
      const invoice = await store.require<Invoice>(
        "gateway_invoices",
        {
          publicId: claim.publicId,
          status: "open",
          fence: claim.fence,
          leaseUntil: { $gt: new Date() },
        },
        session,
      );
      const sub = await store.require<Subscription>(
        "gateway_subscriptions",
        { publicId: invoice.subscriptionId },
        session,
      );
      if (
        !sub.mandateActive ||
        sub.cancelAtEnd ||
        ["canceled", "paused"].includes(sub.status)
      ) {
        await store
          .c("gateway_invoices")
          .updateOne(
            { publicId: invoice.publicId, fence: claim.fence },
            { $set: { status: "void", leaseUntil: ZERO } },
            { session },
          );
        return;
      }
      if (
        sub.cycle !== invoice.cycle ||
        sub.amountMinor !== invoice.amountMinor
      )
        reject("mandate_mismatch", 409);
      const price = await store.require<Price>(
        "gateway_prices",
        {
          publicId: sub.priceId,
          applicationId: sub.applicationId,
          status: "active",
        },
        session,
      );
      if (
        price.version !== sub.priceVersion ||
        price.amountMinor !== sub.amountMinor ||
        price.interval !== sub.interval
      )
        reject("reauthorization_required", 409);
      const app = await store.require<Application>(
        "gateway_applications",
        { publicId: sub.applicationId },
        session,
      );
      if (!sub.receivingWalletId || sub.receivingWalletId !== app.walletId)
        reject("reauthorization_required", 409);
      const p: Payment = {
        publicId: invoice.paymentId,
        applicationId: sub.applicationId,
        credentialId: "",
        receivingWalletId: app.walletId,
        merchantName: app.name,
        subtotalMinor: invoice.amountMinor,
        taxMinor: 0,
        totalMinor: invoice.amountMinor,
        feeMinor: invoice.feeMinor,
        netMinor: invoice.amountMinor - invoice.feeMinor,
        feePolicy: invoice.feePolicy,
        description: "Subscription renewal",
        status: "requires_action",
        idempotencyKey: "invoice:" + invoice.publicId,
        requestFingerprint: invoice.publicId,
        intentHash: invoice.publicId,
        payerUserId: sub.payerUserId,
        payerWalletId: sub.payerWalletId,
        priceId: sub.priceId,
        interval: sub.interval,
        subscriptionId: sub.publicId,
        invoiceId: invoice.publicId,
        metadata: {},
        createdAt: now,
        expiresAt: new Date(now.getTime() + 3600000),
        transactionId: "",
        refundedMinor: 0,
        successUrl: "",
        cancelUrl: "",
      };
      await store
        .c("gateway_payments")
        .insertOne(moneyDocument(p), { session });
      await settlePayment(store, p, session);
      changed(
        await store
          .c("gateway_invoices")
          .updateOne(
            { publicId: invoice.publicId, status: "open", fence: claim.fence },
            { $set: { status: "paid", leaseUntil: ZERO } },
            { session },
          ),
        "invoice_claim_lost",
      );
      changed(
        await store.c("gateway_subscriptions").updateOne(
          {
            publicId: sub.publicId,
            mandateActive: true,
            cycle: invoice.cycle,
            status: { $in: ["active", "past_due"] },
          },
          {
            $set: { status: "active", dueAt: invoice.periodEnd },
            $inc: { cycle: 1, version: 1 },
          },
          { session },
        ),
        "mandate_revoked",
      );
      await event(
        store,
        sub.applicationId,
        "invoice.paid",
        invoice.publicId,
        session,
      );
      await event(
        store,
        sub.applicationId,
        "subscription.renewed",
        sub.publicId,
        session,
      );
    });
    return;
  } catch (error) {
    failure = error;
  }
  const landed = await store.require<Invoice>("gateway_invoices", {
    publicId: claim.publicId,
  });
  if (["paid", "void"].includes(landed.status)) return;
  if (!(failure instanceof GatewayError) || failure.statusCode >= 500)
    throw failure;
  await store.transaction(async (session) => {
    const sub = await store.require<Subscription>(
      "gateway_subscriptions",
      { publicId: claim.subscriptionId },
      session,
    );
    if (!sub.mandateActive || sub.status === "canceled") {
      await store
        .c("gateway_invoices")
        .updateOne(
          { publicId: claim.publicId, fence: claim.fence, status: "open" },
          { $set: { status: "void", leaseUntil: ZERO } },
          { session },
        );
      return;
    }
    const attempts = Math.min(landed.attempts + 1, 4),
      exhausted =
        attempts >= 4 ||
        now.getTime() > claim.periodStart.getTime() + 7 * 86400000;
    const dueAt = new Date(
      attempts <= 3
        ? claim.periodStart.getTime() + [1, 3, 5][attempts - 1]! * 86400000
        : now.getTime() + 86400000,
    );
    changed(
      await store.c("gateway_invoices").updateOne(
        { publicId: claim.publicId, fence: claim.fence, status: "open" },
        {
          $set: {
            status: exhausted ? "uncollectible" : "open",
            attempts,
            dueAt,
            leaseUntil: ZERO,
          },
        },
        { session },
      ),
      "invoice_claim_lost",
    );
    changed(
      await store.c("gateway_subscriptions").updateOne(
        {
          publicId: sub.publicId,
          mandateActive: true,
          status: { $in: ["active", "past_due"] },
        },
        {
          $set: { status: exhausted ? "paused" : "past_due" },
          $inc: { version: 1 },
        },
        { session },
      ),
      "mandate_revoked",
    );
    await event(
      store,
      sub.applicationId,
      "invoice.payment_failed",
      claim.publicId,
      session,
    );
    await event(
      store,
      sub.applicationId,
      "subscription.past_due",
      sub.publicId,
      session,
    );
  });
}
