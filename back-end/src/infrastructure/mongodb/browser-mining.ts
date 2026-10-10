import { ObjectId, type ClientSession } from "mongodb";
import type { Collections } from "./collections.js";
import type { MiningDeviceRecord, MiningSessionRecord } from "../../shared/types.js";
import type { BrowserIdentity } from "../../modules/mining-device/browser-identity.js";
import { admissionEvidence, identityEvidence } from "../../modules/mining-device/candidate-evidence.js";
import { learnFeatureProfile } from "../../modules/mining-device/identity.js";
import { conflict, forbidden, serviceUnavailable } from "../../shared/errors.js";
import { findLiveLeases } from "../../modules/mining-device/repository.js";

export const BROWSER_RISK_FEATURES = ["canvas", "audio", "webgl", "fonts"] as const;
const MAX_PEERS = 200;

export async function readBrowserAdmissionEvidence(collections: Collections, identity: BrowserIdentity, secret: Buffer, ownerUserId: string) {
  const unindexed = await collections.miningDevices.findOne({ admissionEvidenceVersion: { $exists: false } },
    { hint: "mining_devices_evidence_version", projection: { _id: 1 }, maxTimeMS: 500 });
  if (unindexed) throw serviceUnavailable("mining_start_busy", "Identity history migration must finish before mining starts.");
  const device = await collections.miningDevices.findOne({ deviceKeyHash: identity.keyHash });
  const exactToken = identityEvidence({ machineKeyHash: null, browserKeyPublicKey: identity.evidence.browserKeyPublicKey }, secret)[0]!;
  const legacy = await collections.miningDevices.find({ admissionEvidenceTokens: exactToken, identityKind: { $ne: "browser" } })
    .hint("mining_devices_evidence").limit(MAX_PEERS + 1).maxTimeMS(500).toArray();
  if (legacy.length > MAX_PEERS) throw serviceUnavailable("mining_start_busy", "Identity history needs maintenance. Try again later.");
  const tokens = BROWSER_RISK_FEATURES.flatMap(key => identity.features[key] ? [`${key}:${identity.features[key]}`] : []);
  const peers = tokens.length ? await collections.miningDevices.find({ admissionEvidenceTokens: { $in: tokens }, deviceKeyHash: { $ne: identity.keyHash } })
    .hint("mining_devices_evidence").limit(MAX_PEERS + 1).maxTimeMS(500).toArray() : [];
  const previous = await collections.miningSessions.findOne({ ownerUserId }, { sort: { createdAt: -1, publicId: -1 } });
  return { device, legacy, peers: peers.slice(0, MAX_PEERS), overflow: peers.length > MAX_PEERS, previous };
}

export function browserProofFilter(identity: BrowserIdentity, ownerUserId: string, nonce: string, origin: string | null, now: Date) {
  return { nonce, ownerUserId, purpose: "browser-start-v1" as const, boundAnchorHash: identity.keyHash,
    boundBrowserKeyFingerprint: identity.canonicalKey, intentHash: identity.intentHash, origin,
    consumedAt: { $type: "date" as const }, startUsedAt: null, expiresAt: { $gt: now } };
}

