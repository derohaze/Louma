import type { Collections } from "../../infrastructure/mongodb/collections.js";
import type { MiningDeviceNetworkTrust, MiningDeviceRecord, MiningDeviceTrustState } from "../../shared/types.js";
import { isDuplicateKeyError } from "./repository.js";
import {
  ENROLLMENT_DAY_MS,
  ENROLLMENT_HOUR_MS,
  MAX_CONSISTENCY_FINDINGS,
  MAX_NETWORK_TRUSTS,
} from "./policy.js";

/**
 * LMDG device enrollment: identity creation is a budgeted, server-owned transition.
 *
 * The trust boundary this module implements: a client's evidence may *propose* a machine identity,
 * but it can never name one. A new machine identity is not a consequence of a syntactically valid
 * payload — it is a server-side enrollment that (a) is rate-limited per account and per network, and
 * (b) starts `provisional`, earning `established` only through repeated committed mining activity
 * (or a verified proof of possession), and only for the networks it actually mined on. Everything
 * here is deterministic and database-backed; no clock is read implicitly.
 */

export type EnrollmentScope = "account" | "network";

export interface EnrollmentLimitHit {
  scope: EnrollmentScope;
  limit: number;
  count: number;
  windowMs: number;
}

/**
 * Consumes one slot in a true sliding window.
 *
 * The slot is a row recording *when* it was spent, and the limit is the count of rows inside the
 * last `windowMs` — so a burst on either side of an hour or day boundary is one window, not two, and
 * the limits mean what their names say. Counting is not read-then-write: the row is inserted first,
 * the window is then counted including it, and a count over the limit is rolled back by the caller
 * (the row is deleted again) — the direction a rate limiter must fail in.
 *
 * The row `_id` includes the machine identity and the window it falls in, so a retry or a concurrent
 * duplicate enrollment of the *same* machine is one consumed slot rather than two. `expiresAt` is a
 * TTL index: a slot's row is deleted once it can no longer affect any window.
 */
async function consumeEnrollmentQuota(input: {
  collections: Pick<Collections, "miningDeviceQuotas">;
  scope: EnrollmentScope;
  subject: string;
  windowMs: number;
  limit: number;
  identityKey: string;
  nowMs: number;
}): Promise<{ allowed: boolean; count: number; insertedId: string | null }> {
  const id = `${input.scope}:${input.windowMs}:${Math.floor(input.nowMs / input.windowMs)}:${input.subject}:${input.identityKey}`;
  let inserted = false;
  try {
    await input.collections.miningDeviceQuotas.insertOne({
      _id: id,
      scope: input.scope,
      subject: input.subject,
      windowMs: input.windowMs,
      at: new Date(input.nowMs),
      identityKey: input.identityKey,
      expiresAt: new Date(input.nowMs + input.windowMs),
    });
    inserted = true;
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error;
  }
  const count = await input.collections.miningDeviceQuotas.countDocuments({
    scope: input.scope,
    subject: input.subject,
    windowMs: input.windowMs,
    at: { $gt: new Date(input.nowMs - input.windowMs) },
  });
  return { allowed: count <= input.limit, count, insertedId: inserted ? id : null };
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
  /**
   * The machine identity the slot is being spent on (its machine key, else its browser key hash).
   * Two requests for one machine consume one slot: the racing duplicate that loses the unique anchor
   * index must not also cost the account a second one of its few enrollments.
   */
  identityKey: string;
  nowMs: number;
}

/**
 * Charges one new-cluster enrollment against every applicable budget.
 *
 * Order matters only for which limit is *reported*; all three are consumed so an attacker cannot
 * exhaust one dimension by staying under the others. A request that is over budget on a later scope
 * rolls back the slots it inserted on earlier scopes, so a refusal never spends the account's budget
 * for an enrollment that did not happen. A missing IP hash (privacy tooling, a socket without a
 * usable peer address) simply has no network budget to charge — it counts against the account only,
 * which is still a hard limit.
 */
