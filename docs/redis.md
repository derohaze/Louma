# Redis (ephemeral infrastructure — never the source of truth)

Disabled by default. Set REDIS_URL to enable. `ioredis` with fail-fast tuning:
no offline queue, 1 retry per request, per-command timeout, capped reconnect
backoff. `RedisHandle` (infrastructure/redis/client.ts) is the only construction
site; services use `cache.ts`, `rate-limit.ts`, `locks.ts` — never raw commands.

## Key namespaces (prefix `louma:` by default)

- `louma:cache:mining-settings:v1` — raw settings docs, TTL 30s. Operator
  writes invalidate eagerly; TTL bounds only a lost-invalidation race.
- `louma:cache:pool-membership:<userId>` — one account's pool room, TTL 60s.
  Join/leave invalidate eagerly. The cached copy feeds only the state/pools
  display reads: `startMining`'s pool gate reads MongoDB directly, so a stale
  room can mis-show a membership until the TTL but can never gate a start on
  it or move money.
- `louma:cache:display-name:<userId>` — preview masking only, TTL 5min.
  Cosmetic: transfers execute wallet ids, never this string. Profile update
  invalidates.
- `louma:ratelimit:<scope>:<identity>` — fixed-window counters (atomic Lua).
- `louma:lock:<name>` — advisory locks (cache-populate single-flight,
  maintenance singletons). A failed lock means duplicate harmless work.

Max value 64 KiB; keys <= 256 chars, printable, no spaces. No secrets, hashes,
tokens, or credentials are ever cached.

## Rate limits (all fail-open with in-process fallback)

| endpoint | scope | limit/min | on Redis outage |
|---|---|---|---|
| transfer preview | per account | 30 | local fallback, request proceeds |
| transfer execute | none — no distributed check | 30 route-level, per IP (in-process) | n/a — no distributed check |
| mining start | per account | 10 | local fallback, request proceeds |
| login | per IP | 10 | local fallback, request proceeds |

Fail-open is deliberate: a cache outage must not become a denial of legitimate
financial traffic. Credential verification itself is always MongoDB-backed.

Transfer execution deliberately has no distributed per-account cap: duplicate
submits are answered by the idempotency record (same key replays, never
re-executes), and credential guessing is bounded by the authorization-attempt
limit, so a per-minute cap would only refuse legitimate concurrent transfers
with a 429. Its route-level in-process cap is 30/min per IP.

## Health

`/health` = liveness. `/ready` = MongoDB ping gates traffic; Redis state,
latency, and hit/miss/error counters are reported but never gate.

## Outage behavior

Every consumer treats Redis-down as cache-miss: reads go to MongoDB,
rate checks use a bounded in-process window, locks report not-acquired.
Financial correctness is identical with and without Redis (integration suites
run in disabled mode and pass 14/14 transfer-security).
