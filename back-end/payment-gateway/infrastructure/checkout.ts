import { randomUUID } from "node:crypto";
import type { ClientSession } from "mongodb";
import type { Approval, Payment, Price } from "../domain/models.js";
import { reject } from "../domain/money.js";
import { guardApplication, type Principal } from "./merchants.js";
import { duplicate, moneyDocument, type GatewayStore } from "./store.js";
export function payment(
  store: GatewayStore,
  app: string,
  id: string,
  session?: ClientSession,
): Promise<Payment> {
  return store.require(
    "gateway_payments",
    { publicId: id, ...(app ? { applicationId: app } : {}) },
    session,
  );
}
export function price(
  store: GatewayStore,
  app: string,
  id: string,
): Promise<Price> {
  return store.require("gateway_prices", {
    publicId: id,
    applicationId: app,
    status: "active",
  });
}
export async function saveCheckout(
  store: GatewayStore,
  principal: Principal,
  input: Payment,
): Promise<Payment> {
  const find = async (session?: ClientSession) => {
    const prior = await store.find<Payment>(
      "gateway_payments",
      {
        applicationId: input.applicationId,
        idempotencyKey: input.idempotencyKey,
      },
      session,
    );
    if (prior && prior.requestFingerprint !== input.requestFingerprint)
      reject("idempotency_key_reused", 409);
    return prior;
  };
  const prior = await find();
  if (prior) return prior;
  try {
    return await store.transaction(async (session) => {
      const existing = await find(session);
      if (existing) return existing;
      await guardApplication(store, principal, session);
      await store
        .c("gateway_payments")
        .insertOne(moneyDocument(input), { session });
      return input;
    });
  } catch (error) {
    const landed = await find();
    if (landed) return landed;
    throw error;
  }
}
export function approval(
  store: GatewayStore,
  owner: string,
  id: string,
  key: string,
): Promise<Approval> {
  return store.require("gateway_approvals", {
    ownerUserId: owner,
    paymentId: id,
    idempotencyKey: key,
  });
}
export async function approve(
  store: GatewayStore,
  input: Omit<Approval, "publicId" | "createdAt" | "expiresAt" | "consumed">,
): Promise<Approval> {
  const checkout = await payment(store, "", input.paymentId);
  if (
    input.intentHash !== checkout.intentHash ||
    !input.sessionId ||
    !input.walletId ||
    !input.idempotencyKey
  )
    reject("invalid_approval");
  if (
    checkout.interval &&
    (!input.recurringConsent || input.policyVersion !== "2026-10-08")
  )
    reject("recurring_consent_required");
  const find = async () => {
    const prior = await store.find<Approval>("gateway_approvals", {
      ownerUserId: input.ownerUserId,
      paymentId: input.paymentId,
      idempotencyKey: input.idempotencyKey,
    });
    if (
      prior &&
      (prior.intentHash !== input.intentHash ||
        prior.walletId !== input.walletId ||
        prior.sessionId !== input.sessionId ||
        prior.recurringConsent !== input.recurringConsent ||
        prior.policyVersion !== input.policyVersion)
    )
      reject("idempotency_key_reused", 409);
    return prior;
  };
  const prior = await find();
  if (prior) return prior;
  if (
    checkout.status !== "requires_action" ||
    checkout.expiresAt.getTime() <= Date.now()
  )
    reject("checkout_not_payable", 409);
  const result: Approval = {
    ...input,
    publicId: randomUUID(),
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 120000),
    consumed: false,
  };
  try {
    await store.c("gateway_approvals").insertOne(result);
  } catch (error) {
    if (!duplicate(error)) throw error;
    const winner = await find();
    if (!winner) throw error;
    return winner;
  }
  return result;
}
