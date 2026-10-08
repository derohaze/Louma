import { randomUUID } from "node:crypto";
import { ObjectId, type ClientSession, type MongoClient } from "mongodb";
import type { Collections } from "./collections.js";
import type { SubscriptionRecord, WalletAddressHistoryRecord } from "../../shared/types/subscriptions.js";
import type { WalletRecord } from "../../shared/types.js";

export async function subscriptionTransaction<T>(client: MongoClient, operation: (session: ClientSession) => Promise<T>): Promise<T> {
  const session = client.startSession();
  try {
    return await session.withTransaction(() => operation(session), {
      readConcern: { level: "snapshot" }, writeConcern: { w: "majority" },
      maxCommitTimeMS: 5000, timeoutMS: 15000,
    });
  } finally {
    await session.endSession();
  }
}

export function findCurrentSubscription(collections: Collections, ownerUserId: string, session?: ClientSession) {
  return collections.subscriptions.findOne({ ownerUserId, status: "active" }, session ? { session } : {});
}

export function lockActiveSubscription(collections: Collections, ownerUserId: string, now: Date, session: ClientSession) {
  return collections.subscriptions.findOneAndUpdate(
    { ownerUserId, status: "active", startsAt: { $lte: now }, $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }] },
    { $inc: { version: 1 } }, { session, returnDocument: "after" },
  );
}

export function findActivation(collections: Collections, activationKey: string, session: ClientSession) {
  return collections.subscriptions.findOne({ activationKey }, { session });
}

export function findActiveOwner(collections: Collections, ownerUserId: string, session: ClientSession) {
  return collections.users.findOne({ publicId: ownerUserId, status: "active" }, { session, projection: { publicId: 1 } });
}

export async function closeSubscription(collections: Collections, record: SubscriptionRecord, status: "expired" | "superseded", now: Date, session: ClientSession) {
  await collections.subscriptions.updateOne({ _id: record._id, status: "active" }, { $set: { status, endedAt: now }, $inc: { version: 1 } }, { session });
}

export async function insertSubscription(collections: Collections, record: SubscriptionRecord, session: ClientSession) {
  await collections.subscriptions.insertOne(record, { session });
}

/** The wallet write conflicts with alias-based transfers; the archive commits with it. */
export async function changeWalletAddress(input: {
  collections: Collections; wallet: WalletRecord; address: string | null;
  subscriptionId: string | null; reason: WalletAddressHistoryRecord["reason"];
  now: Date; session: ClientSession;
}): Promise<boolean> {
  const { wallet, session, now, collections, address } = input;
  const updated = await collections.wallets.updateOne(
    { _id: wallet._id, customAddressNormalized: wallet.customAddressNormalized, customAddressChangedAt: wallet.customAddressChangedAt },
    { $set: { customAddress: address, customAddressNormalized: address, updatedAt: now, ...(address !== null ? { customAddressChangedAt: now } : {}) }, $inc: { financialVersion: 1 } },
    { session },
  );
  if (updated.modifiedCount !== 1) return false;
  await collections.walletAddressHistory.insertOne({
    _id: new ObjectId(), publicId: randomUUID(), ownerUserId: wallet.ownerUserId, walletId: wallet.publicId,
    subscriptionId: input.subscriptionId, previousAddress: wallet.customAddress ?? wallet.address,
    nextAddress: address ?? wallet.address, reason: input.reason, createdAt: now,
  }, { session });
  return true;
}

export function findPrimaryAddressWallet(collections: Collections, ownerUserId: string, session: ClientSession) {
  return collections.wallets.findOne({ ownerUserId, isPrimary: true }, { session });
}

export async function guardRecipientCustomAddress(collections: Collections, walletId: string, address: string, session: ClientSession) {
  const result = await collections.wallets.updateOne({ publicId: walletId, customAddressNormalized: address }, { $inc: { financialVersion: 1 } }, { session });
  return result.modifiedCount === 1;
}

export function listAddressHistory(collections: Collections, ownerUserId: string) {
  return collections.walletAddressHistory.find({ ownerUserId }).sort({ createdAt: -1, publicId: -1 }).limit(20).toArray();
}

export function listExpiredSubscriptions(collections: Collections, now: Date) {
  return collections.subscriptions.find({ status: "active", expiresAt: { $lte: now, $type: "date" } }).sort({ expiresAt: 1 }).limit(100).toArray();
}

export function listAddressSweepCandidates(collections: Collections, after: string | null) {
  return collections.wallets.find({ customAddressNormalized: after === null ? { $type: "string" } : { $type: "string", $gt: after } })
    .sort({ customAddressNormalized: 1 }).limit(100).toArray();
}
