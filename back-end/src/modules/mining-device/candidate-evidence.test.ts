import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { admissionEvidence, candidateEvidenceCover, identityEvidence, MAX_EVIDENCE_TOKENS } from "./candidate-evidence.js";
import { decideClusterMatch, DEVICE_FEATURES, featureDigest, matchDeviceFeatures, type DeviceFeatureMap } from "./identity.js";
import type { MiningDeviceFeatureProfile } from "../../shared/types.js";

const secret = Buffer.alloc(32, 7);

test("evidence cover contains every positive directional comparison across sparse histories and thresholds", () => {
  let state = 72413;
  const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
  let positive = 0;
  for (let iteration = 0; iteration < 12_000; iteration++) {
    const raw: DeviceFeatureMap = {};
    const digests: DeviceFeatureMap = {};
    const snapshot: DeviceFeatureMap = {};
    const profile: MiningDeviceFeatureProfile = {};
    const agreementCost = new Map<string, number>();
    const absenceCost = new Map<string, number>();
    for (const feature of DEVICE_FEATURES) {
      const value = `value-${Math.floor(random() * 3)}`;
      if (random() < 0.7) { raw[feature.key] = value; digests[feature.key] = featureDigest(secret, feature.key, value); }
      if (random() < 0.6) snapshot[feature.key] = random() < 0.5 ? value : featureDigest(secret, feature.key, value);
      if (random() < 0.5) profile[feature.key] = {
        digests: [featureDigest(secret, feature.key, `value-${Math.floor(random() * 3)}`)], count: 3,
        drift: [featureDigest(secret, feature.key, `value-${Math.floor(random() * 3)}`)],
      };
      agreementCost.set(feature.key, Math.floor(random() * 202));
      absenceCost.set(feature.key, Math.floor(random() * 202));
    }
    const candidate = { featureProfile: profile, featureSnapshot: snapshot, machineKeyHash: null,
      browserKeyPublicKey: null, fingerprintVisitorIdHash: null };
    const observed = { raw, digests, machine: {} };
    const threshold = [20, 55, 77, 54.2][iteration % 4]!;
    const verdict = decideClusterMatch(matchDeviceFeatures(candidate, observed, secret), 90, threshold);
    const cover = candidateEvidenceCover({ observed, ambiguousThreshold: threshold, agreementCost, absenceCost, identityTokens: [] });
    const indexed = admissionEvidence(candidate, secret).admissionEvidenceTokens;
    assert.ok(indexed.length <= MAX_EVIDENCE_TOKENS);
    if (verdict !== "different") {
      positive++;
      assert.ok(cover.some(token => indexed.includes(token)), `omitted ${verdict} at case ${iteration} threshold ${threshold}`);
    }
  }
  assert.ok(positive > 1000, `insufficient positive cases: ${positive}`);
});

test("canonical key continuity and exact machine identity do not depend on reported features", () => {
  const jwk = generateKeyPairSync("ec", { namedCurve: "P-256" }).publicKey.export({ format: "jwk" });
  const original = JSON.stringify(jwk);
  const reordered = JSON.stringify({ y: jwk.y, x: jwk.x, crv: "P-256", kty: "EC", ext: true });
  assert.deepEqual(identityEvidence({ browserKeyPublicKey: original, machineKeyHash: "machine" }, secret),
    identityEvidence({ browserKeyPublicKey: reordered, machineKeyHash: "machine" }, secret));
});

test("class drift alone is not indexed as an agreement and absent baseline stays absent", () => {
  const indexed = admissionEvidence({ featureProfile: {
    hardwareConcurrency: { digests: ["old"], count: 2, drift: ["new"] },
    gpu: { digests: [], count: 0, drift: ["unbased"] },
  }, featureSnapshot: null, browserKeyPublicKey: null, machineKeyHash: null }, secret).admissionEvidenceTokens;
  assert.ok(!indexed.includes("hardwareConcurrency:new"));
  assert.ok(indexed.includes("gpu:absent"));
  assert.ok(!indexed.includes("gpu:unbased"));
});
