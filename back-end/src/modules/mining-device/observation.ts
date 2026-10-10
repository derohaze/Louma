import { ObjectId } from "mongodb";
import type { Collections } from "../../infrastructure/mongodb/collections.js";
import type { MiningDeviceRecord } from "../../shared/types.js";
import { recordSecurityEvent } from "../security/audit.js";
import {
  digestFeatureMap,
  ipHash,
  learnFeatureProfileChecked,
  machineKeyHash,
  type DeviceFeatureMap,
  type ObservedFeatures,
} from "./identity.js";
import {
  LMDG_EVENT_TYPES,
  MAX_CLUSTER_ALIASES,
  OBSERVATION_MIN_INTERVAL_MS,
} from "./policy.js";
import type { IpIntel } from "./ip-intel.js";
import { admissionEvidence } from "./candidate-evidence.js";

/**
 * Records that an account was seen on a device, sampled to at most one row per account per
 * `OBSERVATION_MIN_INTERVAL_MS`. Never throws: a sampling write is evidence, not the decision.
 *
 * Network fields carry the server-observed values for this request — a keyed IP hash (never the
 * address or a placeholder), plus the ASN/country the intelligence lookup reported — so later
 * starts can measure IP churn and geographic jumps instead of reading zeroes.
 */
export async function recordDeviceObservation(input: {
  collections: Pick<Collections, "miningDeviceObservations">;
  secret: Buffer;
  device: MiningDeviceRecord;
  ownerUserId: string;
  ip: string | null;
  intel: IpIntel;
  nowMs: number;
  riskScore: number;
  decision: string;
}): Promise<void> {
  const lastObs = await input.collections.miningDeviceObservations.findOne(
    { deviceId: input.device.publicId, ownerUserId: input.ownerUserId },
    { sort: { observedAt: -1 } },
  ).catch(() => null);
  if (lastObs && input.nowMs - lastObs.observedAt.getTime() <= OBSERVATION_MIN_INTERVAL_MS) return;
  await input.collections.miningDeviceObservations.insertOne({
    _id: new ObjectId(),
    deviceId: input.device.publicId,
    ownerUserId: input.ownerUserId,
    observedAt: new Date(input.nowMs),
    ipHash: input.ip ? ipHash(input.secret, input.ip) : null,
    asn: input.intel.asn,
    country: input.intel.country,
    riskScore: input.riskScore,
    decision: input.decision,
  } as never).catch(() => undefined);
}

/**
 * Refreshes liveness and folds the observation into the learned profile.
 *
 * Called only after mining admission allows the start (see `assessMiningStart`), never during
 * resolution: a rejected request must not rewrite the record's machine key, snapshot, or history,
 * or a failed attempt presenting a known browser key with different machine evidence would re-tag
 * the record and later matching would use that altered identity.
 *
 * The profile is what makes a device survive normal drift: a browser or driver update changes one
 * or two digests, and the ring keeps the previous values for `MAX_FEATURE_VALUES` observations
 * instead of forking the identity on the first difference. Contradictions of an established value
 * are recorded but not learned (see `learnFeatureProfileChecked`): one hostile observation cannot
 * walk a stored identity to a value of its choosing.
 */
