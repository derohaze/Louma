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

```bash
cp .env.example .env.test   # fill in dev secrets
docker compose -f docker-compose.test.yml up --build
# API: http://localhost:8090/healthz  Worker: gateway-worker service
```

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

## Rollback

Stop creation/settlement/billing (or set the `GATEWAY_*_PAUSED` kill switches).
Keep compatible readers/validators and all financial data. Never drop collections
or revert to old journal validators. Correct money only with compensating
refund/reversal operations, never by editing history.

## No production migration, deployment, or git mutation is authorized from agent runs.
