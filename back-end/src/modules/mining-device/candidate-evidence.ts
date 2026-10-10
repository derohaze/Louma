import type { MiningDeviceRecord } from "../../shared/types.js";
import {
  canonicalBrowserKey, DEVICE_FEATURES, featureDigest, hmacHex,
  type DeviceFeatureSpec, type ObservedFeatures,
} from "./identity.js";

export const EVIDENCE_VERSION = 1;
// Per feature: five learned + five drift + one snapshot (or one absence), plus two identities.
export const MAX_EVIDENCE_TOKENS = DEVICE_FEATURES.length * 11 + 2;
export const evidenceToken = (key: string, digest: string) => `${key}:${digest}`;
export const absentToken = (key: string) => `${key}:absent`;

type EvidenceSource = Pick<MiningDeviceRecord, "featureProfile" | "featureSnapshot" | "machineKeyHash" | "browserKeyPublicKey">;

/** Exactly the matcher inputs, including directional history and raw legacy snapshots. */
export function admissionEvidence(source: EvidenceSource, secret: Buffer) {
  const tokens = new Set<string>();
  for (const feature of DEVICE_FEATURES) {
    const entry = source.featureProfile?.[feature.key];
    const snapshot = source.featureSnapshot?.[feature.key];
    const values = new Set(entry?.digests ?? []);
    if (snapshot !== undefined) values.add(/^[0-9a-f]{32}$/.test(snapshot) ? snapshot : featureDigest(secret, feature.key, snapshot));
    if (values.size === 0) tokens.add(absentToken(feature.key));
    else {
      if (!feature.machineClass) for (const digest of entry?.drift ?? []) values.add(digest);
      for (const digest of values) tokens.add(evidenceToken(feature.key, digest));
    }
  }
  for (const token of identityEvidence(source, secret)) tokens.add(token);
  return { admissionEvidenceVersion: EVIDENCE_VERSION, admissionEvidenceTokens: [...tokens] };
}

export function identityEvidence(source: Pick<EvidenceSource, "machineKeyHash" | "browserKeyPublicKey">, secret: Buffer) {
  const key = canonicalBrowserKey(source.browserKeyPublicKey);
  return [
    ...(key ? [`key:${hmacHex(secret, "lmdg-admission-key-v1", key)}`] : []),
    ...(source.machineKeyHash ? [`machine:${source.machineKeyHash}`] : []),
  ];
}

export function observedEvidenceFeatures(observed: ObservedFeatures) {
  return DEVICE_FEATURES.filter(feature => Boolean(observed.digests[feature.key]));
}

/** Minimum-cost weight cover. Counts are performance hints, never authorization evidence. */
function weightedCover(features: readonly DeviceFeatureSpec[], required: number, cost: (key: string) => number) {
  const choices = new Map<number, { cost: number; keys: string[] }>([[0, { cost: 0, keys: [] }]]);
  for (const feature of features) {
    for (const [weight, choice] of [...choices]) {
      const nextWeight = Math.min(required, weight + feature.weight);
      const nextCost = choice.cost + cost(feature.key);
      if (nextCost < (choices.get(nextWeight)?.cost ?? Infinity)) {
        choices.set(nextWeight, { cost: nextCost, keys: [...choice.keys, feature.key] });
      }
    }
  }
  return choices.get(required)?.keys ?? [];
}

/**
 * Completeness: positive verdicts need >=3 machine agreements OR score >= threshold.
 * Any m-2 of m observed machine features intersects every matching triple.
 * If a weighted cover neither agrees nor is absent, its whole weight is disagreement;
 * even matching every remaining feature cannot round up to the threshold. Thus every
 * positive comparison hits this union. See ADR-017 for the inequality and legacy cases.
 */
export function candidateEvidenceCover(input: {
  observed: ObservedFeatures;
  ambiguousThreshold: number;
  agreementCost: ReadonlyMap<string, number>;
  absenceCost: ReadonlyMap<string, number>;
  identityTokens: string[];
}): string[] {
  const features = observedEvidenceFeatures(input.observed);
  const machine = features.filter(feature => feature.machine);
  const tokens = new Set(input.identityTokens);
  const agreementCost = (key: string) => input.agreementCost.get(key) ?? 0;
  if (machine.length >= 3) {
    machine.sort((a, b) => agreementCost(a.key) - agreementCost(b.key));
    for (const feature of machine.slice(0, machine.length - 2)) {
      tokens.add(evidenceToken(feature.key, input.observed.digests[feature.key]!));
    }
  }
  const weight = features.reduce((sum, feature) => sum + feature.weight, 0);
  if (weight > 0) {
    const required = Math.floor(weight * (1 - (Math.ceil(input.ambiguousThreshold) - 0.5) / 100)) + 1;
    for (const key of weightedCover(features, required, key => agreementCost(key) + (input.absenceCost.get(key) ?? 0))) {
      tokens.add(evidenceToken(key, input.observed.digests[key]!));
      tokens.add(absentToken(key));
    }
  }
  return [...tokens];
}
