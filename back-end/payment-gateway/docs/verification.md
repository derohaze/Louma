# Node gateway verification — 2026-10-10

The gateway is a TypeScript module inside the existing backend, served by one Fastify listener. The configured deployment port is 8000. Production origin is `https://checkout.loumapay.com`. The old root `payment-gateway` directory is absent; SDKs, examples, OpenAPI and checkout assets now belong to this module.

## Executed checks

Run these commands from `back-end`. Financial tests require a local MongoDB replica set and generate separate `louma_gateway_test_*` databases, which they drop after each run. They do not use the production environment file.

```powershell
npm run typecheck
npm run build
npm test

$env:GATEWAY_TEST_MONGODB_URI='mongodb://127.0.0.1:27017/?replicaSet=rs0&directConnection=true'
$env:PAYMENT_GATEWAY_E2E_MONGO_URI=$env:GATEWAY_TEST_MONGODB_URI
$env:LOUMA_PAYMENT_COMPATIBILITY_MONGO_URI=$env:GATEWAY_TEST_MONGODB_URI
node --import tsx --test payment-gateway/tests/*.test.ts src/tests/payment-gateway.integration.test.ts src/tests/payment-gateway-financial.integration.test.ts
node payment-gateway/tests/runtime-smoke.mjs

$env:GATEWAY_TEST_REDIS_URL='redis://127.0.0.1:6379/0'
node --import tsx payment-gateway/tests/architecture-benchmark.mjs
docker compose -f docker-compose.production.yml config --quiet
```

| Check | Observed result |
| --- | --- |
| TypeScript typecheck and production build | Passed |
| Existing backend unit suite | 149 passed; no failures or skips |
| Combined gateway, financial compatibility and authenticated host suites | 37 passed; no failures or skips |
| Compiled server smoke | Readiness, shared listener, merchant authentication, checkout asset and absent internal HTTP route passed |
| JavaScript/Python SDK checks | 4 JavaScript and 3 Python tests passed; real Python HTTP/OpenAPI checks also passed inside the host suite |
| Architecture benchmark | Completed against isolated local MongoDB and local Redis |
| Redis | PONG, counters shared by two clients and separate test/live namespaces passed |
| Compose configuration | Parsed successfully |
| Credentials and source scan | Original gateway keys preserved in both env files; final scan checked 210 source/template files against 16 distinct configured secret values, no matches |
| Repository checks | `git diff --check` passed; no active backend reference to removed Go launchers or old compiled entry paths |

Financial coverage includes concurrent confirmation and refund requests, exactly one journal per operation, balanced entries and reconciliation, transaction rollback, wallet freezes, expired approvals, revoked live sessions and changed credentials. Recurring-payment coverage includes explicit consent, calendar anchors, unique invoice cycles, stale lease fencing and cancellation. Security coverage includes tenant/scope isolation, CSRF, key revocation, URL restrictions, signature tampering/time windows, hosted HTML escaping and denial of `/internal/v1/*` over HTTP.

The final benchmark used 25 iterations per query on a small local fixture: user lookup p95 1.00 ms, wallet plus balance p95 2.96 ms, idempotency lookup p95 0.49 ms and cached settings p95 0.17 ms. The cache concurrency check reported 49 hits, 11 misses and zero errors. Query plans were inspected, but several fixture queries matched no rows. These measurements are a regression check, not a gateway load test, production capacity estimate or Go-versus-Node comparison.

## Deployment limits and remaining checks

- Docker Engine was unavailable on this workstation (`dockerDesktopLinuxEngine` pipe absent). The image build, Linux runtime and container restrictions have not been exercised. The compiled Node server was exercised directly.
- The supplied production Redis hostname is internal to the deployment network and did not resolve locally. Production Redis authentication/reachability, MongoDB connectivity, DNS, TLS and the actual `TRUST_PROXY` CIDRs must be checked inside Coolify.
- Production remains `GATEWAY_LIVE_ENABLED=false`. Live creation, settlement and billing remain paused. No production financial data was modified by these tests.
- Destination validation, encryption, signing and delivery leases were tested. A successful outbound public HTTPS webhook delivery and production failure recovery were not exercised end to end.
- No browser automation, bot deployment, complete SDK language matrix or full production-load test was run for this port. See [SDK verification](sdk-verification.md).
- Independent reviewer attempts failed because of the requested model's temporary usage limit. The implementation received a primary-agent manual review; no independent review success is claimed.

## Removal and rollback

Permanent recursive deletion was rejected by the command tool policy, and Windows refused the Recycle Bin operation. The old root folder was therefore moved to `back-end/.temp/legacy-payment-gateway-go` as a reversible local rollback copy. It is excluded from Git and Docker. The active module contains no Go source, and the final build/integration/smoke checks passed after this move. No database collection, financial migration history or financial record was deleted.

Rollback uses the prior source revision and deployment image, retaining the same gateway pepper/encryption keys and MongoDB contracts. The local legacy copy is an additional source backup, not a second running service. Deployment instructions are in [Coolify deployment](coolify.md).
