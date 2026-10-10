import { MongoServerError, type Db, type Filter } from "mongodb";
import { createHash } from "node:crypto";
import type { Collections } from "./collections.js";
import type { MiningDeviceRecord } from "../../shared/types.js";
import {
  absentToken, admissionEvidence, candidateEvidenceCover,
  evidenceToken, identityEvidence, observedEvidenceFeatures,
} from "../../modules/mining-device/candidate-evidence.js";
import type { ObservedFeatures } from "../../modules/mining-device/identity.js";
import { ADMISSION_CORRELATED_LIMIT, ADMISSION_SCAN_BUDGET_MS } from "../../modules/mining-device/policy.js";
import { serviceUnavailable } from "../../shared/errors.js";

export const EVIDENCE_INDEX = "mining_devices_evidence";

export function evidenceCandidateFilter(tokens: string[]): Filter<MiningDeviceRecord> {
  return { $or: [
    { admissionEvidenceTokens: { $in: tokens } },
    // Partial migration never means absence. The caller bounds the full union and refuses overflow.
    { admissionEvidenceVersion: { $exists: false } },
  ] };
}

export async function planAdmissionEvidence(input: {
  collections: Collections; observed: ObservedFeatures; secret: Buffer;
  machineKey: string | null; browserKey: string | null; ambiguousThreshold: number;
  deadline?: number;
}): Promise<string[]> {
  const agreementCost = new Map<string, number>();
  const absenceCost = new Map<string, number>();
  const deadline = input.deadline ?? performance.now() + ADMISSION_SCAN_BUDGET_MS;
  const signal = AbortSignal.timeout(Math.max(1, Math.ceil(deadline - performance.now())));
  // Covered reads: at most 201 index entries per token, no fingerprint documents fetched.
  const count = async (token: string) => {
    const remaining = Math.floor(deadline - performance.now());
    if (remaining <= 0) throw serviceUnavailable("mining_start_busy", "Mining admission is busy. Try again.");
    try {
      return (await input.collections.miningDevices.find(
        { admissionEvidenceTokens: token },
        { projection: { _id: 0, publicId: 1 }, hint: EVIDENCE_INDEX, maxTimeMS: remaining, signal },
      ).limit(ADMISSION_CORRELATED_LIMIT + 1).toArray()).length;
    } catch (error) {
      if (signal.aborted || (error instanceof MongoServerError && error.code === 50)) {
        throw serviceUnavailable("mining_start_busy", "Mining admission is busy. Try again.");
      }
      throw error;
    }
  };
  // Bound concurrent probes independently of feature population and request payload.
  const features = observedEvidenceFeatures(input.observed);
  for (let offset = 0; offset < features.length; offset += 4) {
    if (performance.now() >= deadline) throw serviceUnavailable("mining_start_busy", "Mining admission is busy. Try again.");
    await Promise.all(features.slice(offset, offset + 4).map(async feature => {
      agreementCost.set(feature.key, await count(evidenceToken(feature.key, input.observed.digests[feature.key]!)));
      absenceCost.set(feature.key, await count(absentToken(feature.key)));
    }));
  }
  if (performance.now() >= deadline) throw serviceUnavailable("mining_start_busy", "Mining admission is busy. Try again.");
  return candidateEvidenceCover({ observed: input.observed, ambiguousThreshold: input.ambiguousThreshold,
    agreementCost, absenceCost,
    identityTokens: identityEvidence({ machineKeyHash: input.machineKey, browserKeyPublicKey: input.browserKey }, input.secret),
  });
}

/** Drained-writer migration; compare source fields so overlapping new writes cannot be overwritten. */
export async function backfillMiningEvidence(db: Db, secret: Buffer): Promise<number> {
  const devices = db.collection<MiningDeviceRecord>("mining_devices");
  let changed = 0;
  for (;;) {
    const batch = await devices.find({ admissionEvidenceVersion: { $exists: false } }).limit(200).toArray();
    if (batch.length === 0) return changed;
    const result = await devices.bulkWrite(batch.map(device => ({ updateOne: {
      filter: { _id: device._id, admissionEvidenceVersion: { $exists: false },
        featureProfile: device.featureProfile ?? null, featureSnapshot: device.featureSnapshot ?? null,
        machineKeyHash: device.machineKeyHash ?? null, browserKeyPublicKey: device.browserKeyPublicKey ?? null },
      update: { $set: admissionEvidence(device, secret) },
    } })), { ordered: false, writeConcern: { w: "majority" } });
    changed += result.modifiedCount;
  }
}

export async function ensureMiningEvidenceIndexes(db: Db) {
  await db.collection("mining_devices").createIndex({ admissionEvidenceTokens: 1, publicId: 1 }, { name: EVIDENCE_INDEX });
  await db.collection("mining_devices").createIndex({ admissionEvidenceVersion: 1 }, { name: "mining_devices_evidence_version" });
}

/** Maintenance-only full verification/rebuild, also detects stale versioned rows after old writers. */
export async function verifyMiningEvidence(db: Db, secret: Buffer, repair = false) {
  const devices = db.collection<MiningDeviceRecord>("mining_devices");
  const ids = createHash("sha256");
  let scanned = 0, mismatched = 0, repaired = 0;
  const cursor = devices.find({}).sort({ _id: 1 }).batchSize(200);
  try {
    for await (const device of cursor) {
      scanned++;
      ids.update(JSON.stringify([device._id, device.publicId]));
      const expected = admissionEvidence(device, secret);
      if (device.admissionEvidenceVersion === expected.admissionEvidenceVersion &&
          JSON.stringify([...(device.admissionEvidenceTokens ?? [])].sort()) === JSON.stringify([...expected.admissionEvidenceTokens].sort())) continue;
      mismatched++;
      if (!repair) continue;
      const result = await devices.updateOne({ _id: device._id,
        featureProfile: device.featureProfile ?? null, featureSnapshot: device.featureSnapshot ?? null,
        machineKeyHash: device.machineKeyHash ?? null, browserKeyPublicKey: device.browserKeyPublicKey ?? null },
      { $set: expected }, { writeConcern: { w: "majority" } });
      repaired += result.matchedCount;
    }
  } finally { await cursor.close(); }
  return { scanned, mismatched, repaired, concurrentChanges: repair ? mismatched - repaired : 0, identityDigest: ids.digest("hex") };
}
