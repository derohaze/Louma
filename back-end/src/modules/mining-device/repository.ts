import type { ClientSession } from "mongodb";
import type { Collections } from "../../infrastructure/mongodb/collections.js";
import type { MiningDeviceLeaseRecord, MiningDeviceRecord } from "../../shared/types.js";
import { CLUSTER_CANDIDATE_LIMIT, NETWORK_LOCK_KEY_PATTERN } from "./policy.js";

/**
 * LMDG persistence helpers. Thin wrappers over the typed collections so query shapes live in one
 * place and can be reviewed against the indexes in infrastructure/mongodb/indexes.ts.
 */

/**
 * All single-device lookups order by `firstSeenAt` then `_id`.
 *
 * `deviceKeyHash` is not (yet) a unique index, so a race between two first-time starts can leave two
 * records for one device. Ordering makes every read converge on the oldest record instead of
 * letting the natural order decide, which is what keeps one physical device on one lease.
 */
const OLDEST_FIRST = { sort: { firstSeenAt: 1, _id: 1 } } as const;

export async function findDeviceByKeyHash(
  collections: Pick<Collections, "miningDevices">,
  deviceKeyHash: string,
): Promise<MiningDeviceRecord | null> {
  return collections.miningDevices.findOne({ deviceKeyHash }, OLDEST_FIRST);
}

export async function findDeviceBySignature(
  collections: Pick<Collections, "miningDevices">,
  normalizedSignalHash: string,
): Promise<MiningDeviceRecord | null> {
  return collections.miningDevices.findOne({ normalizedSignalHash }, OLDEST_FIRST);
}

export async function findDeviceByPublicKey(
  collections: Pick<Collections, "miningDevices">,
  browserKeyPublicKey: string,
): Promise<MiningDeviceRecord | null> {
  return collections.miningDevices.findOne({ browserKeyPublicKey }, OLDEST_FIRST);
}

/**
 * The server-owned enrollment anchor of one observation, plus every alias the server has since
 * accepted for that cluster.
 *
 * This is the identity lookup: an observation whose server-derived machine key equals a cluster's
 * immutable anchor, or one of the bounded aliases a trust transition appended to it, IS that
 * cluster. Both are indexed direct lookups — never a scan of the recent population — so an old or
 * idle cluster cannot fall out of enforcement.
 */
export async function findDeviceByAnchor(
  collections: Pick<Collections, "miningDevices">,
  anchorHash: string,
): Promise<MiningDeviceRecord | null> {
  return collections.miningDevices.findOne({ $or: [{ anchorHash }, { aliasHashes: anchorHash }] }, OLDEST_FIRST);
}

/**
 * Every live lease taken from one server-observed network identity (a keyed IP hash).
 *
 * The network lock asks this question — "is another account mining from this network?" — directly
 * against the leases, where the answer lives: a lease carries the network its cycle was actually
 * started from, so no device-record recency window and no device cap can hide a live lease. The
 * result is bounded by the number of cycles that are running, not by the size of the population.
 */
export async function findLiveLeasesOnNetwork(
  collections: Pick<Collections, "miningDeviceLeases" | "miningSessions">,
  ipHashValue: string,
  nowMs: number,
  mongoSession?: ClientSession,
): Promise<MiningDeviceLeaseRecord[]> {
  const leases = await collections.miningDeviceLeases
    .find({ ipHash: ipHashValue, status: "active", leaseEndsAt: { $gt: new Date(nowMs) } }, mongoSession ? { session: mongoSession } : {})
    .toArray();
  return leasesWithRunningSessions(collections, leases, nowMs, mongoSession);
}

/**
 * The machine identity of one observation, resolved directly.
 *
 * A record that already carries this observation's machine key IS the same machine — identity, not
 * similarity — so the lookup must not depend on the recent-activity ordering of the profile sweep
 * (`lastSeenAt` desc, limit 50): an idle machine behind a second browser, or busy fleet traffic,
 * could otherwise push the one record that matters out of the window and split the device. Served
 * by the dedicated machine-key index; falls back to the most recent match on the rare duplicate.
 */
export async function lookupMachineKey(
  collections: Pick<Collections, "miningDevices">,
  machineKeyHash: string,
): Promise<MiningDeviceRecord | null> {
  return collections.miningDevices.findOne({ machineKeyHash }, OLDEST_FIRST);
}

