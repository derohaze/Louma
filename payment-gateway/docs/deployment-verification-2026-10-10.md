# Deployment verification — 2026-10-10

Scope: Docker/Coolify packaging, development/production environment separation,
Node gateway configuration, proxy rate-limit identity, and production startup
validation. Security risk: high (payment deployment); performance risk: medium
(proxy identity and resource budgets). Financial transaction code, collection
contracts, uniqueness constraints, fees and idempotency were preserved.

## Problem and changes

The old image listened on loopback by default, had no container health check or
build-context secret exclusion, and the production Node gateway connection was
unset. Behind a reverse proxy, all callers shared its IP rate-limit bucket. The
previous Go image also had newly disclosed reachable standard-library advisories.

- Dockerfile: cached multi-stage builds, pinned Go 1.26.9 and image digests, CA
  certificates, unprivileged runtime, separate API/worker/migration targets,
  container-wide bind address and readiness health check.
- `.dockerignore`: allow only production source, excluding local secrets,
  temporary binaries and tests from build context.
- Production Compose: API, worker and authenticated private Redis, explicit
  runtime variables, bounded resources/logs and process privileges. Migration
  remains an explicit one-off operation.
- Env templates and ignored local files: all runtime variables; new independent
  live secrets; matching Node service keys; live `louma` and development
  `louma_gateway_test_dev`. ADR-012 records the operator's production designation.
- Config/proxy code and tests: reject invalid startup settings, known placeholder
  secrets, live sandbox databases and test use of `louma`; require Redis in live;
  trust forwarded IPs only from configured proxy CIDRs.
- Local runner and deployment runbook: use `.env.development`, document the full
  Coolify/backend/backup/migration/reconciliation/rollback sequence.

A single API container would omit billing/webhook processing. Raising the shared
proxy rate limit would not preserve per-client throttling. Trusting arbitrary
forwarded headers would allow bypass. Those alternatives were rejected.

## Executed checks

All Go checks below used `GOTOOLCHAIN=go1.26.9` unless noted otherwise.

| Check | Result |
| --- | --- |
| `go test ./... -count=1` | Pass |
| `go vet ./...` and `go build ./...` | Pass |
| `CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -buildvcs=false -ldflags='-s -w'` for all three commands | Pass |
| `go run golang.org/x/vuln/cmd/govulncheck@latest ./...` | 0 reachable vulnerabilities; 5 advisories remain in required modules on paths not called by this code |
| Same scanner before the upgrade, Go 1.26.6 | 11 reachable standard-library advisories; fixes motivated the toolchain upgrade |
| `npm run typecheck` and `npm test` in `back-end/` | Pass; 149 unit tests |
| Production and test `docker compose ... config --quiet` | Pass; production validation supplied an isolated test proxy CIDR only to the check process |
| Production Compose with the real missing proxy CIDR | Correctly refuses configuration |
| PowerShell parser for `run-local.ps1` | Pass |
| Real local env completeness, Node config load, key/database pairing and separation | Pass; values not printed |
| Go config load using both real env files | Pass; live opt-in overridden only for validation; deliberately mismatched migration confirmation stops before database access |
| Git ignore and local-secret scan of changed files | Pass |

The new configuration cases failed against the old loader. The HTTP regression
also reproduced the proxy bug: the second client received 429 after the first
used its allowance. After the fix, separate clients through a trusted proxy get
independent buckets, and changing headers through an untrusted peer cannot evade
the limit. Tests also cover spoofed leftmost headers, multiple hops, IPv6,
malformed/missing headers and oversized forwarding chains.

## Financial and architecture checks

Ran this command against the existing **loopback** replica set; fixtures created
and removed their own generated `louma_gateway_test_*` databases:

```powershell
$env:GATEWAY_TEST_MONGODB_URI='mongodb://127.0.0.1:27017/?replicaSet=rs0&directConnection=true'
go test -tags integration ./internal/infrastructure/mongodb -run 'TestArchitectureBenchmarkOnIsolatedFinancialFixture|TestSettlementCoexistsWithRealNodeTransfersAndMining' -count=1 -v
```

Both passed, including ledger reconciliation. The architecture benchmark invoked
the existing Node benchmark after real fixture transfers and mining. Its eight
query scenarios had local p95 latencies of 1.42–5.08 ms over 25 iterations each.
These synthetic, small-data measurements are not production latency estimates or
evidence of a speedup. The Redis section reported `hits=0 misses=0 errors=2`; its
fallback execution does **not** verify Redis cache-hit performance.

## Remaining deployment verification

- Docker Desktop's Linux engine was unavailable even after attempting startup.
  Compose parsing and Linux compilation passed, but image builds, container
  startup/health/permissions, the bundled Redis and image OS vulnerability scans
  remain unverified. The stalled Docker startup command was stopped.
- `go test -race ./internal/config ./internal/transport` could not run because
  CGO is disabled and no C compiler is installed. Run it in Linux CI.
- The actual Coolify proxy network, DNS/TLS, production readiness, backup,
  database-user permissions, migration and live checkout/webhook smoke test
  require the deployment host. No production database operation was performed.
- `GATEWAY_TRUSTED_PROXY_CIDRS` remains unset rather than guessing a trusted
  network. `GATEWAY_LIVE_ENABLED=false` remains a deliberate startup gate until
  the documented rollout checks pass. The new development database is not seeded.

Rollback: pause creation/settlement/billing, restore the prior application image
and matching runtime configuration, retain the compatible Node validators and
all financial records. Keep encryption keys/pepper backed up; do not regenerate
them during redeployment. Never use old test settings against production `louma`.
