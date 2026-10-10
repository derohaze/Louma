# Payment gateway

The TypeScript gateway runs inside the customer Fastify process on port **8000**. Its public origin is **https://checkout.loumapay.com**. Customer authorization stays in the existing authenticated `/api/v1/payments/*` routes; merchant SDKs use `/v1/*`. Hosted payment pages use `/checkout/:id` and `/pay/:id`.

`domain/` contains money and public document contracts. `infrastructure/` owns MongoDB transactions, resource persistence and the shared Redis limiter. `service.ts` validates and orchestrates merchant requests. `transport.ts` exposes public routes and the private `gatewayInternalRequest` function. `worker.ts` runs bounded, non-overlapping billing and delivery ticks and drains during shutdown.

The host passes its existing MongoDB client and Redis handle. There is no loopback HTTP call, Go process, second public port, new database engine or external queue. Extracting a separate Node service later requires a bootstrap, authenticated transport for internal calls, and dedicated deployment; financial services and document contracts remain reusable. The Redis adapter is the one small host-specific infrastructure dependency.

MongoDB remains authoritative. Settlement and refunds update balances, balanced journal entries, durable idempotency records and outbox events in one snapshot/majority transaction. Transactions have an eight-second budget and at most three callback attempts. Monetary calculations use integer arithmetic; gateway money writes explicitly preserve BSON int64. Credential changes, wallet freezes and merchant revocation conflict with the financial guards. Unknown transaction outcomes are resolved by durable reads.

Webhook secrets retain the previous AES-256-GCM format and encryption key. Delivery is at least once, with MongoDB leases/fences, eight attempts and a 48-hour retry horizon. HTTPS destinations are resolved and checked before pinning the socket; private/reserved addresses and redirects are blocked. Merchant keys and signing secrets never enter Redis. Redis holds ephemeral throttling counters and uses separate test/live namespaces; configured Redis failures reject gateway requests.

See [Coolify deployment](docs/coolify.md), [verification](docs/verification.md), [architecture decision](docs/adr-013-node-module.md), [OpenAPI](api/openapi.yaml), and [SDK usage](sdk/README.md).
