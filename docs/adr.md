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
lifetime Pro. Customer tokens and Redis never grant this entitlement. It keeps
one stable current row per owner; renewals and reactivations update that row in
place so the partial unique owner index remains valid through transaction commit.
Each activation is separately preserved in `subscription_grants`, which also
owns activation-key replay protection. Legacy subscription rows remain readable
for replay checks. Finite renewals extend from the current expiry while active;
reactivation starts from now. Durations use UTC calendar months/years, clamping
month-end dates; lifetime has no expiry.
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
history policy:** address and subscription-grant history are permanent, as
requested for subscription lifecycle auditing. Neither collection embeds
history arrays.
Customer history reads return at most the latest 20 rows, scoped to the owner.

Activation is available only through trusted local operator tooling with database
credentials. There is no customer activation endpoint, payment gateway or admin
UI. The operator script shares the same transactional service and activation-key
replay protection. See `docs/pro-subscriptions.md` for rollout and rollback.

## ADR-011 — local gateway tests on the confirmed Atlas sandbox

For the current development phase, the operator has confirmed that the Atlas
cluster configured by `back-end/.env.development` is a test environment, and
that its database name is `louma` even though `back-end/.env.production` also
uses that name. The local gateway runner and Go `test` configuration may use
this exact database name, while retaining the test-environment requirement.
The existing `louma_gateway_test*` names remain supported for isolated tests.

This is a local test-environment exception to the name-based separation check;
it does not enable `live`, change MongoDB as the financial source of truth, or
weaken ledger, idempotency, uniqueness, or transaction invariants. Live gateway
operation still requires its explicit enablement and a separately verified
compatible deployment database. Revisit this exception when the Atlas sandbox
or production database assignments change.

## ADR-012 — production gateway deployment and sandbox separation

On 2026-10-10 the operator confirmed `louma` on the configured Atlas cluster as
the production gateway database. The Node production backend and live Go gateway
must use this same database for financial consistency. ADR-011's temporary
permission to use `louma` in gateway test mode is therefore retired.

Development uses `louma_gateway_test_dev`, shared only by the development Node
backend and test Go gateway. The gateway loader and local runner reject `louma`
in test mode. This changes configuration only: existing data is not moved,
deleted, converted, or reclassified by a migration.

Live deployment requires shared Redis rate limits, purpose-separated secrets,
explicit live enablement, and the existing compatible-schema checks. Redis
continues to hold ephemeral throttling counters only; all authorization,
idempotency, balances and ledger events remain in MongoDB. Proxy-derived client
IPs are accepted only through explicitly trusted proxy CIDRs.

## ADR-013 — transaction revalidation for mining admission

The 2026-10-10 isolated MongoDB audit reproduced two stale admission plans:
near-clone enrollments that resolve before either record exists, and a new
network identity assessed before a resident commits. Both open two cycles when
the old `start.ts` is restored in a temporary copy. Existing unique leases
cannot collide when the earlier assessments produced disjoint keys.

Rebuild the candidate/lease decision inside the snapshot transaction and write
a boolean `admissionFence` on the caller's device and directly correlated
devices. Every start writes its own record, so even a one-sided comparison
conflicts with a competing start. Retain previously compared device IDs and
lease keys across revalidation: recency churn must not erase an earlier pair.
The existing matcher and pair tokens retain their meaning; no transitive
similarity merges or broader fingerprint thresholds are introduced.

For the existing network policy, both residents and newcomers also write one
network fence before checking live leases. `mining_admission_networks` is a
separate, strict three-field collection (`_id`, `fence`, `expiresAt`). An exact
indexed upsert prepares its row outside the transaction, with expiry 24 hours
ahead. The transaction requires the row, toggles it, and rechecks the existing
resident exemption. Residents share coordination, not a persistent exclusive
lease. Two unrelated residents can still run together. A missing row fails
closed and can be recreated by a later request; TTL never releases a cycle.
The only added index is the expiry TTL; exact reads use built-in `_id_`
(verified: one key and one document examined).

The mining cycle, its device leases, and admission fences commit or roll back
together under snapshot reads and majority writes. Preparation alone grants
nothing. No Redis authorization, external network calls within transactions,
financial collection changes, history deletion, or unbounded stored arrays.
Callback execution stops after five attempts and commit attempts have a
5-second server limit. Driver commit recovery retains its own bounded behavior.