export async function consumeEnrollmentBudget(input: EnrollmentBudgetInput): Promise<{ allowed: boolean; hit: EnrollmentLimitHit | null }> {
  const charges: { scope: EnrollmentScope; subject: string; windowMs: number; limit: number }[] = [
    { scope: "account", subject: input.ownerUserId, windowMs: ENROLLMENT_DAY_MS, limit: input.limits.maxNewClustersPerAccountPerDay },
    ...(input.ipHash
      ? [
          { scope: "network" as const, subject: input.ipHash, windowMs: ENROLLMENT_HOUR_MS, limit: input.limits.maxNewClustersPerNetworkPerHour },
          { scope: "network" as const, subject: input.ipHash, windowMs: ENROLLMENT_DAY_MS, limit: input.limits.maxNewClustersPerNetworkPerDay },
        ]
      : []),
  ];
  const inserted: string[] = [];
  for (const charge of charges) {
    const result = await consumeEnrollmentQuota({
      collections: input.collections,
      scope: charge.scope,
      subject: charge.subject,
      windowMs: charge.windowMs,
      limit: charge.limit,
      identityKey: input.identityKey,
      nowMs: input.nowMs,
    });
    if (result.insertedId) inserted.push(result.insertedId);
    if (!result.allowed) {
      if (inserted.length > 0) {
        await input.collections.miningDeviceQuotas.deleteMany({ _id: { $in: inserted } }).catch(() => undefined);
      }
      return { allowed: false, hit: { scope: charge.scope, limit: charge.limit, count: result.count, windowMs: charge.windowMs } };
    }
  }
  return { allowed: true, hit: null };
}

/** How many new clusters this network has enrolled in the last day (risk evidence, not a gate). */
export async function recentClusterChurn(input: {
  collections: Pick<Collections, "miningDeviceQuotas">;
  ipHash: string;
  nowMs: number;
}): Promise<number> {
  // The budget rows are the record the gate already keeps; counting the day window is one indexed
  // count rather than a scan of the device population.
  return input.collections.miningDeviceQuotas.countDocuments({
    scope: "network",
    subject: input.ipHash,
    windowMs: ENROLLMENT_DAY_MS,
    at: { $gt: new Date(input.nowMs - ENROLLMENT_DAY_MS) },
  }).catch(() => 0);
}

/**
 * The credited mining activity (and its freshness) of one cluster on one network context.
 *
 * This is the identity/network binding: `established` is a statement about the machine, while the
 * network lock needs a statement about *this machine on this network, recently* — otherwise a
 * cluster could earn trust anywhere, at any time, and then appear next to another account's live
 * cycle. Only committed events are ever credited here (see `creditGrantedStart` and `verifyProof`).
 */
export function networkTrustOf(
  device: Pick<MiningDeviceRecord, "networkTrusts">,
  ipHashValue: string,
): MiningDeviceNetworkTrust | null {
  return (device.networkTrusts ?? []).find((entry) => entry.ipHash === ipHashValue) ?? null;
}

/** Whether one network's credited activity reaches the establishment threshold for that network. */
export function networkTrustEstablished(
  entry: Pick<MiningDeviceNetworkTrust, "admissions" | "proofs">,
  minAdmissions: number,
): boolean {
  return entry.admissions >= minAdmissions || (entry.admissions >= 2 && entry.proofs >= 1);
}

/** Whether the network's credited activity is recent enough to still describe a resident device. */
export function networkTrustFresh(entry: Pick<MiningDeviceNetworkTrust, "lastAt">, nowMs: number, freshnessMs: number): boolean {
  return nowMs - entry.lastAt.getTime() <= freshnessMs;
}

/**
 * Records one committed credit against the network it actually happened on.
 *
 * Most recent first and bounded to `MAX_NETWORK_TRUSTS`: the entry for the current network is the
 * only one the lock reads, and the oldest networks fall away rather than accumulating.
 */
export function bumpNetworkTrust(
  entries: MiningDeviceNetworkTrust[] | undefined,
  ipHashValue: string,
  credit: "admission" | "proof",
  nowMs: number,
): MiningDeviceNetworkTrust[] {
  const at = new Date(nowMs);
  const existing = (entries ?? []).find((entry) => entry.ipHash === ipHashValue) ?? null;
  const updated: MiningDeviceNetworkTrust = existing
    ? {
        ...existing,
        admissions: existing.admissions + (credit === "admission" ? 1 : 0),
        proofs: existing.proofs + (credit === "proof" ? 1 : 0),
        lastAt: at,
      }
    : { ipHash: ipHashValue, admissions: credit === "admission" ? 1 : 0, proofs: credit === "proof" ? 1 : 0, firstAt: at, lastAt: at };
  return [updated, ...(entries ?? []).filter((entry) => entry.ipHash !== ipHashValue)].slice(0, MAX_NETWORK_TRUSTS);
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
 * The explicit trust transition of a cluster after a committed admission or a verified proof.
 *
 * A cluster becomes `established` after `minAdmissions` committed admissions (each one a mining
 * cycle that actually started and took its lease), or after two admissions plus a verified proof of
 * possession — independent evidence from more than one occasion, which a burst of fabricated,
 * never-committed requests cannot supply. Findings (consistency contradictions, drift that was not
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
