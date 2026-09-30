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

export const DEVICE_EVIDENCE_MISSING_MESSAGE =
  "This device could not be identified, so mining cannot start. Reload the page — and if the problem persists, turn off content blockers for this site — then try again.";

/** Challenge handshake rate limits (per account). */
export const CHALLENGE_MAX_PER_HOUR = 20;
export const PROVE_MAX_PER_HOUR = 30;

/** Cluster search fan-out: how many recent devices the fuzzy match compares against. */
export const CLUSTER_CANDIDATE_LIMIT = 50;

/** Observation write sampling: persist at most one observation per device per this window. */
export const OBSERVATION_MIN_INTERVAL_MS = 60_000;

/** History windows used by the risk engine. */
export const ACCOUNT_DEVICE_WINDOW_DAYS = 30;
export const DEVICE_ACCOUNT_WINDOW_DAYS = 30;

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
} as const;
