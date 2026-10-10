import type { Collections } from "../../infrastructure/mongodb/collections.js";
import { consumeMiningAttempt } from "../../infrastructure/mongodb/mining-attempts.js";
import { serviceUnavailable, tooManyAttempts } from "../../shared/errors.js";
import { MINING_ATTEMPT_LIMITS } from "./policy.js";

export async function enforceMiningAttempt(collections: Collections, ownerUserId: string, action: keyof typeof MINING_ATTEMPT_LIMITS) {
  const { limit, windowMs } = MINING_ATTEMPT_LIMITS[action];
  const allowed = await consumeMiningAttempt(collections, `${ownerUserId}:${action}`, limit, windowMs)
    .catch(() => { throw serviceUnavailable("mining_start_busy", "Mining verification is busy. Try again."); });
  if (!allowed) throw tooManyAttempts();
}
