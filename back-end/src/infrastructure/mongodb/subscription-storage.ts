import type { Db } from "mongodb";
import { schemas } from "./schemas.js";
import { ensureCollection } from "./validators.js";

/** Additive installation shared by API startup and trusted operator tooling. */
export async function ensureSubscriptionStorage(db: Db) {
  await ensureCollection(db, "subscriptions", schemas["subscriptions"]!);
  await ensureCollection(db, "wallet_address_history", schemas["wallet_address_history"]!);
  await Promise.all([
    db.collection("subscriptions").createIndex({ publicId: 1 }, { unique: true, name: "subscriptions_public_id_unique" }),
    // Activation retries and concurrent grants cannot create multiple current subscriptions.
    db.collection("subscriptions").createIndex({ activationKey: 1 }, { unique: true, name: "subscriptions_activation_unique" }),
    db.collection("subscriptions").createIndex({ ownerUserId: 1 }, { unique: true, partialFilterExpression: { status: "active" }, name: "subscriptions_owner_active_unique" }),
    // Bounded expiry sweep; historical rows deliberately have no TTL.
    db.collection("subscriptions").createIndex({ status: 1, expiresAt: 1 }, { name: "subscriptions_expiry" }),
    // Latest twenty address changes for one authenticated owner.
    db.collection("wallet_address_history").createIndex({ ownerUserId: 1, createdAt: -1, publicId: -1 }, { name: "wallet_address_history_owner" }),
  ]);
}
