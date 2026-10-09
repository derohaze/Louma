# Louma Payments compatibility and threat model

Requested: independent Go payment API/worker, hosted checkout, merchant recurring billing,
refunds, outbox webhooks, existing dashboard integration, Node.js and Python SDKs, and real verification.
Security and performance risk are both high. Existing transfers, mining, Pro, wallet identity,
ledger accounting and authorization remain owned by their current services.

## Verified contracts and decisions

`docs/adr.md`, `financial-invariants.md`, `database.md`, `redis.md`, and the implementations
in `back-end/src/infrastructure/mongodb` are the shared financial contract. Wallet ownership
is `wallets.ownerUserId`; money is `ledger_accounts.balanceMinor`. UUID string references
are independent of Mongo ObjectIds. Money has four decimals and a movement ceiling of
9007199254740000 minor units, with a projection ceiling of 9007199254740991. Go writes
int64 money and int32 wallet guards/line numbers. Credits and debits use conditional updates.

Go owns merchant payments/refunds, Node owns internal transfers/mining. Extend the journal
additively with merchant_payment/merchant_refund; never disguise a merchant payment as a
transfer. Fees use separately versioned basis-point configuration, snapshotted in the intent.
Refund fees are non-refundable: a merchant funds the entire refunded buyer amount, fees stay
in revenue. Failed refunds remain pending and retry with the original operation identity.

Each gateway process serves one environment. Test and live use different database names,
credential peppers, service authentication keys and URLs, except for the explicitly confirmed
local Atlas sandbox documented in ADR-011. A test credential cannot select a live database.
Production live startup requires an explicit enable switch and compatibility
schema marker. Migrations are operator commands and are never run during API startup.

Node authenticates the existing session, resolves the actual primary wallet, settles mining
before authorization, proves the existing OR credential policy and sends a short-lived
intent-bound proof to Go over authenticated internal TLS. Go consumes proof/approval in the
same transaction as settlement. Existing TOTP purpose transfer is reused to forbid one code
authorizing both an internal transfer and a merchant debit. Credential replacements and
freezes conflict through wallet financialVersion. Customer consent travels through Node's
existing CSRF-protected origin; no cross-origin browser token or merchant key authorizes debit.

Receiving-wallet ownership, application suspension, credential revocation, subscription and
mandate state are rechecked through conflicting writes inside settlement. Payer session/user
state is checked for initial checkout. A recurring mandate narrowly permits the fixed price,
wallet and interval, with cancellation serialized against billing on the same document.

Mongo transactions are snapshot-read, majority-write with bounded driver/context retries.
Idempotency and unique invoice-cycle identity live in Mongo. Unknown outcomes return retryable
errors; the durable payment record decides replay. Network requests never run in a transaction.
Transactional events have bounded delivery leases and at-least-once webhook delivery.
HTTPS destinations are resolved and checked at connection time; redirects and private IPs fail.
Webhook secrets are encrypted with AES-GCM, while API keys store HMAC verification material only.

## Trust boundaries and gates

Actors: anonymous checkout viewer, authenticated payer, eligible developer, scoped merchant
credential, Node service identity, worker and operator. Assets: balances/journal, mandates,
keys, session identity and tenant data. User-supplied amounts, IDs, URLs and JSON are untrusted.
Every resource query derives the owning application from authentication. Explicit allowlisted
fields prevent mass assignment. Bounded bodies, pagination, deadlines and shared rate control
limit resource exhaustion. Logs contain correlation IDs/status and no proofs, keys or payloads.

Release gates: balanced real Mongo journals/projections, rollback, concurrent spend/replay,
freeze/revoke/cancel races, original refund caps, Node reconciliation, real HTTP/SDK contracts,
Node typecheck/unit/architecture benchmark, frontend build/E2E, race detector and scanners.
Unavailable checks must be reported as unverified, never replaced by mock success.

## Safe rollout and rollback

Upgrade and drain ALL old Node schema writers first: old startup collMod can revert the journal
validator. Run additive Node schema/index installation, then explicit gateway migration on the
isolated staging database. Verify marker/indexes and reconcile before enabling live Go writes.
Do not permit pre-compatibility Node binaries alongside live gateway writers. Rollback stops
creation/settlement/billing and keeps compatible readers/validators and financial data; do not
drop collections or revert to old journal validators. Financial correction uses compensation.
No production migration, deployment or Git mutation is authorized in this work.
