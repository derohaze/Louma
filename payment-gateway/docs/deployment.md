# Louma Payments — deployment & rollout runbook (operator only)

One gateway process serves exactly one environment (`test` or `live`).
Test and live never share a Mongo database, credential pepper, service key, or URL.

## Prerequisites

- MongoDB replica set (transactions required; standalone is not enough).
- Redis (rate limiting only; never authoritative for balances).
- TLS termination in front of the API when the dashboard/checkout origin differs.
- Distinct secrets per environment: `GATEWAY_SERVICE_KEY`, `GATEWAY_API_KEY_PEPPER`
  (both 32+ chars, different from each other), `GATEWAY_ENCRYPTION_KEY`
  (32 random bytes as 64 hex chars).

## Local sandbox

Copy `.env.example` to `.env.development` and fill the secrets. The local working
copy already has a filled `.env.development`; it is ignored by Git. The runner
uses the development Node MongoDB connection and checks that the service keys
match. Both development processes now use `louma_gateway_test_dev` (ADR-012).
Restart previously running development processes after changing their env files.
Existing `louma` accounts/data stay in `louma`; a new development database starts
empty. Start the Node backend once to install its compatible schema, then run:

```powershell
./run-local.ps1 dev migrate
./run-local.ps1 dev api
# In a second terminal:
./run-local.ps1 dev worker
```

The legacy `docker-compose.test.yml` is an isolated infrastructure harness, not
production deployment. Its `.env.test` must use database `louma_gateway_test*`,
Mongo host `mongo`, Redis host `redis`, and separately generated test secrets.
Start its database services, install the compatible Node schema in that sandbox,
and explicitly run the `migrate` Docker target before starting API and worker.
Never copy its `enableTestCommands` Mongo flag to production.

## Coolify production

Use the repository's **Docker Compose** build pack so the API, worker and private
Redis deploy together. Set **Base Directory** to `/payment-gateway` and
**Docker Compose Location** to `/docker-compose.production.yml`. The build context
is `payment-gateway/`; selecting the repository root as the Dockerfile context
will not find `go.mod`.

Assign `https://checkout.loumapay.com:8090` to service **api** in Coolify's domain
field. The `:8090` selects the container's target port; clients use
`https://checkout.loumapay.com` on HTTPS port 443. Point the domain's DNS to the
Coolify host, enable TLS/HTTPS redirect, and keep host port 8090 unpublished.
Do not give `worker`, `migrate`, or `gateway-redis` a public domain/host port.

Paste the filled **local** `.env.production` into Coolify's environment editor.
It is intentionally ignored by Git and Docker; `.env.production.example` is the
shareable template. Keep all credentials as runtime variables, never build args.
Compose lists every application variable explicitly so it does not depend on an
untracked env file existing in a fresh Git checkout. Save a private backup of the
pepper and encryption key: replacing them breaks existing API-key lookup and
encrypted webhook secrets. API, worker and migration must use the same keys.

The filled local production file uses the operator-confirmed MongoDB connection
and database `louma`. Use a database-scoped production credential on the server;
the supplied account's database permissions have not been verified. Require Atlas
TLS, restrict its network access to deployment hosts, and verify backups. Keep
development credentials scoped to the development database when provisioning
database users. No production data or account permissions are changed here.

Two deployment-specific gates intentionally remain:

1. Set `GATEWAY_TRUSTED_PROXY_CIDRS` to the **actual** Coolify proxy IP (`/32` or
   `/128`) or a restricted network containing only trusted proxies. Inspect it on
   the host with `docker network inspect <proxy-network>`; never copy a guessed
   subnet or trust `0.0.0.0/0`. Forwarded IPs are walked right-to-left. Direct
   requests cannot select their own rate-limit bucket. If an additional CDN sits
   in front, configure its trust boundary separately before trusting its headers.
2. `GATEWAY_LIVE_ENABLED=false` is a deliberate startup block until the rollout
   below is complete. Set it to `true` after backup/schema/migration/reconciliation
   checks. A successful build alone does not enable money movement.

