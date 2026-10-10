# Louma identity and payment BFF

The payment gateway lives in [the backend module](../../../payment-gateway/README.md) and runs in the same Fastify process on port 8000. Dashboard calls use the existing bearer session and CSRF checks, then call the private module dispatcher directly. Merchant management also requires an active MongoDB gateway_developers grant on every request.

GATEWAY_ENABLED and GATEWAY_ENVIRONMENT select the embedded module. The PAYMENT_GATEWAY_TEST_* and PAYMENT_GATEWAY_LIVE_* configuration and signed HTTP client remain a tested remote adapter for a future separate deployment; production environment files use the embedded module. Internal HTTP routes are not exposed by this host.

Checkout approval binds the current owner, session, wallet, immutable intent and recurring consent. The existing transfer-password or authenticator/recovery-code policy is verified before approval. Live checkout settles accrued mining before approval; sandbox checkout uses a simulation proof and isolated financial storage. Durable prior approvals and committed settlements are read before asking for another factor proof.

Secrets are shown only when created. Lists exclude merchant key hashes and encrypted webhook secrets. The gateway owns exact monetary calculation and atomic settlement.

Run the real host integration suite using PAYMENT_GATEWAY_E2E_MONGO_URI set to an explicit credential-free loopback replica-set URI. Each run generates its own louma_gateway_test_* database and removes it after verification. The suite covers auth/CSRF, tenant isolation, payment/refund/recurring flows, hosted checkout escaping, and actual Python SDK/OpenAPI responses.
