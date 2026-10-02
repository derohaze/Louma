# Louma backend architecture

Financial backend: Fastify + MongoDB (source of truth) + Redis (ephemeral only).

## Layering

```
HTTP routes (modules/http/routes/*)
  -> services / use-cases (modules/transfers, modules/mining, modules/auth, ...)
  -> infrastructure (infrastructure/mongodb/*, infrastructure/redis/*)
  -> MongoDB / Redis
```

Business logic never touches Redis key syntax, raw Redis commands, collection names,
or index names. MongoDB specifics live in `infrastructure/mongodb`
(collections, repositories, definitions, schemas, validators, backfills).
Redis specifics live in `infrastructure/redis` (client, cache, rate-limit, locks).

## Money flow

Every money movement is a balanced journal write: one `transactions` header plus
`ledger_entries` lines, inserted together inside one MongoDB transaction through
`postBalancedJournal` (infrastructure/mongodb/repositories.ts). Balance projections
on `ledger_accounts` are updated in the same transaction with conditional updates
(sufficient-funds debit, ceiling-checked credit). Entries are authoritative;
projections are a convenience the reconciler verifies (`reconcileLedger`).

## Journal union

`transactions` holds two disjoint shapes discriminated by `type`:
`transfer` (sender/receiver/idempotency triple) and `mining` (cycle/sequence/treasury
triple). Transfer reads always filter `type: "transfer"` so issuance never leaks
into customer history. See ADR-003.

## Concurrency model

MongoDB enforces correctness, not Redis, not process memory:
unique indexes (idempotency, one-active-cycle, one-approval-one-spend,
one-step-one-operation), conditional updates, compare-and-set settlement,
short snapshot transactions with bounded retries and idempotent replay.

## Redis role

Cache-aside reads, distributed rate limits, advisory locks. Disabled by default
(REDIS_URL unset) and every consumer degrades to MongoDB/local state.
A Redis outage costs performance, never correctness. See redis.md and ADR-002.
