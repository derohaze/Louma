# Performance

Runner: `src/tests/architecture-benchmark.ts`
(`node --env-file=/tmp/louma-direct.env --import tsx src/tests/architecture-benchmark.ts`).
25 iterations per query; reports p50/p95/p99 plus full winning-plan explains.

## Baseline (MongoDB-only, Atlas from the dev machine — link RTT dominates)

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

## Explain plans (all IXSCAN, bounded examines)

- history: LIMIT > FETCH > IXSCAN(transactions_participants_history)
- idempotency: FETCH > IXSCAN(transactions_idempotency_unique)
- mining header: FETCH > IXSCAN(transactions_mining_session_sequence_unique)
- entries: FETCH > IXSCAN(ledger_entries_account_history)
- active cycle (production shape): LIMIT > FETCH > IXSCAN(mining_sessions_one_active_per_user)
- approvals: FETCH > IXSCAN(transfer_authorizations_owner_history)

Note: the first benchmark revision printed a COLLSCAN for an unscoped
`{miningSessionId, sequenceNumber}` probe — a query no production path runs.
Scoped to `type: "mining"` it uses the partial unique index (verified above).

## Concurrency correctness (measured, not just timed)

- transfer-security suite 14/14: concurrent same-wallet bursts keep the ledger
  exact, no negative balances, no double debit/credit, idempotent replays.
- mining concurrent-settlement test: contiguous unique sequences, wallet holds
  exactly the credited total, never more than the true accrual.
