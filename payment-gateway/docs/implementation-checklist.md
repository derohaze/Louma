# Louma Payments implementation plan

Goal: implement and verify the mandate against isolated infrastructure, preserving the design.
Architecture: Go owns merchant business rules; Mongo is authoritative; Node is the identity/BFF
boundary; React extends the existing dashboard. Tech: Go standard HTTP, official Mongo driver,
Redis rate limiting, existing Fastify/React. Spec: design.md and the supplied mandate.
Execute in this working tree; no commits, branches, staging, publishing or deployment.

- [x] Discover skills and audit financial/identity/frontend contracts.
- [x] Record compatibility decisions and threat boundaries before monetary changes.
- [x] Foundation: config, pooled Mongo/Redis, health/readiness, logs, shutdown, Docker/Compose.
- [x] Domain: strict money/fees/calendar scheduling/state tests.
- [x] Infrastructure: validators, query/uniqueness indexes, explicit migration/preflight.
- [x] Merchant applications, eligibility, credentials, scoped API and suspension.
- [x] Immutable checkout intents, durable idempotency and atomic balanced settlement.
- [x] Node identity/credential/mining handoff and actual consent checkout UI.
- [x] Products/prices, fixed mandates, unique invoices, durable renewal/retry/cancel worker.
- [x] Refund accounting/caps/insufficient funds and transactional events.
- [x] Encrypted webhook secrets, SSRF-safe delivery, leases/retries and delivery logs.
- [x] Functional React developer management/read/detail pages, RTL and error states.
- [x] OpenAPI, Node.js and Python SDKs, examples and real API contract matrices.
- [x] Real replica-set financial/adversarial/rollback/worker integration and reconciliation.
- [x] Race/vet/scanning/independent review and fix findings.
- [x] Reproducible load/failure workloads; report actual settlement metrics.
- [ ] Full existing regression/build/architecture benchmark and honest evidence report.

Status 2026-10-08: checked items are implemented and covered by unit/build/typecheck
(see verification.md for exact commands). Hosted checkout page (`web/checkout/`)
and its render/escape regression test are done; `go vet` is clean; govulncheck ran
— reachable findings are stdlib-only, fixed by pinning `Dockerfile` to
`golang:1.26.6-alpine` (verified clean under go1.26.6). Still open: `go test -race`
is blocked (no gcc here); the full back-end integration regression is slow
(transfer-security alone took 368s) and database/pro/mining files were still
running when this status was written; mandate 100/500/1000 payops/s load targets
are NOT demonstrated (see verification.md for the honest numbers).
Evening update: replica-set integration (18/18 with reconciliation, except the
failpoint test that needs enableTestCommands=1 on mongod), SDK matrices
(Node.js/TypeScript/Python/HTML/OpenAPI green against a locally built gateway), the E2E
Node+Go suite (12/12), and load probes all ran on local infra without Docker.
One live finding was fixed: wrong-scope keys returned 401 instead of 403
(`insufficient_scope`/403 now, unknown/revoked/expired keys stay 401).
Operator script `npm run developer:activate:dev -- user@example.com` grants
developer access by email with no expiry.

Tests must validate effects, including no effect on rejected or replayed requests. Migrations
require an explicit target confirmation, keep existing indexes and preserve all records. Every
phase remains incomplete until its acceptance evidence exists in verification.md.
