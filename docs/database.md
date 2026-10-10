# Database (MongoDB — the source of truth)

## Browser admission contract (ADR-018)

`users.miningAdmissionFence` is an optional boolean written inside admission to
serialize one account's history across independent browser keys. `mining_devices`
adds `identityKind: "browser"`; these records use canonical key HMACs as their
unique key and quota subject, never coarse machine fingerprints.

Browser nonces add bounded intent/purpose/origin and a separate `startUsedAt`.
The existing unique nonce index serves proof consumption. `mining_sessions` adds
`admissionPolicy` and `browserAdmission`, with at most eight enumerated risk
reasons and admitted rate/window bounds. Session and receipt are written together
with enrollment, proof consumption and leases. Session/lease history, not expiring
nonces, is the reward entitlement source. `two_factor_uses.purpose` additionally
accepts `mining`; existing unique/TTL indexes are preserved.

Exact legacy key and rendering-history lookups use `mining_devices_evidence`.
Legacy exact identities are capped at 200 with explicit busy refusal on overflow;
heuristic history overflow requires account verification and never creates an
identity conflict. Missing evidence versions prevent admission until migration
finishes. No new collection/index or financial document migration is required.

## Current mining evidence contract (ADR-017)

Initial and transactional mining candidate discovery now query all historical
states through `mining_devices_evidence` (`admissionEvidenceTokens`, `publicId`)
and `mining_devices_evidence_version` (`admissionEvidenceVersion`). The older
ADR-014/016 descriptions below record prior designs and are superseded here.
The version-1 token array is validator-bounded to `DEVICE_FEATURES.length * 11 + 2`
strings of at most 160 characters. Version and tokens must be present together.
Missing-version rows remain query candidates. Source fields and derived tokens
change atomically; migration compares source fields before writing. No unique/TTL
index or historical evidence is removed. More than 200 candidates fails closed;
selectivity probes and initial iteration share the existing 2,000 ms budget.

