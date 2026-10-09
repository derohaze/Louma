import type { Collections } from "../../infrastructure/mongodb/collections.js";
import { isCustomerTransaction } from "../../shared/types.js";
import { notFound } from "../../shared/errors.js";
import { publicTransaction } from "./intent.js";

const MAX_PAGE_SIZE = 50;
const CUSTOMER_TRANSACTION_TYPES = ["transfer", "merchant_payment", "merchant_refund"] as const;

/**
 * The receipt keeps its existing navigation ID for transfers and uses the gateway operation ID
 * for payments/refunds, without adding a transfer identity to the shared journal.
 */
export async function getTransaction(input: { collections: Collections; ownerUserId: string; transactionId: string }) {
  const transaction = await input.collections.transactions.findOne({
    $and: [
      { type: { $in: CUSTOMER_TRANSACTION_TYPES } },
      { $or: [{ senderUserId: input.ownerUserId }, { receiverUserId: input.ownerUserId }] },
      { $or: [{ transferId: input.transactionId }, { publicId: input.transactionId }, { operationId: input.transactionId }] },
    ],
  });
  if (!transaction || !isCustomerTransaction(transaction)) throw notFound();
  return publicTransaction(transaction, input.ownerUserId);
}

export async function listTransactions(input: { collections: Collections; ownerUserId: string; cursor: string | undefined; limit: number | undefined; direction: "sent" | "received" | "all" | undefined; days?: number | undefined }) {
  const limit = Math.min(Math.max(input.limit ?? 20, 1), MAX_PAGE_SIZE);
  const cutoff = input.days === undefined ? undefined : new Date(Date.now() - input.days * 24 * 60 * 60 * 1000);
  if (input.direction === "sent" || input.direction === "received") {
    const directionFilter = input.direction === "sent" ? { senderUserId: input.ownerUserId } : { receiverUserId: input.ownerUserId };
    // Mining issuance stays in its separate history while customer payments share receipts.
    const ownerFilter = { type: { $in: CUSTOMER_TRANSACTION_TYPES }, ...directionFilter, ...(cutoff ? { createdAt: { $gte: cutoff } } : {}) };
    const filter: Record<string, unknown> = { ...ownerFilter };
    if (input.cursor) {
      const cursor = await input.collections.transactions.findOne({ publicId: input.cursor, ...ownerFilter }, { projection: { createdAt: 1, publicId: 1 } });
      if (!cursor) throw notFound();
      filter["$and"] = [ownerFilter, { $or: [{ createdAt: { $lt: cursor.createdAt } }, { createdAt: cursor.createdAt, publicId: { $lt: cursor.publicId } }] }];
    }
    // Narrow the shared journal before rendering a customer receipt.
    const transactions = (await input.collections.transactions.find(filter).sort({ createdAt: -1, publicId: -1 }).limit(limit + 1).toArray()).filter(isCustomerTransaction);
    const hasMore = transactions.length > limit;
    const page = transactions.slice(0, limit);
    return { transactions: page.map((item) => publicTransaction(item, input.ownerUserId)), nextCursor: hasMore ? page.at(-1)?.publicId ?? null : null };
  }
  // `participants` is not a required schema field, so a transfer written by an older process after
  // this process's startup backfill has no participant list. Reading only that field would silently
  // drop such a transfer from both sides' combined history until the next backfill, so the `all`
  // direction keeps a legacy fallback on the sender/receiver pair the record always implies.
  //
  // The fallback must not slow the normal page: a single `$or` over all three predicates would make
  // the server fetch and sort the account's whole history on every page instead of the ordered scan
  // the participants index was built for. The two sources are therefore read as two bounded,
  // indexed pages — the participants page off its history index, the not-yet-backfilled remainder
  // off the sender/receiver indexes — and merged in memory over at most 2 * (limit + 1) rows. In
  // steady state the legacy side is empty and costs one cheap empty page.
  const ownerFilter = { type: { $in: CUSTOMER_TRANSACTION_TYPES }, $or: [{ participants: input.ownerUserId }, { senderUserId: input.ownerUserId }, { receiverUserId: input.ownerUserId }] };
  let pageBound: Record<string, unknown> | null = null;
  if (input.cursor) {
    const cursor = await input.collections.transactions.findOne({ publicId: input.cursor, ...ownerFilter }, { projection: { createdAt: 1, publicId: 1 } });
    if (!cursor) throw notFound();
    pageBound = { $or: [{ createdAt: { $lt: cursor.createdAt } }, { createdAt: cursor.createdAt, publicId: { $lt: cursor.publicId } }] };
  }
  const participantsFilter: Record<string, unknown> = { type: { $in: CUSTOMER_TRANSACTION_TYPES }, participants: input.ownerUserId, ...(cutoff ? { createdAt: { $gte: cutoff } } : {}) };
  // `$ne` also matches documents where the field is missing, which is exactly the legacy shape.
  // It is disjoint from the participants branch, so the merge below never sees a row twice.
  const legacyFilter: Record<string, unknown> = {
    $and: [
      { type: "transfer" },
      { $or: [{ senderUserId: input.ownerUserId }, { receiverUserId: input.ownerUserId }] },
      { participants: { $ne: input.ownerUserId } },
      ...(cutoff ? [{ createdAt: { $gte: cutoff } }] : []),
    ],
  };
  const primaryFilter: Record<string, unknown> = pageBound ? { $and: [participantsFilter, pageBound] } : participantsFilter;
  const legacyPageFilter: Record<string, unknown> = pageBound ? { $and: [legacyFilter, pageBound] } : legacyFilter;
  const [primary, legacy] = await Promise.all([
    input.collections.transactions.find(primaryFilter).sort({ createdAt: -1, publicId: -1 }).limit(limit + 1).toArray(),
    input.collections.transactions.find(legacyPageFilter).sort({ createdAt: -1, publicId: -1 }).limit(limit + 1).toArray(),
  ]);
  const seen = new Set<string>();
  const merged = [...primary, ...legacy].filter(isCustomerTransaction)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (b.publicId < a.publicId ? -1 : b.publicId > a.publicId ? 1 : 0))
    .filter((item) => {
      if (seen.has(item.publicId)) return false;
      seen.add(item.publicId);
      return true;
    });
  const hasMore = merged.length > limit;
  const page = merged.slice(0, limit);
  return { transactions: page.map((item) => publicTransaction(item, input.ownerUserId)), nextCursor: hasMore ? page.at(-1)?.publicId ?? null : null };
}
