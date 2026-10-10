# Embedded Node payment gateway implementation plan

Goal: replace the Go service with a TypeScript module in `back-end/payment-gateway`, served by the existing Fastify process on port 8000.

Architecture: domain types and financial rules remain independent of HTTP. MongoDB repositories own durable state and transactions. Transport calls services through an explicit module boundary; worker lifecycle belongs to the host process. Public APIs, MongoDB collection contracts, encryption, and journal semantics are preserved.

Risk: security and correctness high; performance high. The root problem is operating two runtimes for one MVP; an embedded module removes that deployment boundary without removing financial boundaries.

Constraints: no production data mutation during development; MongoDB remains authoritative; preserve unique indexes and financial validators; no network calls in transactions; bounded work and retries. Keep all new files inside backend. Existing Go sources are the compatibility reference until verification completes.

1. Port domain, MongoDB migration, merchants, checkout, settlement and refunds. Verify exact integer money, atomic double-entry, durable idempotency, authorization invalidation, duplicate and concurrent requests against an isolated local replica set.
2. Port catalog, subscriptions, billing and webhook delivery. Verify calendar anchors, invoice fencing, cancellations, retry limits, encryption compatibility and SSRF protections.
3. Port Fastify transport and request validation. Verify scopes, tenant isolation, internal authentication/replay and hosted checkout/public SDK contracts.
4. Integrate the module directly with the existing authenticated backend routes. Consolidate env/Docker/Coolify files inside backend and preserve existing secret values. Run on port 8000, public origin https://checkout.loumapay.com.
5. Run typecheck, unit and integration suites, SDK contract checks, build and architecture benchmark. Request independent code review and fix findings. Record evidence and deployment limitations.
6. Preserve SDKs, OpenAPI, checkout assets and useful verification fixtures inside the module; remove the root Go folder only after replacement verification.

Rollback: restore the prior Git revision and previous deployment image; documents/indexes and encryption remain compatible. Keep live settlement disabled until deployment dependency checks and financial controls are verified. No data migration or deletion is included.

Completion record, 2026-10-10: implementation and host integration completed. Typecheck, build, 149 backend unit tests, 37 combined gateway/financial/host tests, SDK checks, the architecture benchmark, Compose validation and compiled-server smoke passed. The old root folder is absent; its reversible local backup is ignored under `back-end/.temp/legacy-payment-gateway-go` because permanent deletion was denied by tool policy and the Recycle Bin was unavailable. Independent reviewer attempts were rate-limited; manual review completed. Docker image execution, production network checks, external webhook delivery and load capacity remain unverified. See [verification](verification.md) for commands and evidence.
