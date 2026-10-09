# Louma Payments SDK — Node.js

See [`../README.md`](../README.md) for the shared contract (environments, idempotency, webhook verification, no secret logging).

Against a local sandbox:

- Base URL `http://localhost:8090` and a key beginning with `lma_test_` for local development.
- Create a checkout with a fresh idempotency key, redirect the buyer, then confirm settlement with `retrievePayment` (`status: succeeded`) — never trust `success_url` alone.
- Verify webhooks with the SDK's verify function and deduplicate by event ID.

Authoritative API: [`../../api/openapi.yaml`](../../api/openapi.yaml). Not published to any registry.

Node 20+; no dependencies. Import locally:

```js
import { LoumaClient, verifyWebhook } from './index.js';
const client = new LoumaClient({ apiKey: process.env.LOUMA_API_KEY,
  baseURL: process.env.LOUMA_BASE_URL });
const checkout = await client.createCheckout({subtotal:'10.0000',tax:'0.0000',
  currency:'LMA',description:'Order 42'}, 'your-persisted-order-key');
```

TypeScript uses the same client plus `index.d.ts`. The package remains private;
an application can use a local `file:` dependency. Read
[`../../docs/sdk-verification.md`](../../docs/sdk-verification.md) for the separate
Node.js API tests, TypeScript declaration checks, and current results.