A global mutex was rejected because it would serialize unrelated devices and
still could not authenticate browser-supplied hardware. More permissive retry
budgets were rejected in favor of retryable busy responses. The bounded fuzzy
candidate search remains incomplete under saturation; client-forged evidence
and the newcomer-first/resident-later exemption also remain limitations. See
[the consolidated audit](mining-security-report.md) for evidence, costs, stronger
identity options, and rollout prerequisites. The new guarantee applies only
after all mining-serving instances use this admission path; mixed old/new
instances do not all participate in its fences. Rollback leaves the optional
field and coordination collection in place and reopens the fixed races.

## ADR-014 — complete, resource-bounded mining admission comparisons

The browser-only follow-up on 2026-10-10 reproduced a second failure of the
ADR-013 recency window. Seventy newer running devices hide an older victim
before assessment; seventy newer idle records can also hide both contenders
through concurrent assessments and transaction revalidation. In an isolated
copy with the earlier candidate loader/admission restored, the same new tests
admit both accounts. Retaining previously compared IDs cannot discover these
missing records.

Admission now streams every stored device in batches of 64, using only the
fields needed for matching and lease keys. It includes idle contenders and
blocked devices because a status change does not itself release a live cycle.
Both assessment and transaction revalidation use the existing matcher, including
learned rings, drift and legacy snapshots. The immutable exact identities,
pairwise leases, write fences, and snapshot/majority transaction remain intact.
The resolution lookup's recent-candidate heuristic is no longer an admission
authorization boundary. This change does not claim complete historical quota
discovery or authenticate browser hardware.

Each scan has a 2000 ms server execution budget and checks elapsed application
time while iterating. Admission retains at most 200 correlated records,
including its own. Exhaustion returns retryable `503 mining_start_busy`; a
partial scan must never grant a cycle. This is a resource refusal, not an
account or device ban. Monitoring-only near-miss keys remain a bounded sample.
MongoDB cursor errors propagate and transaction failure rolls back the fences,
session and leases. No new collections, persisted arrays, indexes or migrations.

This deliberately trades bounded recency work for **O(N) comparison work** with
bounded memory. It closes the measured omission attacks, but increases latency
and may refuse starts at populations/load that exceed the budget. The isolated
5000-profile completion check measured 947.0 ms for a start and 412.9 ms
inside its transaction callback on MongoDB 8.0.0; these are workstation samples, not capacity
guarantees. Existing per-account/network enrollment limits still bound cheap
identity creation, but are not a global denial-of-service proof.

A larger fixed page or a truncated-success fallback reopens the bug. A global
mutex does not authenticate identities. An indexed replacement remains a
possible optimization, but must cover all matcher paths, absent fields, raw
legacy snapshots and both value rings; a CPU/model-only bucket would miss
currently correlated cases. Adding a generic wildcard index before a selective
query is demonstrated is not justified. The current complete scan is the
correctness reference for any such replacement.

All mining-serving instances must adopt this path before claiming complete
comparison coverage. Before deployment, exercise the expected historical
population and concurrency and inspect latency/busy rates; do not interpret
resource refusals as fraud. Rollback preserves data and reopens both omission
attacks. See [the consolidated browser-only report](mining-security-report.md)
for causal tests, measurements, external research references and remaining limits.
The completion check also reproduces the newcomer-first/resident-later ordering
as two accepted starts on one network; the residency exemption cannot establish
physical-device uniqueness when the browser identities were forged.

## ADR-015 — self-hosted mining attempt budgets and public-key continuity

The isolated follow-up reproduced two concurrent cycles from edited browser
evidence carrying the same P-256 public key in different JSON serializations.
Admission compares canonical key material as exact continuity, in both its
initial complete scan and transaction revalidation. This also covers existing
records without rewriting their stored key strings or changing lease indexes.
Key metadata, property order and equivalent base64 encodings are not identity.
Independent keys remain independent; this does not attest to physical hardware.

With Redis disabled, 24 concurrent start attempts from one account across two
API instances and rotating peer addresses all reached device validation.
Introduce `mining_device_attempts`, separate from enrollment quotas and audit
history: a strict document with `_id` (account plus action), `attempts` (at most
30 dates), and `expiresAt`. The built-in unique `_id` serves exact writes;
the sole added index is expiry TTL. No IP, fingerprint or key material is stored.

A server-owned sliding window allows 12 starts/minute, 20 challenge requests/hour,
and 30 proof attempts/hour per account. MongoDB time determines expiry. A
conditional update prunes expired timestamps and appends one attempt atomically,
with majority write concern. Preparation grants nothing; failure to consume
does not proceed. The counter stays spent when a subsequent operation fails:
it measures attempts, not accepted mining. Expired nonce deletion and audit-write
failures cannot reset it. TTL cleans idle counters; logical expiry never waits
for the TTL sweep. Redis throttles remain a cheaper outer layer.

