import type { Collections } from "../../infrastructure/mongodb/collections.js";
import type { AppConfig } from "../../config/env.js";
import { notFound } from "../../shared/errors.js";
import { formatMoney } from "../ledger/money.js";
import { isMiningTransaction, type PublicMiningSession } from "../../shared/types.js";
import { toPublicSession } from "./state.js";

const MAX_PAGE_SIZE = 50;

/** One page of the account's cycles, newest first, cursor-paged on (createdAt, publicId). */
export async function listMiningHistory(input: {
  collections: Collections;
  config: Pick<AppConfig, "mining" | "miningPools">;
  ownerUserId: string;
  cursor: string | undefined;
  limit: number | undefined;
  days: number;
}): Promise<{ sessions: PublicMiningSession[]; nextCursor: string | null }> {
  const limit = Math.min(Math.max(input.limit ?? 20, 1), MAX_PAGE_SIZE);
  const cutoff = new Date(Date.now() - input.days * 24 * 60 * 60 * 1000);
  const filter: Record<string, unknown> = { ownerUserId: input.ownerUserId, createdAt: { $gte: cutoff } };
  if (input.cursor) {
    const cursor = await input.collections.miningSessions.findOne(
      { publicId: input.cursor, ownerUserId: input.ownerUserId, createdAt: { $gte: cutoff } },
      { projection: { createdAt: 1, publicId: 1 } },
    );
    if (!cursor) throw notFound();
    filter["$and"] = [
      { ownerUserId: input.ownerUserId },
      { $or: [{ createdAt: { $lt: cursor.createdAt } }, { createdAt: cursor.createdAt, publicId: { $lt: cursor.publicId } }] },
    ];
  }
  const sessions = await input.collections.miningSessions
    .find(filter)
    .sort({ createdAt: -1, publicId: -1 })
    .limit(limit + 1)
    .toArray();
  const hasMore = sessions.length > limit;
  const page = sessions.slice(0, limit);
  const nowMs = Date.now();
  // Each cycle's posted payouts, in one batch keyed by cycle, so a dashboard can place every reward
  // on the day it actually landed instead of assuming the latest settlement carried the whole total.
  const sessionIds = page.map((record) => record.publicId);
  const settlementRows = sessionIds.length
    ? await input.collections.transactions
        .find(
          { type: "mining", miningSessionId: { $in: sessionIds } },
          { projection: { miningSessionId: 1, amountMinor: 1, createdAt: 1, sequenceNumber: 1 } },
        )
        .sort({ sequenceNumber: 1 })
        .toArray()
    : [];
  const settlementsBySession = new Map<string, { amount: string; at: string }[]>();
  for (const row of settlementRows) {
    if (!isMiningTransaction(row)) continue;
    const list = settlementsBySession.get(row.miningSessionId) ?? [];
    list.push({ amount: formatMoney(row.amountMinor), at: row.createdAt.toISOString() });
    settlementsBySession.set(row.miningSessionId, list);
  }
  return {
    sessions: page.map((record) => ({
      ...toPublicSession(record, nowMs),
      settlements: settlementsBySession.get(record.publicId) ?? [],
    })),
    nextCursor: hasMore ? (page.at(-1)?.publicId ?? null) : null,
  };
}