/** Enrollment and proof consumption only become visible together with the session and lease. */
export async function commitBrowserAdmission(input: {
  collections: Collections; identity: BrowserIdentity; secret: Buffer; ownerUserId: string;
  nonce: string; origin: string | null; session: ClientSession; endsAt: Date;
  leaseKeys: string[]; previousId: string | null; deviceUpdatedAt: Date | null; accountVerified: boolean;
}) {
  const { collections, identity, session } = input;
  const now = new Date();
  // Serializes account history across keys, including a start+stop that fits between snapshots.
  // A unique active-session index alone cannot detect that completed intervening cycle.
  const fenced = await collections.users.updateOne({ publicId: input.ownerUserId },
    [{ $set: { miningAdmissionFence: { $not: [{ $ifNull: ["$miningAdmissionFence", false] }] } } }], { session });
  if (fenced.matchedCount !== 1) throw forbidden("mining_account_verification_required", "Account verification is required.");
  const proof = await collections.miningDeviceNonces.updateOne(
    browserProofFilter(identity, input.ownerUserId, input.nonce, input.origin, now),
    { $set: { startUsedAt: now } }, { session });
  if (proof.modifiedCount !== 1) throw forbidden("mining_device_challenge_required", "Confirm this browser before starting.");
  const existing = await collections.miningDevices.findOne({ deviceKeyHash: identity.keyHash }, { session });
  if ((await findLiveLeases(collections, input.leaseKeys, Date.now(), session)).some(lease => lease.ownerUserId !== input.ownerUserId)) {
    throw conflict("mining_device_already_in_use", "This browser identity is already mining on another account.");
  }
  const legacyBlock = await collections.miningDevices.findOne({ publicId: { $in: input.leaseKeys }, status: { $ne: "active" } }, { session });
  if (legacyBlock) throw forbidden("mining_device_unavailable", "This browser enrollment is unavailable.");
  const previous = await collections.miningSessions.findOne({ ownerUserId: input.ownerUserId }, { session, sort: { createdAt: -1, publicId: -1 }, projection: { publicId: 1 } });
  if (!input.accountVerified && ((previous?.publicId ?? null) !== input.previousId ||
      (existing?.updatedAt.getTime() ?? null) !== (input.deviceUpdatedAt?.getTime() ?? null))) {
    throw forbidden("mining_account_verification_required", "Browser or account history changed. Confirm your account before starting.");
  }
  if (existing && existing.status !== "active") throw forbidden("mining_device_unavailable", "This browser enrollment is unavailable.");
  const profile = learnFeatureProfile(existing?.featureProfile ?? null, identity.features);
  const fields = {
    featureSnapshot: identity.features, featureProfile: profile, lastSeenAt: now, updatedAt: now,
    admissionLeaseEndsAt: input.endsAt,
    ...admissionEvidence({ featureProfile: profile, featureSnapshot: identity.features, machineKeyHash: null, browserKeyPublicKey: identity.evidence.browserKeyPublicKey }, input.secret),
  };
  if (existing) {
    await collections.miningDevices.updateOne({ _id: existing._id }, { $set: fields, $inc: { admissionCount: 1 } }, { session });
  } else {
    await collections.miningDevices.insertOne({
      _id: new ObjectId(), publicId: identity.publicId, identityKind: "browser", deviceKeyHash: identity.keyHash,
      anchorHash: identity.keyHash, machineKeyHash: null, browserKeyPublicKey: identity.evidence.browserKeyPublicKey,
      fingerprintVisitorIdHash: null, fingerprintVersion: null, fingerprintConfidence: null, normalizedSignalHash: identity.intentHash,
      osFamily: null, browserFamily: null, platform: null, screenClass: null, timezone: null, languageClass: null,
      webglFingerprintHash: null, hardwareConcurrencyBucket: null, deviceMemoryBucket: null, machineFeatureProfile: null,
      lastIpHash: null, lastAsn: null, lastCountry: null, firstSeenAt: now, createdAt: now, status: "active",
      enrollmentUserId: input.ownerUserId, trustState: "provisional", admissionCount: 1, admissionPending: 0, ...fields,
    } satisfies MiningDeviceRecord, { session });
  }
}

export class BrowserRewardSnapshotChanged extends Error {}

/** Read inside the reward transaction. Nonce TTL and Redis cannot remove entitlement. */
export async function assertBrowserRewardEntitlement(collections: Collections, candidate: MiningSessionRecord, session?: ClientSession) {
  const options = session ? { session } : {};
  const stored = await collections.miningSessions.findOne({ _id: candidate._id }, options);
  if (!stored) throw forbidden("mining_reward_ineligible", "Mining reward eligibility could not be verified.");
  if (stored.admissionPolicy !== "browser-v1" && !stored.deviceId?.startsWith("browser:") && !candidate.browserAdmission) return;
  const receipt = stored.browserAdmission;
  if (!receipt || stored.admissionPolicy !== "browser-v1" || stored.deviceId !== `browser:${receipt.keyHash}` ||
      stored.deviceQuotaKey !== receipt.keyHash || receipt.rateUnits !== stored.rateUnits || receipt.rateScale !== stored.rateScale ||
      stored.endsAt > receipt.endsAt || receipt.verifiedAt > stored.startedAt ||
      (receipt.riskReasons.length > 0 && !receipt.accountVerified) ||
      candidate.ownerUserId !== stored.ownerUserId || candidate.walletId !== stored.walletId || candidate.ledgerAccountId !== stored.ledgerAccountId ||
      candidate.rateUnits !== stored.rateUnits || candidate.rateScale !== stored.rateScale ||
      candidate.startedAt.getTime() !== stored.startedAt.getTime()) {
    throw forbidden("mining_reward_ineligible", "Mining reward eligibility could not be verified.");
  }
  const lease = await collections.miningDeviceLeases.findOne({ miningSessionId: stored.publicId, ownerUserId: stored.ownerUserId,
    deviceId: stored.deviceId, deviceClusterId: receipt.keyHash, leaseEndsAt: { $gte: stored.endsAt } }, options);
  if (!lease) throw forbidden("mining_reward_ineligible", "Mining reward eligibility could not be verified.");
  const enrollment = await collections.miningDevices.findOne({ publicId: stored.deviceId!, deviceKeyHash: receipt.keyHash,
    identityKind: "browser", status: "active" }, options);
  const owner = await collections.users.findOne({ publicId: stored.ownerUserId, status: "active" }, { ...options, projection: { _id: 1 } });
  if (!enrollment || !owner) throw forbidden("mining_reward_ineligible", "Mining reward eligibility has been revoked.");
  if (candidate.endsAt.getTime() !== stored.endsAt.getTime() || candidate.durationSeconds !== stored.durationSeconds) {
    throw new BrowserRewardSnapshotChanged("Mining session changed during settlement");
  }
}
