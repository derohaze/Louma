import { MongoServerError, type ClientSession, type Db } from "mongodb";
import type { Collections } from "./collections.js";
import { ADMISSION_SCAN_BUDGET_MS, ENROLLMENT_DAY_MS } from "../../modules/mining-device/policy.js";
import { isDuplicateKeyError } from "../../shared/mongo-retry.js";
import { serviceUnavailable } from "../../shared/errors.js";

export interface MiningAdmissionNetworkRecord { _id: string; fence: boolean; expiresAt: Date }

/** Register before assessment. No TTL: a stalled request must remain visible until it finishes. */
export async function beginMiningAdmission(collections: Collections, deviceId: string) {
  const result = await collections.miningDevices.updateOne({ publicId: deviceId },
    { $inc: { admissionPending: 1 } }, { writeConcern: { w: "majority" } });
  if (result.matchedCount !== 1) throw serviceUnavailable("mining_start_busy", "Device admission changed. Try again.");
}

/** Only release this request's reference, after its transaction has finished or aborted. */
export async function endMiningAdmission(collections: Collections, deviceId: string) {
  await collections.miningDevices.updateOne({ publicId: deviceId, admissionPending: { $gt: 0 } },
    { $inc: { admissionPending: -1 } }, { writeConcern: { w: "majority" } });
}

/** Monitor-only starts publish before insertion; enforced starts publish with their write fence. */
export async function retainMiningAdmission(collections: Collections, deviceId: string, endsAt: Date) {
  const result = await collections.miningDevices.updateOne({ publicId: deviceId, admissionPending: { $gt: 0 } },
    { $max: { admissionLeaseEndsAt: endsAt } }, { writeConcern: { w: "majority" } });
  if (result.matchedCount !== 1) throw serviceUnavailable("mining_start_busy", "Device admission changed. Try again.");
}

export function miningAdmissionCandidateFilter(nowMs: number) {
  return { $or: [
    { admissionPending: { $gt: 0 } },
    { admissionLeaseEndsAt: { $gt: new Date(nowMs) } },
    // Uninitialized/legacy rows stay visible; absence is never evidence that a device is idle.
    { admissionLeaseEndsAt: { $exists: false } },
  ] };
}

/**
 * Initialize legacy rows conservatively through the latest existing cycle/lease end. New starts
 * mark pending before assessment and publish their own end atomically, so this never lowers them.
 * Old binaries must be drained before enabling this candidate query (see ADR-016).
 */
export async function backfillMiningAdmissionWindows(db: Db): Promise<number> {
  const devices = db.collection("mining_devices");
  if (!(await devices.findOne({ admissionLeaseEndsAt: { $exists: false } }, { projection: { _id: 1 } }))) return 0;
  const maxima = await Promise.all([
    db.collection("mining_sessions").aggregate<{ end: Date }>([{ $match: { status: "active" } }, { $group: { _id: null, end: { $max: "$endsAt" } } }]).toArray(),
    db.collection("mining_device_leases").aggregate<{ end: Date }>([{ $match: { status: "active" } }, { $group: { _id: null, end: { $max: "$leaseEndsAt" } } }]).toArray(),
  ]);
  const until = new Date(Math.max(0, ...maxima.flat().map(row => row.end.getTime())));
  let changed = 0;
  for (;;) {
    const batch = await devices.find({ admissionLeaseEndsAt: { $exists: false } }, { projection: { _id: 1 } }).limit(200).toArray();
    if (batch.length === 0) return changed;
    const result = await devices.updateMany({ _id: { $in: batch.map(row => row._id) }, admissionLeaseEndsAt: { $exists: false } },
      { $max: { admissionLeaseEndsAt: until } }, { writeConcern: { w: "majority" } });
    changed += result.modifiedCount;
  }
}

/** Creation is outside the session transaction; this row never grants a mining lease. */
export async function prepareMiningNetworkFence(collections: Collections, networkHash: string) {
  try {
    await collections.miningAdmissionNetworks.updateOne({ _id: networkHash }, {
      $setOnInsert: { fence: false }, $max: { expiresAt: new Date(Date.now() + ENROLLMENT_DAY_MS) },
    }, { upsert: true });
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error;
  }
}

export async function fenceMiningNetwork(collections: Collections, networkHash: string, session: ClientSession) {
  const result = await collections.miningAdmissionNetworks.updateOne({ _id: networkHash }, [
    { $set: { fence: { $not: ["$fence"] }, expiresAt: new Date(Date.now() + ENROLLMENT_DAY_MS) } },
  ], { session });
  return result.matchedCount === 1;
}

/**
 * Assessment preserves full historical matching, including asymmetric learned profiles.
 * Transaction revalidation scans current work and retains the assessment's compared IDs/keys.
 * Idle contenders register before assessment, so discovery never depends on device recency.
 */
export async function* iterateMiningAdmissionCandidates(collections: Collections, session?: ClientSession) {
  const deadline = performance.now() + ADMISSION_SCAN_BUDGET_MS;
  const cursor = collections.miningDevices.find(session ? miningAdmissionCandidateFilter(Date.now()) : {}, {
    ...(session ? { session } : {}), maxTimeMS: ADMISSION_SCAN_BUDGET_MS,
    projection: {
      publicId: 1, deviceKeyHash: 1, machineKeyHash: 1, anchorHash: 1, quotaAnchorHash: 1,
      aliasHashes: 1, featureProfile: 1, featureSnapshot: 1, browserKeyPublicKey: 1, fingerprintVisitorIdHash: 1,
    },
  }).batchSize(64);
  try {
    for await (const candidate of cursor) {
      if (performance.now() > deadline) throw serviceUnavailable("mining_start_busy", "Mining admission is busy. Try again.");
      yield candidate;
    }
    if (performance.now() > deadline) throw serviceUnavailable("mining_start_busy", "Mining admission is busy. Try again.");
  } catch (error) {
    if (error instanceof MongoServerError && error.code === 50) {
      throw serviceUnavailable("mining_start_busy", "Mining admission is busy. Try again.");
    }
    throw error;
  } finally {
    await cursor.close();
  }
}

export function loadMiningAdmissionDevice(collections: Collections, publicId: string, session: ClientSession) {
  return collections.miningDevices.findOne({ publicId }, { session });
}

export function findRunningMiningAccount(collections: Collections, ownerUserId: string, session: ClientSession) {
  return collections.miningSessions.findOne(
    { ownerUserId, status: "active", endsAt: { $gt: new Date() } }, { session, projection: { _id: 1 } },
  );
}

/**
 * A real write, including when two starts share a millisecond. Snapshot isolation alone permits
 * write skew. Each start writes its own record and the records it compared as correlated; a
 * one-sided comparison therefore also conflicts, and the loser must compare a new snapshot.
 * This is transaction coordination, never a persistent lease or a similarity-based refusal.
 */
export async function fenceMiningAdmissions(collections: Collections, deviceIds: string[], session: ClientSession, endsAt: Date) {
  const ids = [...new Set(deviceIds)];
  const result = await collections.miningDevices.updateMany(
    { publicId: { $in: ids } },
    [{ $set: {
      admissionFence: { $not: [{ $ifNull: ["$admissionFence", false] }] },
      // A cycle can lease a peer's identities too. Keep every compared peer visible even if
      // its own request finishes, or its earlier cycle ends before this one does.
      admissionLeaseEndsAt: { $max: [{ $ifNull: ["$admissionLeaseEndsAt", new Date(0)] }, endsAt] },
    } }],
    { session },
  );
  return result.matchedCount === ids.length;
}
