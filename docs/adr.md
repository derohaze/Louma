# Architecture Decision Records

## ADR-001 — MongoDB remains the source of truth

Alternatives (event bus, second database, Redis-backed balances) were rejected:
the workload is single-digit collections with strict consistency needs, and
every correctness property (idempotency, one-spend, no-negative) maps to a
MongoDB unique index or conditional update. Smallest architecture that scales.

## ADR-002 — Redis is cache/ephemeral infrastructure only

Redis accelerates rebuildable reads, throttles abuse per-identity, and
coordinates non-critical work. It never authorizes money: locks are advisory,
rate limits fail open, caches are invalidated-after-write with TTL-bounded
staleness. A Redis lock is never the sole proof for a money movement;
correctness is identical with Redis disabled (suites run disabled and pass).

## ADR-003 — mining_settlements merged into transactions

The settlement collection duplicated the journal header (same publicId, same
amount, same parties). One financial event, one record: the `mining` journal
header is authoritative, with (session, sequence) and idempotency-key unique
indexes as the idempotency boundary. Migration is same-publicId insert-only;
the old collection stays (read-only) until the drop checklist passes.

## ADR-004 — two_factor_uses stays a separate collection

Merging step-consumption into transfer_authorizations would couple two
independent uniqueness grains (per-approval spend vs per-step-once) and weaken
the audit trail (one row per accepted step, intent-bound). The separate
collection with its own unique index is the stronger invariant; collection
count is not worth trading for it.

## ADR-005 — no collection renames

mining_sessions/mining_pool_members keep their names. Renames require a live
migration with zero financial upside and real production risk. Naming
consistency is enforced for new collections only.

## ADR-006 — index policy: justify, don't speculate

Every index serves a named query (see definitions.ts). Partial unique indexes
express business rules (one active cycle, one spend per approval/step).
Redundant prefix duplicates are removed; unique and TTL indexes are never
removed for tidiness. New indexes require a measured query + explain.

## ADR-007 — bounded documents

Every array has a validator-enforced maximum (participants = 2, digests <= 5
per feature key, aliases <= 8, trusts <= 3, metadata <= 16 properties).
History lives in separate TTL collections, never in growing parent arrays.
The 16 MiB limit is treated as a failure state to stay orders of magnitude
away from, not a budget to spend.

## ADR-008 — repository scope

Repositories own the journal header/entries pairing and the balance assertion
(postBalancedJournal). Balance mutations stay in services (flow-specific
conditional semantics), reads stay in services/modules (query-specific shapes).
No abstraction without at least two callers — unused finders were deleted.

## ADR-009 — wallet identity and ownership

Users own wallets through `wallets.ownerUserId`, with one or more wallet
documents per user. `isPrimary` selects the current product wallet and a partial
unique index enforces at most one primary per owner. Registration creates the
user, primary wallet, ledger account and registration audit event in one
MongoDB transaction. No ownership join collection is needed while each wallet
has one owner, and no secondary-wallet API or UI is added until the product
requires it.

`address` is the immutable routing identity, separate from the wallet public ID
and from a mutable custom handle. Version 1 uses 128 random bits encoded as
26 uppercase Crockford Base32 symbols, prefixed by `LMA`, plus a two-symbol
SHA-256 typo checksum. Randomness avoids user-linked data; MongoDB's unique
`addressNormalized` index decides collisions and only that duplicate error is
retried. Wallet address replacement updates existing wallet rows without
retaining the old address as a live alias. Historical transaction snapshots
remain unchanged. See `docs/migrations.md` for the guarded one-time migration.

The wallet collection stays unsharded. Any future shard design must preserve
global uniqueness of `addressNormalized`; sharding only by owner would not make
that uniqueness guarantee enforceable. Account-level mining quotas remain
owner-scoped, while each mining settlement uses the session's concrete
`walletId` and `ledgerAccountId`.
## ADR-010 — Pro subscriptions and custom address lifecycle

MongoDB `subscriptions` is the authorization source for monthly, yearly and
lifetime Pro. Customer tokens and Redis never grant this entitlement. A partial
unique owner index permits one active record; renewals preserve superseded
records and extend a finite subscription from its current expiry. Durations
use UTC calendar months/years, clamping month-end dates; lifetime has no expiry.
Validity requires `startsAt <= now < expiresAt`, or an active lifetime record.

Custom addresses are bare, case-insensitive ASCII aliases of 3–16 characters,
starting with a letter. The canonical random wallet address remains immutable
and usable. Protected reads and writes query subscription validity directly.
Alias-based transfer approvals bind the alias in their intent hash and recheck
both subscription and alias ownership through conflicting writes inside the
monetary transaction. Existing canonical approvals retain their hash format.

Expiry immediately disables routing and exposes the canonical address, without
depending on the sweep. A bounded, non-overlapping sweep archives and clears
inactive aliases. An immediate claim first releases an expired owner's alias
in a separate transaction, then claims through the existing global unique
alias index: MongoDB must commit the old unique-key release before reuse.
Renewals and alias changes conflict with in-flight alias transfers.

`wallet_address_history` holds one document per change/release, committed
atomically with the wallet mutation. **Explicit exception to ADR-007's TTL
history policy:** address and subscription history are permanent, as requested
for subscription lifecycle auditing. Neither collection embeds history arrays.
Customer history reads return at most the latest 20 rows, scoped to the owner.

Activation is available only through trusted local operator tooling with database
credentials. There is no customer activation endpoint, payment gateway or admin
UI. The operator script shares the same transactional service and activation-key
replay protection. See `docs/pro-subscriptions.md` for rollout and rollback.
