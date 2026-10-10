# ADR-013: embed the payment gateway in Node

Status: accepted by the operator, 2026-10-10.

Replace the independent Go runtime with a cohesive TypeScript module inside `back-end/payment-gateway`, served by the existing Node process on port 8000. The operator requested one deployment for the MVP while retaining a practical extraction boundary.

Preserve the financial contracts from the existing gateway and ADR-002/006/007/008/012. MongoDB owns balances, journals, approvals, idempotency and worker leases. Redis remains ephemeral. Preserve the existing database assignments, collection names, validators, indexes and encryption. No data migration accompanies the port.

The customer BFF calls an in-process internal dispatcher after authentication and CSRF checks. `/internal/v1/*` is no longer a public HTTP interface and is omitted from the merchant OpenAPI document. Public merchant and checkout APIs retain their paths. A future standalone deployment must authenticate that internal transport explicitly; do not simply expose the dispatcher.

The host owns connection pools and lifecycle. Billing and delivery retain bounded MongoDB-backed work rather than adding queue infrastructure. A separate Node deployment remains possible without rewriting financial logic, but will need its own bootstrap and transport authentication.

Production can start with live settlement gated off so operators can verify configuration and readiness. Only explicit `GATEWAY_LIVE_ENABLED=true` removes the default financial pauses. This does not weaken ledger or authorization rules.
