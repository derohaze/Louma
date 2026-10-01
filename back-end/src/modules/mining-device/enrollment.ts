import type { Collections } from "../../infrastructure/mongodb/collections.js";
import type { MiningDeviceNetworkTrust, MiningDeviceRecord, MiningDeviceTrustState } from "../../shared/types.js";
import { isDuplicateKeyError } from "./repository.js";
import { ENROLLMENT_DAY_MS, ENROLLMENT_HOUR_MS, MAX_CONSISTENCY_FINDINGS } from "./policy.js";

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
 * The slot is a row recording *when* it was spent, and the limit is the number of rows inside the
 * last `windowMs` that a request still relies on — so a burst on either side of an hour or day
 * boundary is one window, not two, and the limits mean what their names say. Counting is not
 * read-then-write: the row is inserted first, the window is then counted including it, and a refusal
 * releases the references this request took — the direction a rate limiter must fail in.
 *
 * The row `_id` includes the machine identity and the window it falls in, so a retry or a concurrent
 * duplicate enrollment of the *same* machine joins one slot rather than spending two. `refs` counts
 * the requests currently relying on that slot, and a refusal releases only its own reference: a
 * plain delete would have taken the slot away from a concurrent request that had already enrolled
 * the same machine (its enrollment then stopped counting against the account's day), and leaving the
 * row in place would have charged a request that never enrolled anything. `expiresAt` is a TTL
 * index: a slot's row is deleted once it can no longer affect any window.
 */
async function consumeEnrollmentQuota(input: {
  collections: Pick<Collections, "miningDeviceQuotas">;
  scope: EnrollmentScope;
  subject: string;
  windowMs: number;
  limit: number;
  identityKey: string;
  nowMs: number;
}): Promise<{ allowed: boolean; count: number; slotId: string | null }> {
  const id = `${input.scope}:${input.windowMs}:${Math.floor(input.nowMs / input.windowMs)}:${input.subject}:${input.identityKey}`;
  let slotId: string | null = null;
  try {
    await input.collections.miningDeviceQuotas.insertOne({
      _id: id,
      scope: input.scope,
      subject: input.subject,
      windowMs: input.windowMs,
      at: new Date(input.nowMs),
      identityKey: input.identityKey,
      refs: 1,
      expiresAt: new Date(input.nowMs + input.windowMs),
    });
    slotId = id;
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error;
    // Another request already spent this slot — a retry, or a concurrent attempt for the same
    // machine. Join it and add a reference, so a later release by either request still leaves the
    // slot counted for the enrollment the other one performed. When the slot is idle (`refs: 0`,
    // left behind by a refused attempt) the enrollment that counts is this one, so its timestamp
    // and expiry move to now rather than staying anchored to the refused attempt.
    const at = new Date(input.nowMs);
    const expiresAt = new Date(input.nowMs + input.windowMs);
    const refreshed = await input.collections.miningDeviceQuotas.updateOne(
      { _id: id, refs: 0 } as never,
      { $inc: { refs: 1 }, $set: { at, expiresAt } } as never,
    );
    if ((refreshed.matchedCount ?? 0) > 0) {
      slotId = id;
    } else {
      const joined = await input.collections.miningDeviceQuotas.updateOne({ _id: id } as never, { $inc: { refs: 1 } } as never);
      slotId = (joined.matchedCount ?? 0) > 0 ? id : null;
    }
  }
  const count = await input.collections.miningDeviceQuotas.countDocuments({
    scope: input.scope,
    subject: input.subject,
    windowMs: input.windowMs,
    // Rows written before reference tracking carry `at` but no `refs`; they still spent the
    // budget until they age out, so a missing `refs` counts like a live reference.
    $or: [{ refs: { $gt: 0 } }, { refs: { $exists: false } }],
    at: { $gt: new Date(input.nowMs - input.windowMs) },
  } as never);
  return { allowed: count <= input.limit, count, slotId };
}

/** Releases the references one refused request holds; other requests' references stay counted. */
async function releaseEnrollmentSlots(
  collections: Pick<Collections, "miningDeviceQuotas">,
  slotIds: string[],
): Promise<void> {
  await collections.miningDeviceQuotas
    .updateMany({ _id: { $in: slotIds } }, { $inc: { refs: -1 } })
    .catch(() => undefined);
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
 * releases the references it took on earlier scopes, so a refusal never spends the account's budget
 * for an enrollment that did not happen, and never takes a slot away from a concurrent request that
 * did enroll the same machine. A missing IP hash (privacy tooling, a socket without a usable peer
 * address) simply has no network budget to charge — it counts against the account only, which is
 * still a hard limit.
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
  const slots: string[] = [];
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
    if (result.slotId) slots.push(result.slotId);
    if (!result.allowed) {
      if (slots.length > 0) await releaseEnrollmentSlots(input.collections, slots);
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
  // count rather than a scan of the device population. A row whose references all released (a
  // refused attempt) is not churn: nothing was enrolled on it. Rows written before reference
  // tracking carry `at` but no `refs`; they still spent the budget until they age out.
  return input.collections.miningDeviceQuotas.countDocuments({
    scope: "network",
    subject: input.ipHash,
    windowMs: ENROLLMENT_DAY_MS,
    $or: [{ refs: { $gt: 0 } }, { refs: { $exists: false } }],
    at: { $gt: new Date(input.nowMs - ENROLLMENT_DAY_MS) },
  } as never).catch(() => 0);
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
 * The entry written when a network first appears on a device's credited activity.
 *
 * Credits are not merged in application memory: `applyCommittedCredit` increments the matching entry
 * in place (or prepends this entry when the network is new) inside one atomic update, so two credits
 * landing together cannot overwrite each other. Most recent first and bounded to
 * `MAX_NETWORK_TRUSTS` — the entry for the current network is the only one the lock reads, and the
 * oldest networks fall away rather than accumulating.
 */
export function networkTrustEntry(
  ipHashValue: string,
  credit: "admission" | "proof",
  nowMs: number,
): MiningDeviceNetworkTrust {
  const at = new Date(nowMs);
  return {
    ipHash: ipHashValue,
    admissions: credit === "admission" ? 1 : 0,
    proofs: credit === "proof" ? 1 : 0,
    firstAt: at,
    lastAt: at,
  };
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
