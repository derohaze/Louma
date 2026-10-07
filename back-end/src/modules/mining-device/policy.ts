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

// Honest about both causes: a lease can conflict because this device is mining, or because the
// guard identified the machine by hardware traits (the machine key) and another account holds a
// cycle on that identity. Claiming the caller's device is mining would be false for the second.
export const DEVICE_IN_USE_MESSAGE =
  "A mining cycle is already active on this device, or on a machine the guard identifies as the same hardware. One device runs one mining cycle at a time. Try again after the current cycle ends, or use a different device.";

export const DEVICE_STATUS_MESSAGE =
  "Mining is already active on this device. One device can run one mining cycle at a time. Try again after the current mining cycle ends or use a different device.";

/** Rejection code for POST /api/v1/mining/start when the request carries no device evidence. */
export const DEVICE_EVIDENCE_MISSING_CODE = "mining_device_evidence_required";

/**
 * Rejection code for POST /api/v1/mining/start when the request would create yet another new
 * machine identity beyond the account/network enrollment budget.
 */
export const DEVICE_ENROLLMENT_LIMITED_CODE = "mining_device_enrollment_limited";

// Names the limit as temporary and the account as unaffected: a first-time user refused here has
// nothing wrong with their account, and the previous wording read as though they did.
export const DEVICE_ENROLLMENT_LIMITED_MESSAGE =
  "Too many new devices have been registered from this account or this network recently. Wait before trying again, or continue on a device you have already mined with. This limit is temporary and your account is not blocked.";

/**
 * Rejection code when a machine identity that has not earned server-owned trust appears on a network
 * where another account is already mining. A proof of possession does not clear it: the exemption is
 * the cluster's own trust state, never a browser key the caller generated.
 */
export const DEVICE_NETWORK_IN_USE_CODE = "mining_device_network_in_use";

export const DEVICE_NETWORK_IN_USE_MESSAGE =
  "Mining is already active from this network. Try again after the current cycle ends, or continue on a device that has already mined here.";

export const DEVICE_EVIDENCE_MISSING_MESSAGE =
  "Mining cannot start because this browser hides or does not provide enough device information. Use a browser that exposes device information or allow it for this site, then try again. Your account is not blocked.";

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

/**
 * Cluster search fan-out: how many recent devices the fuzzy match compares against.
 */
export const CLUSTER_CANDIDATE_LIMIT = 50;

/**
 * How many live-lease records the fuzzy backstop pulls into one start's comparison set.
 *
 * The exact checks are unbounded by design and indexed (the observation's own lease keys, and the
 * live leases on this network); this cap only bounds the *similarity* heuristic that correlates an
 * observation with a lease-holder whose traits changed (a driver update, a rewritten fingerprint),
 * which would otherwise load every device record of the whole active mining population on every
 * start. Newest leases first, so the bounded set is the one most likely to still be running.
 */
export const LIVE_LEASE_BACKSTOP_LIMIT = 200;

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

/**
 * How many network contexts one cluster keeps credited activity for.
 *
 * A device moves between home, office and a phone hotspot; the most recent few networks are kept so
 * a returning home device does not have to re-earn its exemption, and the oldest entry is dropped
 * once the ceiling is reached (the network lock only ever reads the entry for the current network).
 */
export const MAX_NETWORK_TRUSTS = 3;

/** Findings a cluster may accumulate before the risk engine treats it as suspicious. */
export const MAX_CONSISTENCY_FINDINGS = 6;

/** Hard abuse caps (evidence, not identity proof — they feed the risk score). */
export const MAX_ACCOUNTS_PER_DEVICE_CLUSTER = 5;
export const MAX_DEVICES_PER_ACCOUNT = 10;
export const MAX_REJECTS_BEFORE_QUARANTINE = 8;

/**
 * Reserved `deviceClusterId` namespace of the per-network admission token (see
 * `networkLockKeyFor` in lease.ts): one active token per network, taken by every non-resident
 * start, so two fresh identities racing on one network serialize on the unique active-lease index.
 * Device identities are server-derived digests and can never carry this prefix, so the readers that
 * mean "a lease on a device" exclude it.
 */
export const NETWORK_LOCK_KEY_PREFIX = "net:";
export const NETWORK_LOCK_KEY_PATTERN = /^net:/;

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