Redis is bundled with authentication, no published port, no persistence, a 128 MiB
counter budget and `noeviction`. `GATEWAY_REDIS_URL` contains the full authenticated
URL for `gateway-redis`; its password matches `GATEWAY_REDIS_PASSWORD`. A Redis
failure or full counter store refuses gateway requests, and readiness reports
failure; it never changes financial balances. Restarting Redis resets throttling
counters, not payment state. Keep system DNS in containers so that service names
resolve; `GATEWAY_DNS_SERVERS` is empty in production.

The API and worker run as UID/GID 10001, with read-only filesystems, no Linux
capabilities, no privilege escalation, bounded logs, and a 30-second stop grace
period. Each starts with one CPU, 512 MiB container memory and `GOMEMLIMIT=384MiB`.
These are starting budgets, not a throughput promise. Go's heap limit leaves room
for non-heap memory. Keep it below the container limit when tuning from measured
load. Existing bounds remain: 128 inflight HTTP requests, 64 Mongo connections
per process, 16 Redis connections, 64 KiB bodies, and 12-second request contexts.

The image's API health check uses `/readyz`, which checks MongoDB's compatible
financial schema and Redis. `/healthz` is liveness only. Configure Coolify's HTTP
health check as `GET /readyz`, port `8090`, interval 30 seconds, timeout 10 seconds,
start period 30 seconds. The worker has no HTTP port: monitor its process/restarts,
`worker_tick_failed` logs, pending invoices and webhook delivery age. Do not give
the worker the API health check.

### Connect the customer backend (fixes the unconfigured dashboard)

The local `back-end/.env.production` now contains this matching pair. Add both to
the **Node backend's** Coolify runtime environment, then redeploy that backend:

```dotenv
PAYMENT_GATEWAY_LIVE_URL=https://checkout.loumapay.com
PAYMENT_GATEWAY_LIVE_SERVICE_KEY=<same value as GATEWAY_SERVICE_KEY>
```

These are server-only variables. Do not put them in Vite/frontend env or expose
them to the browser. The production dashboard selects live mode when that pair
is configured. Keep any optional sandbox connection on a distinct URL, key and
database. No frontend code change is required.

## Safe rollout order (staging first, then live)

1. Upgrade and drain ALL old Node schema writers (old startup `collMod` can
   revert the journal validator).
2. Run additive Node schema/index installation.
3. Run the gateway migration explicitly against the isolated target database:
   `gateway-migrate -confirm-database <exact-db> [-backup-confirmed]` (live
   additionally requires backup confirmation). Migrations never run at API startup.
4. Verify the schema marker/indexes and run reconciliation before enabling writes.
5. Start the API (`gateway-api`) and worker (`gateway-worker`) as separate processes.
6. Enable live only with `GATEWAY_ENVIRONMENT=live` + `GATEWAY_LIVE_ENABLED=true`
   after the compatibility marker is verified.

From `payment-gateway/` on the deployment host, after backup and Node schema
installation, the migration command is:

```bash
docker compose --env-file .env.production -f docker-compose.production.yml --profile tools run --build --rm -e GATEWAY_LIVE_ENABLED=true migrate -confirm-database louma -backup-confirmed
```

The override enables only that explicit migration process. Keep the API/worker
off until reconciliation succeeds. In Coolify, run the equivalent one-off
`migrate` target with the same runtime secrets; do not make it a startup hook.
The production env file must exist only when using the shell command above.

After enabling live, verify `https://checkout.loumapay.com/readyz` returns 200,
the backend's developer page opens without the configuration error, an authorized
controlled checkout settles exactly once on replay, balances reconcile, and the
worker delivers its signed webhook. Validate redirects to `https://app.loumapay.com`
and absence of credentials in responses/logs. Perform these live checks only with
the operator's controlled accounts and approved amount.

For a Dockerfile-only Coolify setup, use the same base directory and `Dockerfile`:
default/final target is `api`. Create a second resource with target `worker` and
provide an authenticated Redis instance. Target `migrate` is one-off only. A
single API resource alone does not run billing or webhook delivery.

## Rollback

Stop creation/settlement/billing (or set the `GATEWAY_*_PAUSED` kill switches).
Keep compatible readers/validators and all financial data. Never drop collections
or revert to old journal validators. Correct money only with compensating
refund/reversal operations, never by editing history.

Roll back the application images/config independently; retain compatible Node
schema and all ledger records. Restore a previous pepper/encryption key only from
the secure backup appropriate to those records. Never point test mode at `louma`.