export async function recordDeviceSeen(
  collections: Collections,
  secret: Buffer,
  device: MiningDeviceRecord,
  input: { intel: IpIntel; ip: string | null; correlationId: string; findings: string[] },
  observed: ObservedFeatures,
): Promise<void> {
  const now = new Date();
  // Recomputed from this observation rather than read from the record: the machine key is a function
  // of the machine traits, so a user-agent switch or a new browser profile reproduces the same key
  // and the record keeps pointing at the one machine identity its leases are taken on.
  const machineKey = machineKeyHash(secret, observed.raw);
  // Controlled learning: a contradictory value never silently becomes the new identity baseline. It
  // is kept in the profile's bounded drift log for the matcher, and — on this machine-anchored
  // record — every contradiction is also a security event, so poisoning attempts leave a trail the
  // risk engine sees while the stored value stays intact.
  const fold = learnFeatureProfileChecked(device.featureProfile, observed.digests);
  const machineFold = learnFeatureProfileChecked(
    device.machineFeatureProfile,
    digestFeatureMap(secret, observed.machine),
  );
  for (const driftedKey of [...fold.drift, ...machineFold.drift]) {
    await recordSecurityEvent({
      collections,
      ownerUserId: null,
      sessionId: null,
      eventType: LMDG_EVENT_TYPES.suspicious,
      outcome: "failure",
      correlationId: input.correlationId,
      metadata: { deviceId: device.publicId, feature: driftedKey.slice(0, 32), reason: "identity_drift_not_learned" },
    }).catch(() => undefined);
  }
  // The snapshot is the matcher's fallback when a feature has no learned ring, and the matcher
  // accepts a snapshot match independently of the profile — so a contradicted (drifted) value must
  // not replace the snapshot either. Contradicted keys keep their previous snapshot value (or stay
  // absent when there is none); everything else advances to this observation.
  // The trust counters are deliberately NOT touched here. An allowed start is only an intent to mine
  // until the mining session and its lease commit, so the admission is credited by
  // `creditGrantedStart` *after* that transaction lands: a request that lost the unique-lease race
  // can never age a cluster toward `established`. The findings are one input to that decision, so
  // they are incremented (never read-modify-written) here — a stale in-memory copy cannot overwrite
  // a concurrent update.
  // Append-only alias: the machine key this observation produced, when the server has decided this
  // cluster is the same machine (here: the admission was allowed and resolution matched the
  // cluster). The anchor is never rewritten, aliases are bounded, and a rejected request adds none.
  const aliasHashes = [...(device.aliasHashes ?? [])];
  if (machineKey && machineKey !== device.anchorHash && !aliasHashes.includes(machineKey)) {
    aliasHashes.push(machineKey);
    while (aliasHashes.length > MAX_CLUSTER_ALIASES) aliasHashes.shift();
    await recordSecurityEvent({
      collections,
      ownerUserId: null,
      sessionId: null,
      eventType: LMDG_EVENT_TYPES.aliasAccepted,
      outcome: "success",
      correlationId: input.correlationId,
      metadata: { deviceId: device.publicId, reason: "machine_key_alias_accepted" },
    }).catch(() => undefined);
  }
  const previousSnapshot = (device.featureSnapshot ?? {}) as DeviceFeatureMap;
  const nextSnapshot: DeviceFeatureMap = { ...previousSnapshot, ...observed.digests };
  for (const driftedKey of new Set([...fold.drift, ...machineFold.drift])) {
    if (previousSnapshot[driftedKey] !== undefined) nextSnapshot[driftedKey] = previousSnapshot[driftedKey];
    else delete nextSnapshot[driftedKey];
  }
  await collections.miningDevices.updateOne(
    // A stale observation must not overwrite newer history or derive tokens from a machine
    // value that a concurrent observation changed. Dropping this sampled observation is safe.
    { _id: device._id, featureProfile: device.featureProfile ?? null,
      featureSnapshot: device.featureSnapshot ?? null, machineKeyHash: device.machineKeyHash ?? null,
      browserKeyPublicKey: device.browserKeyPublicKey ?? null },
    {
      $set: {
        lastSeenAt: now,
        updatedAt: now,
        // Digests only — see `createDevice`.
        featureSnapshot: nextSnapshot,
        featureProfile: fold.profile,
        ...admissionEvidence({ ...device, featureSnapshot: nextSnapshot, featureProfile: fold.profile,
          machineKeyHash: machineKey ?? device.machineKeyHash }, secret),
        machineFeatureProfile: machineFold.profile,
        // The record's platform drives the candidate pre-filter above; a client that changes its
        // user agent must not also hide the record it belongs to from that filter. Never downgraded
        // to null: a client that stops reporting the trait keeps the last value it did report.
        ...(machineKey ? { machineKeyHash: machineKey } : {}),
        aliasHashes,
        // The last network this cluster was observed on, for the record's own history. The network
        // *lock* does not read it: it asks the leases, which carry the network their cycle was
        // actually taken from, so a stale device field can never decide an admission.
        ...(input.ip ? { lastIpHash: ipHash(secret, input.ip) } : {}),
        ...(observed.raw["platform"] ? { platform: observed.raw["platform"] } : {}),
        ...(input.intel.asn ? { lastAsn: input.intel.asn } : {}),
        ...(input.intel.country ? { lastCountry: input.intel.country } : {}),
      },
      $inc: { findingCount: input.findings.length },
    },
  ).catch(() => undefined);
}
