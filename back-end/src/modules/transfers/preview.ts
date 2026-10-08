import { randomUUID } from "node:crypto";
import { ObjectId } from "mongodb";
import type { Collections } from "../../infrastructure/mongodb/collections.js";
import { displayNameKey, readThrough, type CacheContext } from "../../infrastructure/redis/cache.js";
import { isValidCustomAddress } from "../wallets/custom-address.js";
import { resolveRecipient } from "../wallets/service.js";
import { findPrimaryWallet } from "../wallets/service.js";
import { calculateTransferAmounts, formatMoney, parseMoneyToMinorUnits } from "../ledger/money.js";
import {
  TRANSFER_AUTHORIZATION_RETENTION_MS,
  TRANSFER_AUTHORIZATION_TTL_MS,
  type TransferAuthorizationRecord,
  type TransferIntent,
} from "../../shared/types.js";
import { notFound } from "../../shared/errors.js";
import {
  intentHashOf,
  maskDisplayName,
  normalizeNote,
  parseRecipientAddress,
  publicAuthorization,
} from "./intent.js";

/**
 * The staged transfer form's own read: it resolves the address the sender typed and, once an amount
 * is offered, quotes exactly what the ledger would charge for it — and issues the approval the
 * transfer will consume.
 *
 * The tax and the balance the sender confirms are the server's numbers, computed by the same
 * arithmetic the transfer itself uses, instead of the page's own copy of the rule. When an amount is
 * present the read also mints a `transfer_authorizations` row: the canonical recipient, the three
 * amounts, the currency and the note, hashed. That row is the only description of the transfer the
 * sender is asked to approve — the transfer executes *it*, not the request that follows — so the
 * parameters cannot change between the approval the sender gave and the money that moves, however
 * the client is written or whatever it is tricked into sending.
 *
 * Issuing an approval moves no money: it is a promise the server makes to itself about one intent,
 * and it stops existing when it is consumed or expires.
 */
/**
 * The recipient's display name for preview masking, cached briefly. Cosmetic: the transfer
 * executes wallet ids, never this string. Invalidated when the profile changes.
 */
export async function loadDisplayName(
  collections: Collections,
  ownerUserId: string,
  cache?: CacheContext | undefined,
): Promise<string> {
  if (!cache) {
    const owner = await collections.users.findOne({ publicId: ownerUserId }, { projection: { "profile.displayName": 1 } });
    return owner?.profile.displayName ?? "";
  }
  const read = await readThrough({
    redis: cache.redis,
    key: displayNameKey(cache.redis, ownerUserId),
    ttlSeconds: cache.ttlSeconds,
    load: () => collections.users.findOne({ publicId: ownerUserId }, { projection: { "profile.displayName": 1 } }),
  });
  const name = (read.value as { profile?: { displayName?: unknown } } | null)?.profile?.displayName;
  return typeof name === "string" ? name : "";
}

export async function previewTransfer(input: {
  collections: Collections;
  ownerUserId: string;
  recipientAddress: unknown;
  amount?: unknown;
  note?: unknown;
  /** The request the approval is issued for, so the approval can be correlated to it afterwards. */
  requestId: string;
  /** Brief cache for the cosmetic display-name masking. Absent in tests. */
  displayNameCache?: CacheContext | undefined;
}) {
  const recipientAddress = parseRecipientAddress(input.recipientAddress);
  const senderWallet = await findPrimaryWallet(input.collections, input.ownerUserId);
  if (!senderWallet) throw notFound();
  // Resolving is also the check the sender is asking for: a typo, an address that never existed, or
  // the sender's own wallet all fail here, before any amount is discussed.
  const recipientWallet = await resolveRecipient({ collections: input.collections, address: recipientAddress, senderWalletId: senderWallet.publicId });
  // Cosmetic masking only: a stale display name mis-masks, never misroutes (the transfer executes
  // the wallet ids in the approval, resolved fresh above). Cached briefly to keep the preview cheap.
  const displayName = await loadDisplayName(input.collections, recipientWallet.ownerUserId, input.displayNameCache);
  const recipient = {
    /** The canonical address the transfer will credit — not the spelling the sender typed. */
    address: recipientWallet.address,
    displayName: maskDisplayName(displayName),
  };
  if (input.amount === undefined) return { recipient, quote: null, authorization: null };

  const amounts = calculateTransferAmounts(parseMoneyToMinorUnits(input.amount));
  const note = normalizeNote(input.note);
  const senderAccount = await input.collections.ledgerAccounts.findOne(
    { walletId: senderWallet.publicId, accountType: "wallet", currency: "LMA" },
    { projection: { balanceMinor: 1 } },
  );
  if (!senderAccount) throw new Error("Wallet ledger account is missing");
  const now = new Date();
  const intent: TransferIntent = {
    recipientWalletId: recipientWallet.publicId,
    recipientUserId: recipientWallet.ownerUserId,
    recipientAddress: recipient.address,
    ...(isValidCustomAddress(recipientAddress) ? { recipientCustomAddress: recipientAddress.toLowerCase() } : {}),
    amountMinor: amounts.amountMinor,
    feeMinor: amounts.feeMinor,
    netAmountMinor: amounts.netAmountMinor,
    currency: "LMA",
    note,
  };
  const record: TransferAuthorizationRecord = {
    _id: new ObjectId(),
    publicId: randomUUID(),
    ownerUserId: input.ownerUserId,
    senderWalletId: senderWallet.publicId,
    intent,
    intentHash: intentHashOf(intent, senderWallet.publicId),
    // The credential versions the approval was *consumed* under, written by the consume itself:
    // what was proven is a fact about the transfer, not about the quote.
    passwordChangedAt: null,
    twoFactorEnabledAt: null,
    consumedAt: null,
    consumedByTransactionPublicId: null,
    correlationId: input.requestId,
    createdAt: now,
    expiresAt: new Date(now.getTime() + TRANSFER_AUTHORIZATION_TTL_MS),
    retainUntil: new Date(now.getTime() + TRANSFER_AUTHORIZATION_TTL_MS + TRANSFER_AUTHORIZATION_RETENTION_MS),
  };
  await input.collections.transferAuthorizations.insertOne(record);
  return {
    recipient,
    quote: {
      amount: formatMoney(amounts.amountMinor),
      fee: formatMoney(amounts.feeMinor),
      netAmount: formatMoney(amounts.netAmountMinor),
      balance: formatMoney(senderAccount.balanceMinor),
      balanceAfter: formatMoney(Math.max(senderAccount.balanceMinor - amounts.amountMinor, 0)),
      sufficient: senderAccount.balanceMinor >= amounts.amountMinor,
    },
    authorization: publicAuthorization(record),
  };
}
