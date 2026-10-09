# Louma Payments — verification evidence (2026-10-08 session)

All changes are uncommitted in the working tree. No production database was
touched. No git history operation was performed.

## What this session added (on top of the existing implementation)

- `api/openapi.yaml` (generated from `api/openapi.json` via PyYAML; 289,999 bytes)
  — the mandate requires an authoritative YAML spec alongside the JSON.
- `Dockerfile` (multi-stage Go 1.26 → alpine, separate `gateway-api` /
  `gateway-worker` / `gateway-migrate` binaries), `docker-compose.test.yml`
  (mongo replica set + redis + api + worker), `.env.example`, `docs/deployment.md`
  (safe rollout order + rollback; operator only).
- `sdk/README.md` + Node.js and Python SDKs.
- `examples/`: `node-checkout.mjs`, `python-checkout.py`, `html-backend.html`,
  `discord-bot.mjs`, `telegram-bot.py` — bots verify via `GET /v1/payments/{id}`
  (`succeeded`) and never grant on `success_url`.
- `web/checkout/page.html` + `web/web.go` (go:embed, single binary): production
  hosted checkout page in Louma identity — merchant, amount breakdown
  (subtotal/tax/total), TEST/LIVE badge, recurring-mandate terms, per-status
  messaging via `checkoutStatus`, reference + expiry, zero JavaScript, all
  merchant-controlled values escaped by `html/template`.
- `internal/transport/checkout_test.go`: render regression test — asserts exact
  amount/merchant render, XSS escaping (`<img onerror>`, `<b>` neutralized),
  and no `<script>` emission.
- `Dockerfile` pinned to `golang:1.26.6-alpine` (see govulncheck findings below).

## Pre-existing implementation (verified present, not re-built here)

- Go service: config, transport (public `/v1`, internal `/internal/v1`, hosted
  `/checkout/`, `/pay/`), gateway resources, mongodb store (settlement, checkout,
  billing, refunds, webhooks, merchants, migrations), redis limiter, worker tick
  (invoice claim/renew + delivery claim/send), `api/openapi.json` (63 paths).
- Node BFF: `back-end/src/modules/http/routes/payment-gateway.ts` + client/config,
  developer eligibility, mining settlement before live approval, TOTP reuse guard.
- Financial compat: journal `merchant_payment`/`merchant_refund` variants, reconciler
  support, merchant-compatibility unit tests, financial integration tests.
- Frontend: `DeveloperPage` (test/live switch, applications, credentials, checkouts,
  payments, links, products, prices, subscriptions, invoices, refunds, webhooks,
  deliveries, usage, docs) + `CheckoutPage` (intent-hash check, recurring consent,
  frozen/expired states, RTL/AR-EN).

## Evidence (exact commands, run 2026-10-08)

| Command (cwd) | Result |
|---|---|
| `go build ./...` (`payment-gateway/`) | pass |
| `go vet ./...` (`payment-gateway/`) | pass, no findings |
| `go test ./...` (`payment-gateway/`) | pass: `domain ok`, `security ok`, `transport ok` (incl. new checkout render/escape test), rest no test files |
| `go run golang.org/x/vuln/cmd/govulncheck@latest ./...` (local go1.26.4) | 7 reachable stdlib vulns (net/http et al., fixed in go1.26.6) + 2 in imports / 6 in required modules NOT called |
| same scan under `GOTOOLCHAIN=go1.26.6` (build+vet+test re-run green) | **No vulnerabilities found** (0 reachable; 5 uncalled in required modules) → `Dockerfile` pinned to `golang:1.26.6-alpine` |
| `gofmt -l cmd internal` | clean (no output) |
| `npm run typecheck` (`back-end/`) | pass |
| `npm test` (`back-end/`) | 145 pass / 0 fail |
| `npm run typecheck` (`frontend/`) | pass |
| `npm run build` (`frontend/`) | pass (nitro, 1.37s) |
| JS SDK import + env-mismatch guard | pass (`js-sdk-ok`, `js-env-guard-ok`) |
| Python SDK import | pass (`py-sdk-ok`) |

## Not verified in this session (honest gaps)

- `go test -race`: BLOCKED — no C compiler (`gcc` not found) in this Windows
  environment. Non-race `go test` passes; race must run in CI/container.
- Mongo replica-set integration (financial/adversarial/rollback/worker),
  REST API integration against live infra, per-language SDK matrix beyond JS/Python
  import smoke, E2E, load/failure injection: NOT RUN — no
  Mongo/Redis test infrastructure in this session. Use
  `docker compose -f docker-compose.test.yml up --build` then the suites listed in
  `docs/implementation-checklist.md`. Do not treat unit/build success as proof of
  financial correctness under concurrency.
- Dependency vuln scan: RUN (see table). Reachable findings are toolchain-only
  and fixed by the pinned `golang:1.26.6-alpine` build image; local dev machines
  must build with Go ≥ 1.26.6 (`GOTOOLCHAIN=go1.26.6` verified green).
- Remaining mandate items (perf benchmarks with honest numbers, full security
  regression, architecture benchmark) still require that infrastructure.

## Git state

Read-only inspection only. All work is uncommitted; owner reviews/commits/deploys.
