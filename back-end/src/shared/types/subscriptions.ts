import type { ObjectId } from "mongodb";

export type SubscriptionPlan = "monthly" | "yearly" | "lifetime";

export interface SubscriptionRecord {
  _id: ObjectId;
  publicId: string;
  ownerUserId: string;
  name: "Louma Pro";
  plan: SubscriptionPlan;
  status: "active" | "expired" | "superseded";
  startsAt: Date;
  expiresAt: Date | null;
  endedAt: Date | null;
  createdAt: Date;
  createdBy: string;
  activationKey: string;
  version: number;
}

export interface PublicSubscription {
  serverNow: string;
  tier: "free" | "pro";
  plan: SubscriptionPlan | null;
  startsAt: string | null;
  expiresAt: string | null;
}

export interface WalletAddressHistoryRecord {
  _id: ObjectId;
  publicId: string;
  ownerUserId: string;
  walletId: string;
  subscriptionId: string | null;
  previousAddress: string;
  nextAddress: string;
  reason: "changed" | "subscription_expired" | "subscription_inactive";
  createdAt: Date;
}
