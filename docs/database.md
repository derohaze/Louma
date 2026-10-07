# Database (MongoDB — the source of truth)

## Collections (22 total, ~20 live + 1 legacy-frozen + 1 deprecated-pending-drop)

Core: users, wallets, ledger_accounts, ledger_entries, transactions.
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
transactions_transfer_id_unique, transactions_idempotency_unique (transfer
scope), transactions_mining_session_sequence_unique + transactions_mining_idempotency_unique
(mining scope), mining_sessions_one_active_per_user, transfer_authorizations_consumed_by_unique,
two_factor_uses_step_unique, wallets_owner_unique, ledger_accounts_wallet_unique,
treasury/revenue uniqueness. Never remove a unique index for looking redundant;
never add an index without a measured query.

## Validators

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
