import { randomUUID } from "node:crypto";
import type { Collections } from "../../infrastructure/mongodb/collections.js";
import { recordSecurityEvent } from "../security/audit.js";
import { formatMoney } from "../ledger/money.js";
import { badRequest, conflict, notFound } from "../../shared/errors.js";
import type { PublicWallet, WalletRecord } from "../../shared/types.js";

function publicWallet(wallet: WalletRecord, balanceMinor: number): PublicWallet {
  return {
    id: wallet.publicId,
    address: wallet.customAddress ?? wallet.address,
    status: wallet.status,
    balance: formatMoney(balanceMinor),
    currency: "LMA",
    createdAt: wallet.createdAt.toISOString(),
    customAddressChangedAt: wallet.customAddressChangedAt?.toISOString() ?? null,
    customAddress: wallet.customAddress,
  };
}

export async function getWallet(input: { collections: Collections; ownerUserId: string }): Promise<PublicWallet> {
  const wallet = await input.collections.wallets.findOne({ ownerUserId: input.ownerUserId });
  if (!wallet) throw notFound();
  // A wallet without its ledger account is a data-integrity fault, not a zero balance: answering
  // 0.0000 here would publish a fictitious balance and hide the drift from every detector.
  const account = await input.collections.ledgerAccounts.findOne({ walletId: wallet.publicId, accountType: "wallet", currency: "LMA" }, { projection: { balanceMinor: 1 } });
  if (!account) throw new Error(`Wallet ${wallet.publicId} has no LMA ledger account`);
  return publicWallet(wallet, account.balanceMinor);
}

export async function setWalletFrozen(input: { collections: Collections; ownerUserId: string; frozen: boolean; requestId: string }): Promise<PublicWallet> {
  const status = input.frozen ? "frozen" : "active";
  const now = new Date();
  // Bumping `financialVersion` here is the other half of the transfer/freeze conflict boundary: a
  // transfer in flight holds its own increment inside its transaction, so whichever lands second
  // serialises after the first and the wallet state the transfer saw is the one that decides.
  const result = await input.collections.wallets.updateOne(
    { ownerUserId: input.ownerUserId, status: { $ne: status } },
    { $set: { status, updatedAt: now }, $inc: { financialVersion: 1 } },
  );
  if (result.matchedCount === 0) {
    const wallet = await input.collections.wallets.findOne({ ownerUserId: input.ownerUserId });
    if (!wallet) throw notFound();
  }
  await recordSecurityEvent({ collections: input.collections, ownerUserId: input.ownerUserId, eventType: input.frozen ? "wallet_frozen" : "wallet_unfrozen", outcome: "success", correlationId: input.requestId });
  return getWallet({ collections: input.collections, ownerUserId: input.ownerUserId });
}

export async function setCustomAddress(input: { collections: Collections; ownerUserId: string; handle: unknown; requestId: string }): Promise<PublicWallet> {
  if (typeof input.handle !== "string") throw badRequest("invalid_custom_address", "Enter a custom address.");
  const handle = input.handle.trim().replace(/^@/, "").toLowerCase();
  if (!/^[a-z0-9_]{4,24}$/.test(handle)) throw badRequest("invalid_custom_address", "Use 4 to 24 letters, numbers, or underscores.");
  const now = new Date();
  const wallet = await input.collections.wallets.findOne({ ownerUserId: input.ownerUserId });
  if (!wallet) throw notFound();
  if (wallet.customAddressChangedAt && now.getTime() - wallet.customAddressChangedAt.getTime() < 30 * 24 * 60 * 60 * 1000) {
    throw conflict("address_change_cooldown", "The receiving address can only be changed once every 30 days.");
  }
  try {
    const result = await input.collections.wallets.updateOne({ _id: wallet._id, ownerUserId: input.ownerUserId, customAddressChangedAt: wallet.customAddressChangedAt }, { $set: { customAddress: `@${handle}`, customAddressNormalized: handle, customAddressChangedAt: now, updatedAt: now } });
    if (result.modifiedCount !== 1) throw conflict("address_change_conflict", "The wallet changed. Refresh and try again.");
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === 11000) throw conflict("address_unavailable", "That custom address is already in use.");
    throw error;
  }
  await recordSecurityEvent({ collections: input.collections, ownerUserId: input.ownerUserId, eventType: "wallet_address_changed", outcome: "success", correlationId: input.requestId });
  return getWallet({ collections: input.collections, ownerUserId: input.ownerUserId });
}

export async function resolveRecipient(input: { collections: Collections; address: string; senderUserId: string }) {
  const normalized = input.address.trim().toLowerCase();
  const wallet = await input.collections.wallets.findOne({ $or: [{ addressNormalized: normalized.toUpperCase() }, { customAddressNormalized: normalized.replace(/^@/, "") }] });
  if (!wallet) throw notFound();
  if (wallet.ownerUserId === input.senderUserId) throw conflict("self_transfer", "You cannot transfer to your own wallet.");
  return wallet;
}

export async function ensureFeeAccount(collections: Collections): Promise<string> {
  const revenueAccount = await collections.ledgerAccounts.findOne({ accountType: "fee_revenue", currency: "LMA" });
  if (revenueAccount) return revenueAccount.publicId;
  const result = await collections.ledgerAccounts.updateOne({ accountType: "fee_revenue", currency: "LMA" }, { $setOnInsert: { publicId: randomUUID(), walletId: null, accountType: "fee_revenue", currency: "LMA", balanceMinor: 0, createdAt: new Date() } }, { upsert: true });
  if (result.upsertedId) {
    const created = await collections.ledgerAccounts.findOne({ _id: result.upsertedId });
    if (created) return created.publicId;
  }
  const existing = await collections.ledgerAccounts.findOne({ accountType: "fee_revenue", currency: "LMA" });
  if (!existing) throw new Error("Failed to initialize the fee ledger account");
  return existing.publicId;
}
