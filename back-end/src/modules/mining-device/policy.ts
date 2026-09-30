/**
 * Louma Mining Device Guard (LMDG) — centralized policy.
 *
 * All thresholds live here or in `LMDG_*` environment variables (see config/env.ts).
 * Routes and services must not scatter hard-coded cutoffs.
 *
 * Honest scope: multi-signal correlation + proof-of-possession. Not a guaranteed
 * physical-machine identity — no browser mechanism provides that across
 * profiles/VMs/private windows.
 */

/** Rejection code for POST /api/v1/mining/start when another account holds the device lease. */
export const DEVICE_IN_USE_CODE = "mining_device_already_in_use";

export const DEVICE_IN_USE_MESSAGE =
  "This device already has an active mining cycle. Try again after the current cycle ends.";

export const DEVICE_STATUS_MESSAGE =
  "Mining is already active on this device. One device can run one mining cycle at a time. Try again after the current mining cycle ends or use a different device.";

/** Rejection code for POST /api/v1/mining/start when the request carries no device evidence. */
export const DEVICE_EVIDENCE_MISSING_CODE = "mining_device_evidence_required";

/**
 * Rejection code for POST /api/v1/mining/start when the request would create yet another new
 * machine identity beyond the account/network enrollment budget.
 */
export const DEVICE_ENROLLMENT_LIMITED_CODE = "mining_device_enrollment_limited";

export const DEVICE_ENROLLMENT_LIMITED_MESSAGE =
  "Too many new devices have been registered from this account or network recently. Try again later, or start mining on a device you have already used.";

/**
 * Rejection code when a machine identity that has not earned server-owned trust appears on a network
 * where another account is already mining. A proof of possession does not clear it: the exemption is
 * the cluster's own trust state, never a browser key the caller generated.
 */
export const DEVICE_NETWORK_IN_USE_CODE = "mining_device_network_in_use";

export const DEVICE_NETWORK_IN_USE_MESSAGE =
  "Mining is already active from this network. Try again after the current cycle ends, or continue on a device that has already mined here.";

export const DEVICE_EVIDENCE_MISSING_MESSAGE =
  "This device could not be identified, so mining cannot start. Reload the page — and if the problem persists, turn off content blockers for this site — then try again.";

/** Challenge handshake rate limits (per account). */
export const CHALLENGE_MAX_PER_HOUR = 20;
export const PROVE_MAX_PER_HOUR = 30;

/**
 * Proof protocol version. The signed payload carries it, so a signature can never be replayed
 * across protocol revisions, and a server upgrade can refuse pre-binding handshakes outright.
 */
export const LMDG_PROOF_VERSION = 1;

/** The action a device proof is valid for — proof is bound to intent, not to possession alone. */
export const LMDG_PROOF_ACTION = "lmdg.mining_start";

/** Cluster search fan-out: how many recent devices the fuzzy match compares against. */
export const CLUSTER_CANDIDATE_LIMIT = 50;

/**
 * How many device clusters behind one network identity the network-scoped checks consider.
 * A bounded probe, served by `mining_devices_network_seen`: it asks "is another account mining on
 * this network, and is this one of many new identities", not "enumerate every device behind a NAT".
 */
export const NETWORK_DEVICE_PROBE_LIMIT = 50;

/** Observation write sampling: persist at most one observation per device per this window. */
export const OBSERVATION_MIN_INTERVAL_MS = 60_000;

/** History windows used by the risk engine. */
export const ACCOUNT_DEVICE_WINDOW_DAYS = 30;
export const DEVICE_ACCOUNT_WINDOW_DAYS = 30;

/** Rolling windows the identity-creation budget is counted over. */
export const ENROLLMENT_HOUR_MS = 60 * 60 * 1000;
export const ENROLLMENT_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * How many machine-key aliases one cluster keeps.
 *
 * Append-only and bounded: aliases are added only by a server-side trust transition (an allowed
 * admission of an observation the server decided is the same machine), so the list cannot be driven
 * by rejected requests, and the ceiling keeps the document size finite.
 */
export const MAX_CLUSTER_ALIASES = 8;

/** Findings a cluster may accumulate before the risk engine treats it as suspicious. */
export const MAX_CONSISTENCY_FINDINGS = 6;

/** Hard abuse caps (evidence, not identity proof — they feed the risk score). */
export const MAX_ACCOUNTS_PER_DEVICE_CLUSTER = 5;
export const MAX_DEVICES_PER_ACCOUNT = 10;
export const MAX_REJECTS_BEFORE_QUARANTINE = 8;

export const LMDG_EVENT_TYPES = {
  registered: "mining_device_registered",
  verified: "mining_device_verified",
  rejected: "mining_device_rejected",
  conflict: "mining_device_conflict",
  challenge: "mining_device_challenge",
  challengeFailed: "mining_device_challenge_failed",
  rebind: "mining_device_rebind",
  suspicious: "mining_device_suspicious",
  enrollmentLimited: "mining_device_enrollment_limited",
  networkInUse: "mining_device_network_in_use",
  aliasAccepted: "mining_device_alias_accepted",
} as const;