Exhaustion returns temporary `429 rate_limited`; storage errors fail with retryable
503. Honest users can complete the normal start/challenge/prove/retry sequence.
Repeated rapid clicks can hit the same limit; other accounts on the same Wi-Fi
do not share this budget. There is no fingerprint-similarity or network ban added.
Many authenticated accounts can still multiply the budget, and patient attackers
can stay below it. No claim of bot-proof or AI-proof identity follows.

Bootstrap validators and the TTL index before serving; all API instances must
use the new admission path and budgets. Mixed versions retain bypass paths.
Rollback can leave these expiring documents intact, but loses the protections.
No historical data migration or financial collection/index change is required.

## ADR-016 — indexed transaction revalidation, complete historical assessment

The ADR-014 full historical scan returns `503 mining_start_busy` with 50,000
idle profiles. A prototype filtering both admission scans improved that case
but regressed learned-history enforcement: an idle peer can match the first
caller through its learned ring while the reverse comparison is `different`.
The prototype admits both callers; a complete first assessment prevents it.
Keep the complete first assessment and optimize only transaction revalidation.
This reduces work inside transactions, not the overall O(N) admission bound.

Add optional `mining_devices.admissionPending` (integer, 0..2147483647) and
`admissionLeaseEndsAt` (date). Starts increment pending with majority write
concern before assessment and release their own reference in `finally`, after
transaction completion/abort. Pending references have no TTL: elapsed time
cannot hide a request that might still commit. Failed releases or crashes
leave extra comparisons. They do not grant a lease. Normal completion must
leave no outstanding references, checked by the load benchmark.

The existing transaction fence also publishes the maximum cycle end on every
directly correlated record it writes, not only on the resolved record. This
keeps a peer discoverable when another cycle leases its identities after the
peer's request finishes. Publication, fences, cycle and leases commit/abort
together under snapshot reads and majority writes. Monitor-only starts retain
their own window before their standalone session insertion. An early stop
does not shorten a window; retaining a stale candidate is safe.

Transaction revalidation selects the union of positive pending counts, future
cycle windows and missing legacy windows, retaining the complete assessment's
compared IDs and lease keys. Two ordinary ascending indexes serve that
exact query: `mining_devices_admission_pending` and
`mining_devices_admission_window`. Missing windows are never interpreted as
idle. The 50,000-idle probe requires at most 10 documents delivered by
transaction discovery and at most 10 documents examined by MongoDB. Its full
start is allowed to return busy and reports that result explicitly. The 2000 ms scan
budget, 200-correlated-record cap, matcher thresholds and unique lease indexes
remain. Exhaustion aborts; a partial comparison never grants mining.

Full-history initial matching, risk inputs, historical identity resolution and
quota lookups remain. The retained assessment keys prevent skipping an idle
learned peer from undoing an earlier comparison. The `HISTORY` regression and
its temporary-copy counterfactual pin this boundary. Independently forged
identities still bypass the matcher. No claim of full historical quota
discovery or physical-device authentication follows.

Bootstrap builds indexes, then initializes missing windows in batches of 200
to the latest existing active session/lease end. The deliberately global upper
bound keeps all legacy profiles visible until old work has ended. It never
resets pending counts or overwrites an already published window. A conditional
update protects concurrent new-version starts; no history is deleted.

Deployment requires draining **all older mining-start writers and their
in-flight requests before bootstrap/serving this version**. Older writers do
not publish windows, so mixed versions are unsafe. Build validators/indexes and
complete bootstrap before accepting starts. A rollback to full historical
scans may leave these fields/indexes intact. After running old writers again,
re-enabling the indexed query requires a drained maintenance migration that
extends *all* existing windows through the latest active session/lease end;
missing-only bootstrap is insufficient for previously initialized records.

Transaction-discovery cost is proportional to pending, conservatively retained
and uninitialized records. Initial assessment still scans historical enrollments;
large idle or active populations can therefore still exhaust the budget.
Cleanup of crashed references
requires draining every mining-start process and verifying no transaction can
still commit; never reset references on a timer while writers are running.
No collection, financial contract, unique/TTL index removal or external
dependency is introduced. See the [current mining report](mining-security-report.md)
for before/after evidence, larger-load measurements and remaining limitations.
