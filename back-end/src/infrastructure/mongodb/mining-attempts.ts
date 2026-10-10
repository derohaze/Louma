import type { Collections } from "./collections.js";
import { isDuplicateKeyError } from "../../shared/mongo-retry.js";

export interface MiningAttemptRecord { _id: string; attempts: Date[]; expiresAt: Date }

/** Atomic sliding window shared by all API instances. Database time, no IP or Redis dependency. */
export async function consumeMiningAttempt(
  collections: Pick<Collections, "miningDeviceAttempts">,
  id: string,
  limit: number,
  windowMs: number,
): Promise<boolean> {
  try {
    await collections.miningDeviceAttempts.updateOne({ _id: id }, [{ $set: {
      attempts: { $ifNull: ["$attempts", []] },
      expiresAt: { $add: ["$$NOW", windowMs] },
    } }], { upsert: true, writeConcern: { w: "majority" } });
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error;
  }
  const recent = { $filter: {
    input: "$attempts", as: "at", cond: { $gt: ["$$at", { $subtract: ["$$NOW", windowMs] }] },
  } };
  const result = await collections.miningDeviceAttempts.updateOne(
    { _id: id, $expr: { $lt: [{ $size: recent }, limit] } },
    [{ $set: { attempts: { $concatArrays: [recent, ["$$NOW"]] }, expiresAt: { $add: ["$$NOW", windowMs] } } }],
    { writeConcern: { w: "majority" } },
  );
  return result.matchedCount === 1;
}
