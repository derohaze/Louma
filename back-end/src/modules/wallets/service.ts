import { randomUUID } from "node:crypto";
import { ObjectId, type ClientSession } from "mongodb";
import type { Collections } from "../../infrastructure/mongodb/collections.js";
import { isCanonicalWalletAddressDuplicate } from "../../infrastructure/mongodb/wallet-errors.js";
import { recordSecurityEvent } from "../security/audit.js";
import { formatMoney } from "../ledger/money.js";
import { badRequest, conflict, notFound } from "../../shared/errors.js";
import type { PublicWallet, WalletRecord } from "../../shared/types.js";
import { generateWalletAddress, isValidWalletAddress, normalizeWalletAddress } from "./address.js";

const MAX_ADDRESS_COLLISION_ATTEMPTS = 3;

function publicWallet(wallet: WalletRecord, balanceMinor: number): PublicWallet {
  return {
    id: wallet.publicId,
    address: wallet.address,
    status: wallet.status,
    balance: formatMoney(balanceMinor),
    currency: "LMA",
    createdAt: wallet.createdAt.toISOString(),
    customAddressChangedAt: wallet.customAddressChangedAt?.toISOString() ?? null,
    customAddress: wallet.customAddress,
  };
}

/**
 * A duplicate canonical address aborts its MongoDB transaction. The caller therefore retries its
 * whole short transaction, so the user and ledger account are rolled back before another address
 * candidate is generated.
 */
export async function withWalletAddressCollisionRetry<T>(operation: () => Promise<T>): Promise<T> {
  for (let attempt = 1; attempt <= MAX_ADDRESS_COLLISION_ATTEMPTS; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (!isCanonicalWalletAddressDuplicate(error) || attempt === MAX_ADDRESS_COLLISION_ATTEMPTS) throw error;
    }
  }
  throw new Error("Wallet address retry loop did not return");
}

/** Creates a primary wallet and its ledger account in the caller's registration transaction. */
export async function provisionPrimaryWallet(input: {
  collections: Collections;
  ownerUserId: string;
  session: ClientSession;
  now: Date;
}): Promise<WalletRecord> {
  const address = generateWalletAddress();
  const wallet = {
    _id: new ObjectId(),
    publicId: randomUUID(),
    address,
    addressNormalized: address,
    addressVersion: 1,
    ownerUserId: input.ownerUserId,
    isPrimary: true,
    status: "active",
    financialVersion: 0,
    createdAt: input.now,
    updatedAt: input.now,
    customAddressChangedAt: null,
    customAddress: null,
    customAddressNormalized: null,
  } satisfies WalletRecord;
  await input.collections.wallets.insertOne(wallet, { session: input.session });
  await input.collections.ledgerAccounts.insertOne(
    { publicId: randomUUID(), walletId: wallet.publicId, accountType: "wallet", currency: "LMA", balanceMinor: 0, createdAt: input.now } as never,
    { session: input.session },
  );
  return wallet;
}

export function findPrimaryWallet(collections: Collections, ownerUserId: string): Promise<WalletRecord | null> {
  return collections.wallets.findOne({ ownerUserId, isPrimary: true });
}

export async function getWallet(input: { collections: Collections; ownerUserId: string }): Promise<PublicWallet> {
  const wallet = await findPrimaryWallet(input.collections, input.ownerUserId);
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
  const wallet = await findPrimaryWallet(input.collections, input.ownerUserId);
  if (!wallet) throw notFound();
  const result = await input.collections.wallets.updateOne(
    { _id: wallet._id, ownerUserId: input.ownerUserId, isPrimary: true, status: { $ne: status } },
    { $set: { status, updatedAt: now }, $inc: { financialVersion: 1 } },
  );
  if (result.matchedCount === 0) {
    const current = await input.collections.wallets.findOne({ _id: wallet._id, ownerUserId: input.ownerUserId, isPrimary: true });
    if (!current) throw notFound();
  }
  await recordSecurityEvent({ collections: input.collections, ownerUserId: input.ownerUserId, eventType: input.frozen ? "wallet_frozen" : "wallet_unfrozen", outcome: "success", correlationId: input.requestId }).catch(() => undefined);
  return getWallet({ collections: input.collections, ownerUserId: input.ownerUserId });
}

export async function setCustomAddress(input: { collections: Collections; ownerUserId: string; handle: unknown; requestId: string }): Promise<PublicWallet> {
  if (typeof input.handle !== "string") throw badRequest("invalid_custom_address", "Enter a custom address.");
  const handle = input.handle.trim().replace(/^@/, "").toLowerCase();
  if (!/^[a-z0-9_]{4,24}$/.test(handle)) throw badRequest("invalid_custom_address", "Use 4 to 24 letters, numbers, or underscores.");
  const now = new Date();
  const wallet = await findPrimaryWallet(input.collections, input.ownerUserId);
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
  // The change above already landed and its 30-day cooldown is spent, so the audit write must not
  // turn it into a failure a retry cannot undo.
  await recordSecurityEvent({ collections: input.collections, ownerUserId: input.ownerUserId, eventType: "wallet_address_changed", outcome: "success", correlationId: input.requestId }).catch(() => undefined);
  return getWallet({ collections: input.collections, ownerUserId: input.ownerUserId });
}

export async function resolveRecipient(input: { collections: Collections; address: string; senderWalletId: string }) {
  const normalized = input.address.trim();
  let wallet: WalletRecord | null;
  if (isValidWalletAddress(normalized)) {
    wallet = await input.collections.wallets.findOne({ addressNormalized: normalizeWalletAddress(normalized) });
  } else {
    wallet = await input.collections.wallets.findOne({ customAddressNormalized: normalized.replace(/^@/, "").toLowerCase() });
  }
  if (!wallet) throw notFound();
  if (wallet.publicId === input.senderWalletId) throw conflict("self_transfer", "You cannot transfer to your own wallet.");
  return wallet;
}

/**
 * Resolves the single system treasury account, creating it on first use.
 *
 * The treasury is the controlled source every issuance debit lands on (see reconciliation.ts): a
 * reward credits a wallet and debits the treasury in the same balanced transaction, so LMA is never
 * conjured inside a wallet record. A unique partial index on `system_treasury` makes the upsert
 * below converge on one account even when two processes create it at the same moment.
 */
export async function ensureTreasuryAccount(collections: Collections): Promise<string> {
  const existing = await collections.ledgerAccounts.findOne({ accountType: "system_treasury", currency: "LMA" });
  if (existing) return existing.publicId;
  const result = await collections.ledgerAccounts.updateOne(
    { accountType: "system_treasury", currency: "LMA" },
    { $setOnInsert: { publicId: randomUUID(), walletId: null, accountType: "system_treasury", currency: "LMA", balanceMinor: 0, createdAt: new Date() } },
    { upsert: true },
  );
  if (result.upsertedId) {
    const created = await collections.ledgerAccounts.findOne({ _id: result.upsertedId });
    if (created) return created.publicId;
  }
  const resolved = await collections.ledgerAccounts.findOne({ accountType: "system_treasury", currency: "LMA" });
  if (!resolved) throw new Error("Failed to initialize the system treasury account");
  return resolved.publicId;
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
