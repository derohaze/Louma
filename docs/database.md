# Database (MongoDB — the source of truth)

## Collections (24 total, including subscription and address archives)

Core: users, wallets, ledger_accounts, ledger_entries, transactions.
Pro: subscriptions, wallet_address_history (permanent history; ADR-010).
Auth/security: sessions, security_events, two_factor_credentials,
transfer_password_credentials, transfer_authorizations, two_factor_uses,
financial_controls, notifications.
Mining: mining_sessions, mining_settings, mining_pool_members, mining_devices,
mining_device_leases, mining_device_nonces, mining_device_observations,
mining_device_quotas.
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
use `subscriptions_activation_unique`. The expiry sweep uses
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
