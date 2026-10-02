import type { Collections } from "../../infrastructure/mongodb/collections.js";
import type { AppConfig } from "../../config/env.js";
import { notFound } from "../../shared/errors.js";
import type { PublicMiningSession } from "../../shared/types.js";
import { toPublicSession } from "./state.js";

const MAX_PAGE_SIZE = 50;

/** One page of the account's cycles, newest first, cursor-paged on (createdAt, publicId). */
export async function listMiningHistory(input: {
  collections: Collections;
  config: Pick<AppConfig, "mining" | "miningPools">;
  ownerUserId: string;
  cursor: string | undefined;
  limit: number | undefined;
}): Promise<{ sessions: PublicMiningSession[]; nextCursor: string | null }> {
  const limit = Math.min(Math.max(input.limit ?? 20, 1), MAX_PAGE_SIZE);
  const filter: Record<string, unknown> = { ownerUserId: input.ownerUserId };
  if (input.cursor) {
    const cursor = await input.collections.miningSessions.findOne(
      { publicId: input.cursor, ownerUserId: input.ownerUserId },
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
  return {
    sessions: page.map((record) => toPublicSession(record, nowMs)),
    nextCursor: hasMore ? (page.at(-1)?.publicId ?? null) : null,
  };
}
