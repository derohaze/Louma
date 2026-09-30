import type { Collections } from "../../infrastructure/mongodb/collections.js";
import type { MiningDeviceRecord, MiningDeviceTrustState } from "../../shared/types.js";
import { ENROLLMENT_DAY_MS, ENROLLMENT_HOUR_MS, MAX_CONSISTENCY_FINDINGS } from "./policy.js";

/**
 * LMDG device enrollment: identity creation is a budgeted, server-owned transition.
 *
 * The trust boundary this module implements: a client's evidence may *propose* a machine identity,
 * but it can never name one. A new machine identity is not a consequence of a syntactically valid
 * payload — it is a server-side enrollment that (a) is rate-limited per account and per network, and
 * (b) starts `provisional`, earning `established` only through repeated admitted observations or a
 * verified proof of possession. Everything here is deterministic and database-backed; no clock is
 * read implicitly.
 */

export type EnrollmentScope = "account" | "network";

export interface EnrollmentLimitHit {
  scope: EnrollmentScope;
  limit: number;
  count: number;
  windowMs: number;
}

interface CounterResult {
  allowed: boolean;
  count: number;
}

/**
 * Atomically consumes one unit from a fixed-window counter.
 *
 * The unit is consumed by a single `$inc` upsert on a deterministic `_id`, so two concurrent
 * enrollment attempts cannot both read "under the limit" and both proceed: MongoDB serialises the
 * writes and exactly one of them sees the count that crosses the limit. The window is a fixed
 * bucket (not a sliding window) on purpose — a sliding window would need per-attempt rows, which is
 * more state for no security difference at these limits. `expiresAt` is a TTL index, so buckets
 * self-delete.
 */
export async function consumeEnrollmentQuota(input: {
  collections: Pick<Collections, "miningDeviceQuotas">;
  scope: EnrollmentScope;
  subject: string;
  windowMs: number;
  limit: number;
  nowMs: number;
}): Promise<CounterResult> {
  const bucketStart = Math.floor(input.nowMs / input.windowMs) * input.windowMs;
  const id = `${input.scope}:${input.windowMs}:${bucketStart}:${input.subject}`;
  const updated = await input.collections.miningDeviceQuotas.findOneAndUpdate(
    { _id: id },
    {
      $inc: { count: 1 },
      $setOnInsert: {
        scope: input.scope,
        windowMs: input.windowMs,
        bucketStart: new Date(bucketStart),
        // Two windows of life past its own start: long enough that the bucket is always readable
        // while it is the current one, short enough that stale counters cannot accumulate.
        expiresAt: new Date(bucketStart + input.windowMs * 2),
      },
    },
    { upsert: true, returnDocument: "after" },
  );
  const count = typeof updated?.count === "number" ? updated.count : 1;
  return { allowed: count <= input.limit, count };
}

export interface EnrollmentBudgetInput {
  collections: Pick<Collections, "miningDeviceQuotas">;
  limits: {
    maxNewClustersPerAccountPerDay: number;
    maxNewClustersPerNetworkPerHour: number;
    maxNewClustersPerNetworkPerDay: number;
  };
  ownerUserId: string;
  /** Server-observed network identity (a keyed IP hash), never a client value. */
  ipHash: string | null;
  nowMs: number;
}

/**
 * Charges one new-cluster enrollment against every applicable budget.
 *
 * Order matters only for which limit is *reported*; all three are consumed so an attacker cannot
 * exhaust one dimension by staying under the others. A missing IP hash (privacy tooling, a socket
 * without a usable peer address) simply has no network budget to charge — it counts against the
 * account only, which is still a hard limit.
 */
