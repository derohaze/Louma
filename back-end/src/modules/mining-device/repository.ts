import type { ClientSession } from "mongodb";
import type { Collections } from "../../infrastructure/mongodb/collections.js";
import type { MiningDeviceLeaseRecord, MiningDeviceRecord } from "../../shared/types.js";
import { CLUSTER_CANDIDATE_LIMIT } from "./policy.js";

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
 * Device clusters last observed on one server-observed network identity (a keyed IP hash).
 * Bounded and served by `mining_devices_network_seen`; used for the network-scoped admission checks,
 * not for identity.
 */
export async function findDevicesOnNetwork(
  collections: Pick<Collections, "miningDevices">,
  ipHashValue: string,
  limit: number,
): Promise<MiningDeviceRecord[]> {
  return collections.miningDevices
    .find({ lastIpHash: ipHashValue, status: { $ne: "blocked" } })
    .sort({ lastSeenAt: -1 })
    .limit(limit)
    .toArray();
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
  collections: Pick<Collections, "miningDeviceLeases">,
  leaseKeys: string[],
  nowMs: number,
  mongoSession?: ClientSession,
): Promise<MiningDeviceLeaseRecord[]> {
  const unique = [...new Set(leaseKeys)].filter(Boolean);
  if (unique.length === 0) return [];
  const leases = await collections.miningDeviceLeases
    .find({ deviceClusterId: { $in: unique }, status: "active" }, ...(mongoSession ? [{ session: mongoSession } as const] : []))
    .toArray();
  return leases.filter((lease) => lease.leaseEndsAt.getTime() > nowMs);
}

export function isDuplicateKeyError(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === 11000;
}
