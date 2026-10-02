import type { Collections } from "../../infrastructure/mongodb/collections.js";
import { isTransferTransaction } from "../../shared/types.js";
import { notFound } from "../../shared/errors.js";
import { publicTransaction } from "./intent.js";

const MAX_PAGE_SIZE = 50;

/**
 * One transfer, by either identifier the API hands out: the public `id` and the `transferId` are
 * both uuids a client may have kept, and looking up only one of them answered 404 for the other.
 */
export async function getTransaction(input: { collections: Collections; ownerUserId: string; transactionId: string }) {
  const transaction = await input.collections.transactions.findOne({
    $and: [
      { type: "transfer" },
      { $or: [{ senderUserId: input.ownerUserId }, { receiverUserId: input.ownerUserId }] },
      { $or: [{ transferId: input.transactionId }, { publicId: input.transactionId }] },
    ],
  });
  if (!transaction || !isTransferTransaction(transaction)) throw notFound();
  return publicTransaction(transaction, input.ownerUserId);
}

export async function listTransactions(input: { collections: Collections; ownerUserId: string; cursor: string | undefined; limit: number | undefined; direction: "sent" | "received" | "all" | undefined }) {
  const limit = Math.min(Math.max(input.limit ?? 20, 1), MAX_PAGE_SIZE);
  if (input.direction === "sent" || input.direction === "received") {
    const directionFilter = input.direction === "sent" ? { senderUserId: input.ownerUserId } : { receiverUserId: input.ownerUserId };
    // Mining issuance headers share this collection and must never surface in transfer history.
    const ownerFilter = { type: "transfer" as const, ...directionFilter };
    const filter: Record<string, unknown> = { ...ownerFilter };
    if (input.cursor) {
      const cursor = await input.collections.transactions.findOne({ publicId: input.cursor, ...ownerFilter }, { projection: { createdAt: 1, publicId: 1 } });
      if (!cursor) throw notFound();
      filter["$and"] = [ownerFilter, { $or: [{ createdAt: { $lt: cursor.createdAt } }, { createdAt: cursor.createdAt, publicId: { $lt: cursor.publicId } }] }];
    }
    // The guard is identity while the collection validator holds (the filter only matches transfer
    // headers); it keeps the journal union from leaking a mining shape into the transfer view.
    const transactions = (await input.collections.transactions.find(filter).sort({ createdAt: -1, publicId: -1 }).limit(limit + 1).toArray()).filter(isTransferTransaction);
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
  const ownerFilter = { $or: [{ participants: input.ownerUserId }, { senderUserId: input.ownerUserId }, { receiverUserId: input.ownerUserId }] };
  let pageBound: Record<string, unknown> | null = null;
  if (input.cursor) {
    const cursor = await input.collections.transactions.findOne({ publicId: input.cursor, ...ownerFilter }, { projection: { createdAt: 1, publicId: 1 } });
    if (!cursor) throw notFound();
    pageBound = { $or: [{ createdAt: { $lt: cursor.createdAt } }, { createdAt: cursor.createdAt, publicId: { $lt: cursor.publicId } }] };
  }
  const participantsFilter: Record<string, unknown> = { type: "transfer", participants: input.ownerUserId };
  // `$ne` also matches documents where the field is missing, which is exactly the legacy shape.
  // It is disjoint from the participants branch, so the merge below never sees a row twice.
  const legacyFilter: Record<string, unknown> = {
    $and: [
      { type: "transfer" },
      { $or: [{ senderUserId: input.ownerUserId }, { receiverUserId: input.ownerUserId }] },
      { participants: { $ne: input.ownerUserId } },
    ],
  };
  const primaryFilter: Record<string, unknown> = pageBound ? { $and: [participantsFilter, pageBound] } : participantsFilter;
  const legacyPageFilter: Record<string, unknown> = pageBound ? { $and: [legacyFilter, pageBound] } : legacyFilter;
  const [primary, legacy] = await Promise.all([
    input.collections.transactions.find(primaryFilter).sort({ createdAt: -1, publicId: -1 }).limit(limit + 1).toArray(),
    input.collections.transactions.find(legacyPageFilter).sort({ createdAt: -1, publicId: -1 }).limit(limit + 1).toArray(),
  ]);
  const seen = new Set<string>();
  const merged = [...primary, ...legacy].filter(isTransferTransaction)
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