Tokens are private HMAC-derived matching aids and absence markers, not credentials
or verified hardware identity. Do not log/export them or put them in Redis.
All new production mining is refused until independently trusted enrollment
exists. See [ADR-017](adr.md) for completeness and compatibility and
[migration operations](migrations.md#mining-evidence-v1-adr-017).

## Collections (including subscription and address archives)

Core: users, wallets, ledger_accounts, ledger_entries, transactions.
Pro: subscriptions, subscription_grants, wallet_address_history (permanent
history; ADR-010).
Auth/security: sessions, security_events, two_factor_credentials,
transfer_password_credentials, transfer_authorizations, two_factor_uses,
financial_controls, notifications.
Mining: mining_sessions, mining_settings, mining_pool_members, mining_devices,
mining_device_leases, mining_device_nonces, mining_device_observations,
mining_device_quotas.
Mining admission coordination: mining_admission_networks (ADR-013).
Legacy: mining_settlements (write-frozen, migrated to the journal, drop only
after the verification in migrations.md).

Deliberately NOT renamed (mining_sessions, mining_pool_members): renames buy
nothing and risk a production migration. Deliberately NOT merged
(two_factor_uses stays separate — see ADR-004).

## Index policy

Every index names the query it serves (see definitions.ts comments). Compound
indexes follow Equality -> Sort -> Range. Uniqueness is a correctness tool:
transactions_transfer_id_unique, transactions_sender_wallet_idempotency_unique (transfer
scope), transactions_mining_session_sequence_unique + transactions_mining_idempotency_unique
(mining scope), mining_sessions_one_active_per_user, transfer_authorizations_consumed_by_unique,
two_factor_uses_step_unique, wallets_owner_primary_unique, wallets_address_unique, ledger_accounts_wallet_unique,
treasury/revenue uniqueness. Never remove a unique index for looking redundant;
never add an index without a measured query.

`wallets.ownerUserId` is one-to-many. The partial unique
`wallets_owner_primary_unique` enforces at most one primary wallet per owner;
`wallets_owner_list` serves the owner wallet-list ordering query when that backend
capability is added. Current customer endpoints still resolve only the primary
wallet. `wallets_address_unique` remains global so address routing cannot collide.
`wallets_address_legacy_migration` serves the bounded version-0 migration batches
and the startup readiness check; its partial index is empty after cutover.
Future sharding of `wallets` must preserve globally enforceable uniqueness for
`addressNormalized`; sharding by `ownerUserId` alone would not satisfy that invariant.

Wallet addresses are versioned. Version 0 is accepted only so the one-time address
migration can update existing documents; a serving process refuses to start until
all wallet rows are version 1. Version 1 is `LMA` + 26 uppercase Crockford Base32
symbols from 128 CSPRNG bits + a 2-symbol SHA-256 checksum. `address` is canonical
and immutable after provisioning; custom handles remain separate aliases.

## Validators

Pro authorization uses `subscriptions_owner_active_unique`; activation retries
use `subscription_grants_activation_unique` (with the legacy subscription key
index retained for older grants). The expiry sweep uses
`subscriptions_expiry`, and latest-20 owner history uses
`wallet_address_history_owner`. `wallets_custom_address_unique` keeps active
aliases globally unique and also serves the bounded alias sweep. History has
no TTL and no parent arrays. See `pro-subscriptions.md` and ADR-010 for lifecycle.

Strict + error on all collections. Money bounded by LEDGER_AMOUNT_MAX_MINOR
(single movement) and LEDGER_BALANCE_MAX_MINOR (cumulative projection), both
inside the JS safe-integer range, minor units only. transfers require their
full triple; mining headers require owner/wallet/session/sequence/amounts/
treasury/idempotencyKey. `walletAccountId` is written by current code and
backfilled for legacy headers, but is not validator-required: during a
mixed-version rollout an older process still writes headers without it, and
requiring it would reject that process's settlement transactions. Bounded
arrays: participants exactly 2,
recoveryCodeHashes <= 16, notification title/body lengths, security metadata
<= 16 properties, device featureProfile <= 64 keys x <= 5 digests.

## TTL

sessions.expiresAt, nonces, quotas, observations (clamped >= 30d: the risk
engine's window), authorizations/two-factor-uses retainUntil (retention, never
validity), mining_pool_members.expiresAt. A pool row is a *hold*, not a
membership: `expiresAt` is the deadline (the cycle's end, or the join grace)
and every reader requires a live hold, so the sweep only clears what is
already dead — a room joined but never started, a cycle that ended, or a
released row kept while it anchors the room-change throttle. Retention TTLs
for notifications/security_events are opt-in
(RETENTION_TTL_ENABLED) and never touch unread notices. Financial facts
(transactions, ledger_entries) NEVER expire.

`mining_admission_networks` contains only `_id` (the server-keyed network
identity), `fence` (boolean), and `expiresAt` (date). The built-in unique `_id`
index serves exact lookups; `mining_admission_networks_ttl` reclaims rows after
24 hours without a start. Deletion never releases a mining lease. Starts
prepare the row before their transaction and require its presence inside it.
The optional `mining_devices.admissionFence` boolean coordinates correlated
starts without changing device identity, quotas, trust, or lease uniqueness.

ADR-014 replaces the capped admission candidate pages with a complete cursor
over device matching/lease fields, in batches of 64. This is an O(N) scan, with
a 2000 ms execution/iteration budget and at most 200 retained correlated
records; exceeding either aborts admission with `mining_start_busy`, never
accepts a truncated result. Legacy raw snapshots, drift rings, idle contenders
and blocked devices with surviving leases remain visible. No new index or
schema is needed. `docsScanned` in the mining benchmarks counts documents
delivered to the application (including streaming), not server executionStats;
query-call counts also exclude individual `getMore` commands. Use populated
explain/load measurements when evaluating capacity.

`mining_device_attempts` (ADR-015) stores account/action `_id`, `attempts` (an
array of at most 30 dates, enforced by the validator), and `expiresAt`. Exact
conditional updates use the built-in unique `_id`; `mining_device_attempts_ttl`
expires idle rows. MongoDB time and an atomic sliding-window update enforce
12 mining starts/minute, 20 challenges/hour and 30 proof attempts/hour per
account, independently of Redis, nonce TTL and audit storage. Refusals are
temporary 429 responses; storage failure returns 503 without granting mining.
These are attempt counters, not enrollments, leases, balances or audit history.

ADR-016 replaces only ADR-014's transaction revalidation scan with an indexed union over
`mining_devices`: `admissionPending > 0`, `admissionLeaseEndsAt > now`, or a
missing `admissionLeaseEndsAt`. The ordinary ascending indexes
`mining_devices_admission_pending` and `mining_devices_admission_window` serve
these branches. Pending is an optional bounded nonnegative integer; the window
is an optional date. Neither is client-writable or a trust/identity signal.

Each start registers before assessment and releases after completion/abort.
The existing transaction fence retains its cycle end on all compared records,
including peers whose identities it leases. A stopped cycle may leave a future
upper bound. Missing legacy windows stay visible and bootstrap backfills them
in 200-row batches through the latest existing active cycle/lease end.
Pending references never expire; failed cleanup remains conservative.

Initial assessment still scans all historical profiles and retains its compared
IDs/lease keys for transaction revalidation. Filtering both scans regressed
asymmetric learned-history enforcement and was rejected by the final audit.
Only transaction-discovery cost follows the retained/pending population;
the total start still has an O(N) historical scan and can return temporary busy
responses at large populations. The same scan budget/correlation cap applies.
Drain older mining writers before bootstrap; mixed-version writers
are unsafe. Rollback/re-upgrade and crashed-reference cleanup prerequisites
are specified in ADR-016. No historical records or financial data are deleted.
