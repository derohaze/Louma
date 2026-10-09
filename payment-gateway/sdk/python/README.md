# Louma Payments SDK — python

See [`../README.md`](../README.md) for the shared contract (environments, idempotency, webhook verification, no secret logging).

Against a local sandbox:

- Base URL `http://localhost:8090` and a key beginning with `lma_test_` for local development.
- Create a checkout with a fresh idempotency key, redirect the buyer, then confirm settlement with `retrieve_payment` (`status: succeeded`) — never trust `success_url` alone.
- Verify webhooks with the SDK's verify function and deduplicate by event ID.

Authoritative API: [`../../api/openapi.yaml`](../../api/openapi.yaml). Not published to any registry.

Python 3.10+; runtime uses only the standard library. For local source usage add
this directory to `PYTHONPATH`, then:

```python
import os
from louma_payments import LoumaClient, verify_webhook
client = LoumaClient(os.environ['LOUMA_API_KEY'], os.environ['LOUMA_BASE_URL'])
checkout = client.create_checkout(dict(subtotal='10.0000', tax='0.0000',
    currency='LMA', description='Order 42'), 'your-persisted-order-key')
```

Use `retrieve_payment`, `list_payments(cursor=...)`, `create_subscription`,
`cancel_subscription` and `create_refund` for the corresponding operations.
[`Verification commands and limitations`](../../docs/sdk-verification.md).
