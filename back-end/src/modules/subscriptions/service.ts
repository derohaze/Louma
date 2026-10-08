import { randomUUID } from "node:crypto";
import { ObjectId, type ClientSession, type MongoClient } from "mongodb";
import type { Collections } from "../../infrastructure/mongodb/collections.js";
import * as repository from "../../infrastructure/mongodb/subscription-repository.js";
import { conflict, forbidden, notFound } from "../../shared/errors.js";
import { isDuplicateKeyError } from "../../shared/mongo-retry.js";
import type { SubscriptionPlan, SubscriptionRecord } from "../../shared/types/subscriptions.js";
import {
  canUseHistoryWindow,
  isActiveSubscription,
  maxHistoryWindowDays,
  publicSubscription,
  subscriptionExpiry,
} from "./policy.js";

export async function getSubscription(collections: Collections, ownerUserId: string) {
  return publicSubscription(await repository.findCurrentSubscription(collections, ownerUserId));
}

export async function requirePro(collections: Collections, ownerUserId: string) {
  const subscription = await getSubscription(collections, ownerUserId);
  if (subscription.tier !== "pro") throw forbidden("pro_required", "An active Louma Pro subscription is required.");
  return subscription;
}

/** Resolve a requested history window against the current MongoDB-backed subscription. */
export async function historyWindowDays(
  collections: Collections,
  ownerUserId: string,
  requestedDays?: number,
): Promise<number> {
  const subscription = await getSubscription(collections, ownerUserId);
  const days = requestedDays ?? maxHistoryWindowDays(subscription.tier);
  if (!canUseHistoryWindow(subscription.tier, days)) {
    throw forbidden("pro_required", "This history range requires an active Louma Pro subscription.");
  }
  return days;
}

export async function lockPro(collections: Collections, ownerUserId: string, session: ClientSession) {
  const subscription = await repository.lockActiveSubscription(collections, ownerUserId, new Date(), session);
  if (!subscription) throw forbidden("pro_required", "An active Louma Pro subscription is required.");
  return subscription;
}

/** Called inside a transaction, including when another account immediately reclaims an alias. */
export async function releaseInactiveAddress(collections: Collections, ownerUserId: string, now: Date, session: ClientSession, closeStatus: "expired" | null = "expired"): Promise<boolean> {
  const subscription = await repository.findCurrentSubscription(collections, ownerUserId, session);
  if (isActiveSubscription(subscription, now)) return false;
  if (subscription && closeStatus) await repository.closeSubscription(collections, subscription, closeStatus, now, session);
  const wallet = await repository.findPrimaryAddressWallet(collections, ownerUserId, session);
  if (wallet && wallet.customAddress !== null) {
    if (!await repository.changeWalletAddress({ collections, wallet, address: null, subscriptionId: subscription?.publicId ?? null,
      reason: subscription ? "subscription_expired" : "subscription_inactive", now, session })) {
      throw conflict("address_change_conflict", "The wallet changed. Try again.");
    }
  }
  return true;
}

/** Only trusted operator tooling calls this service; no customer activation API exists. */
export async function grantSubscription(input: {
  collections: Collections; mongoClient: MongoClient; ownerUserId: string;
  plan: SubscriptionPlan; activationKey: string; createdBy: string;
}) {
  const now = new Date();
  const recordId = randomUUID();
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await repository.subscriptionTransaction(input.mongoClient, async (session) => {
        const prior = await repository.findActivation(input.collections, input.activationKey, session);
        if (prior) {
          if (prior.ownerUserId !== input.ownerUserId || prior.plan !== input.plan) {
            throw conflict("activation_key_reused", "This activation key belongs to a different subscription.");
          }
          return publicSubscription(await repository.findCurrentSubscription(input.collections, input.ownerUserId, session), now);
        }
        const owner = await repository.findActiveOwner(input.collections, input.ownerUserId, session);
        if (!owner) throw notFound();
        const current = await repository.findCurrentSubscription(input.collections, input.ownerUserId, session);
        const active = isActiveSubscription(current, now);
        if (active && current?.plan === "lifetime") throw conflict("lifetime_already_active", "This account already has lifetime Pro.");
        if (!active) await releaseInactiveAddress(input.collections, input.ownerUserId, now, session, null);
        const base = active && current?.expiresAt ? current.expiresAt : now;
        const record: SubscriptionRecord = {
          _id: new ObjectId(), publicId: recordId, ownerUserId: input.ownerUserId, name: "Louma Pro", plan: input.plan,
          status: "active", startsAt: now, expiresAt: subscriptionExpiry(input.plan, base), endedAt: null,
          createdAt: now, createdBy: input.createdBy, activationKey: input.activationKey, version: 0,
        };
        await repository.insertSubscriptionGrant(input.collections, record, session);
        if (!current) {
          await repository.insertSubscription(input.collections, record, session);
          return publicSubscription(record, now);
        }
        return publicSubscription(await repository.updateCurrentSubscription(input.collections, current, record, session), now);
      });
    } catch (error) {
      // Concurrent first activations converge through the authoritative unique owner/key indexes.
      if (!isDuplicateKeyError(error) || attempt === 3) throw error;
    }
  }
  throw new Error("Subscription activation retries exhausted");
}

export async function sweepSubscriptions(input: { collections: Collections; mongoClient: MongoClient; afterAddress: string | null }) {
  const expired = await repository.listExpiredSubscriptions(input.collections, new Date());
  for (const row of expired) {
    await repository.subscriptionTransaction(input.mongoClient, (session) => releaseInactiveAddress(input.collections, row.ownerUserId, new Date(), session));
  }
  // Also archives legacy aliases on free accounts, without an unbounded startup migration.
  const wallets = await repository.listAddressSweepCandidates(input.collections, input.afterAddress);
  for (const wallet of wallets) {
    await repository.subscriptionTransaction(input.mongoClient, (session) => releaseInactiveAddress(input.collections, wallet.ownerUserId, new Date(), session));
  }
  return wallets.length === 100 ? wallets[wallets.length - 1]?.customAddressNormalized ?? null : null;
}
