# Performance

Runner: `src/tests/architecture-benchmark.ts`
(`node --env-file=/tmp/louma-direct.env --import tsx src/tests/architecture-benchmark.ts`).
25 iterations per query; reports p50/p95/p99 plus full winning-plan explains.

## Existing baseline (before the wallet identity refactor)

The timing sample below is retained for historical comparison. It predates
primary-wallet lookup and wallet-scoped idempotency, so it is not a measurement
of the new query shapes. Re-run this benchmark against the target deployment
before drawing latency conclusions.

| read | p50 | p95 | p99 |
|---|---|---|---|
| user by publicId | 215ms | 243ms | 245ms |
| wallet by owner | 210ms | 238ms | 257ms |
| balance (wallet+ledger, 2 reads) | 432ms | 472ms | 476ms |
| transfer history page | 209ms | 247ms | 259ms |
| mining state (settings+cycle+membership) | 644ms | 715ms | 716ms |
| security history page | 228ms | 261ms | 277ms |
| notifications page+unread | 452ms | 486ms | 489ms |
| idempotency lookup | 224ms | 265ms | 272ms |
| mining settings (uncached) | 202ms | 242ms | 251ms |

Cache-hit mode was not measurable here (no Redis server in this environment);
the code path is covered by construction (readThrough + counters) and the
MongoDB-only baseline above is the worst case. Re-run with REDIS_URL to fill
the hit/miss columns before claiming any caching speedup.

## Explain plans

The last successful database run before this refactor reported:

- history: LIMIT > FETCH > IXSCAN(transactions_participants_history)
- mining header: FETCH > IXSCAN(transactions_mining_session_sequence_unique)
- entries: FETCH > IXSCAN(ledger_entries_account_history)
- active cycle (production shape): LIMIT > FETCH > IXSCAN(mining_sessions_one_active_per_user)
- approvals: FETCH > IXSCAN(transfer_authorizations_owner_history)

The wallet refactor adds three plan checks to the benchmark. Expected winning
indexes are `wallets_owner_primary_unique` for `{ ownerUserId, isPrimary: true }`,
`wallets_address_unique` for `{ addressNormalized }`, and
`transactions_sender_wallet_idempotency_unique` for `{ type: "transfer",
senderWalletId, idempotencyKey }`. The in-repo benchmark was updated for these
queries; this environment could not run it because no local MongoDB service was
available, so the post-refactor plans and timings remain unmeasured here.

Note: the first benchmark revision printed a COLLSCAN for an unscoped
`{miningSessionId, sequenceNumber}` probe — a query no production path runs.
Scoped to `type: "mining"` it uses the partial unique index (verified above).

## Concurrency correctness (measured, not just timed)

- transfer-security suite 14/14: concurrent same-wallet bursts keep the ledger
  exact, no negative balances, no double debit/credit, idempotent replays.
- mining concurrent-settlement test: contiguous unique sequences, wallet holds
  exactly the credited total, never more than the true accrual.