export async function consumeEnrollmentBudget(input: EnrollmentBudgetInput): Promise<{ allowed: boolean; hit: EnrollmentLimitHit | null }> {
  const account = await consumeEnrollmentQuota({
    collections: input.collections,
    scope: "account",
    subject: input.ownerUserId,
    windowMs: ENROLLMENT_DAY_MS,
    limit: input.limits.maxNewClustersPerAccountPerDay,
    nowMs: input.nowMs,
  });
  if (!account.allowed) {
    return { allowed: false, hit: { scope: "account", limit: input.limits.maxNewClustersPerAccountPerDay, count: account.count, windowMs: ENROLLMENT_DAY_MS } };
  }
  if (!input.ipHash) return { allowed: true, hit: null };
  const hour = await consumeEnrollmentQuota({
    collections: input.collections,
    scope: "network",
    subject: input.ipHash,
    windowMs: ENROLLMENT_HOUR_MS,
    limit: input.limits.maxNewClustersPerNetworkPerHour,
    nowMs: input.nowMs,
  });
  if (!hour.allowed) {
    return { allowed: false, hit: { scope: "network", limit: input.limits.maxNewClustersPerNetworkPerHour, count: hour.count, windowMs: ENROLLMENT_HOUR_MS } };
  }
  const day = await consumeEnrollmentQuota({
    collections: input.collections,
    scope: "network",
    subject: input.ipHash,
    windowMs: ENROLLMENT_DAY_MS,
    limit: input.limits.maxNewClustersPerNetworkPerDay,
    nowMs: input.nowMs,
  });
  if (!day.allowed) {
    return { allowed: false, hit: { scope: "network", limit: input.limits.maxNewClustersPerNetworkPerDay, count: day.count, windowMs: ENROLLMENT_DAY_MS } };
  }
  return { allowed: true, hit: null };
}

/** How many new clusters this network has enrolled in the last day (risk evidence, not a gate). */
export async function recentClusterChurn(input: {
  collections: Pick<Collections, "miningDeviceQuotas">;
  ipHash: string;
  nowMs: number;
}): Promise<number> {
  // The day bucket is the counter the budget already maintains; reading it is one indexed `_id`
  // lookup rather than a scan of the device population.
  const bucketStart = Math.floor(input.nowMs / ENROLLMENT_DAY_MS) * ENROLLMENT_DAY_MS;
  const row = await input.collections.miningDeviceQuotas.findOne({ _id: `network:${ENROLLMENT_DAY_MS}:${bucketStart}:${input.ipHash}` });
  return typeof row?.count === "number" ? row.count : 0;
}

/**
 * The trust state a record is treated as having.
 *
 * A missing value is `provisional`, never `established`: records written before the enrollment model
 * existed have not earned anything, and the conservative default is the whole point.
 */
export function trustStateOf(device: Pick<MiningDeviceRecord, "trustState" | "status">): MiningDeviceTrustState {
  if (device.status === "blocked") return "blocked";
  if (device.trustState === "established" || device.trustState === "suspicious" || device.trustState === "provisional") return device.trustState;
  if (device.status === "quarantined") return "suspicious";
  return "provisional";
}

export interface TrustTransition {
  state: MiningDeviceTrustState;
  becameEstablished: boolean;
}

/**
 * The explicit trust transition of a cluster after an allowed admission or a verified proof.
 *
 * A cluster becomes `established` after `minAdmissions` allowed admissions, or after two admissions
 * plus a verified proof of possession — independent evidence from more than one occasion, which one
 * fabricated request cannot supply. Findings (consistency contradictions, drift that was not
 * learned) push a cluster to `suspicious`; trust is never silently upgraded back, and nothing here
 * ever downgrades a cluster out of `established` for ordinary drift.
 */
export function nextTrustState(input: {
  device: Pick<MiningDeviceRecord, "trustState" | "status" | "establishedAt">;
  admissionCount: number;
  proofCount: number;
  findingCount: number;
  minAdmissions: number;
}): TrustTransition {
  if (input.device.status === "blocked") return { state: "blocked", becameEstablished: false };
  const current = trustStateOf(input.device as Pick<MiningDeviceRecord, "trustState" | "status">);
  if (current === "suspicious") return { state: "suspicious", becameEstablished: false };
  if (input.findingCount >= MAX_CONSISTENCY_FINDINGS && current !== "established") {
    return { state: "suspicious", becameEstablished: false };
  }
  if (current === "established" || input.device.establishedAt) {
    return { state: "established", becameEstablished: false };
  }
  const earned = input.admissionCount >= input.minAdmissions || (input.admissionCount >= 2 && input.proofCount >= 1);
  return earned ? { state: "established", becameEstablished: true } : { state: "provisional", becameEstablished: false };
}