/**
 * The live leases one account holds, most recent first.
 *
 * The device-status view is a claim about a *running* binding, not about a row still marked active:
 * a cycle that expired or was settled by an older path leaves its lease rows behind until the next
 * start on the same identities releases them, and answering from those rows would claim a device
 * the account does not hold. Liveness is therefore the referenced session being active, owned by
 * the account, and not ended — the same rule admission and the network lock apply. The reserved
 * network token is excluded: it serializes the network rule, and it is not a lease on a device.
 */
export async function findLiveLeasesForOwner(
  collections: Pick<Collections, "miningDeviceLeases" | "miningSessions">,
  ownerUserId: string,
  nowMs: number,
): Promise<MiningDeviceLeaseRecord[]> {
  const leases = await collections.miningDeviceLeases
    .find({
      ownerUserId,
      status: "active",
      deviceClusterId: { $not: { $regex: NETWORK_LOCK_KEY_PATTERN } },
    })
    .sort({ leaseEndsAt: -1 })
    .toArray();
  return leasesWithRunningSessions(collections, leases, nowMs);
}

export async function listClusterCandidates(
  collections: Pick<Collections, "miningDevices">,
  filter: Record<string, unknown>,
): Promise<MiningDeviceRecord[]> {
  return collections.miningDevices
    .find({ status: { $ne: "blocked" }, ...filter })
    .sort({ lastSeenAt: -1 })
    .limit(CLUSTER_CANDIDATE_LIMIT)
    .toArray();
}

export function isLeaseLive(lease: MiningDeviceLeaseRecord, nowMs: number): boolean {
  return lease.status === "active" && lease.leaseEndsAt.getTime() > nowMs;
}

/**
 * Live leases held against device identities, not against device records.
 *
 * The key is the device's `deviceKeyHash`: a stable, secret-keyed identity that two records of the
 * same machine share (a racing first start can register two) and that survives a record being
 * replaced. Keying the lease by a record id would let each duplicate hold its own lease, which is
 * exactly how one machine could run two cycles.
 */
export async function findLiveLeases(
  collections: Pick<Collections, "miningDeviceLeases" | "miningSessions">,
  leaseKeys: string[],
  nowMs: number,
  mongoSession?: ClientSession,
): Promise<MiningDeviceLeaseRecord[]> {
  const unique = [...new Set(leaseKeys)].filter(Boolean);
  if (unique.length === 0) return [];
  const leases = await collections.miningDeviceLeases
    .find({ deviceClusterId: { $in: unique }, status: "active" }, ...(mongoSession ? [{ session: mongoSession } as const] : []))
    .toArray();
  return leasesWithRunningSessions(collections, leases.filter((lease) => isLeaseLive(lease, nowMs)), nowMs, mongoSession);
}

/** A leftover lease is not proof that mining is running. MongoDB sessions are authoritative. */
async function leasesWithRunningSessions(
  collections: Pick<Collections, "miningSessions">,
  leases: MiningDeviceLeaseRecord[],
  nowMs: number,
  mongoSession?: ClientSession,
): Promise<MiningDeviceLeaseRecord[]> {
  if (leases.length === 0) return [];
  const sessions = await collections.miningSessions.find(
    { publicId: { $in: [...new Set(leases.map((lease) => lease.miningSessionId))] }, status: "active", endsAt: { $gt: new Date(nowMs) } },
    { projection: { publicId: 1, ownerUserId: 1 }, ...(mongoSession ? { session: mongoSession } : {}) },
  ).toArray();
  const owners = new Map(sessions.map((session) => [session.publicId, session.ownerUserId]));
  return leases.filter((lease) => owners.get(lease.miningSessionId) === lease.ownerUserId);
}

/** Release only rows whose referenced cycle is not running, inside the start transaction. */
export async function releaseInactiveLeases(
  collections: Pick<Collections, "miningDeviceLeases" | "miningSessions">,
  leaseKeys: string[],
  nowMs: number,
  mongoSession: ClientSession,
): Promise<void> {
  const leases = await collections.miningDeviceLeases.find(
    { deviceClusterId: { $in: leaseKeys }, status: "active" },
    { session: mongoSession },
  ).toArray();
  const live = new Set((await leasesWithRunningSessions(collections, leases.filter((lease) => isLeaseLive(lease, nowMs)), nowMs, mongoSession)).map((lease) => lease.publicId));
  const inactiveIds = leases.filter((lease) => !live.has(lease.publicId)).map((lease) => lease._id);
  if (inactiveIds.length > 0) {
    await collections.miningDeviceLeases.updateMany(
      { _id: { $in: inactiveIds }, status: "active" },
      { $set: { status: "released", updatedAt: new Date(nowMs) } },
      { session: mongoSession },
    );
  }
}

export { isDuplicateKeyError } from "../../shared/mongo-retry.js";
