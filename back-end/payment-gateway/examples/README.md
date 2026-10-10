# Local merchant integrations

Keep merchant API keys on your backend. The examples use an isolated test gateway;
register any `success_url`/`cancel_url` domain on your merchant application first.
Run from the repository root in PowerShell:

```powershell
$env:LOUMA_API_KEY = 'your-test-key' # use a local secret store in applications
$env:LOUMA_BASE_URL = 'http://127.0.0.1:8000'
node payment-gateway/examples/node-checkout.mjs
python payment-gateway/examples/python-checkout.py
node payment-gateway/examples/html-backend.mjs
```

For the HTML example, open `http://127.0.0.1:8098/`. The backend creates a checkout
and redirects to the gateway. Its status page reads the authoritative payment.
The order token is bound to an HttpOnly cookie and a CSRF form token. Restarting
the demo clears its in-memory orders; a production merchant must persist the order,
its authenticated owner, stable idempotency key and fulfillment decision.

Discord requires `discord.js`, bot credentials, a guild premium role and registered
`/buy` and `/claim payment` commands. Telegram requires `httpx`, bot credentials
and a dispatcher invoking `do_buy`/`do_claim`. Those files are handler sketches;
external bot login and delivery have not been exercised in this workspace.

Only fulfill after `retrievePayment`/`retrieve_payment` reports `succeeded`.
For webhooks, verify the untouched request body before JSON decoding, durably
deduplicate the event ID and retrieve the authoritative payment before fulfillment.
Do not fulfill based on a browser redirect or a webhook event name alone.
