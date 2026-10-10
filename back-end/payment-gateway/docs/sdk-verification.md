# SDK verification for the embedded Node gateway

Executed on 2026-10-10 from `back-end`:

```powershell
node --test payment-gateway/tests/sdk-javascript.test.mjs
python payment-gateway/tests/sdk-python.test.py
python payment-gateway/api/build-openapi.py
```

The JavaScript suite passed all four tests, including raw webhook bytes, timestamp skew, configuration validation, typed malformed-response errors and redirect rejection. The Python suite passed all three tests. The generator produced matching JSON/YAML contracts with 34 public paths and 45 operations; internal operations are private in-process calls and are not published as HTTP endpoints.

The authenticated host integration suite starts the real Node backend on a temporary loopback port and invokes `sdk-openapi.test.py` with an ephemeral merchant key file. Both Python contract cases passed without skips. They validate generated schemas and real SDK responses for checkout, payment retrieval/listing, products, recurring prices, consent checkout, payment links, expiry and resource lists. The enclosing suite removes its temporary key file and isolated database.

To reproduce that live HTTP check:

```powershell
$env:PAYMENT_GATEWAY_E2E_MONGO_URI='mongodb://127.0.0.1:27017/?replicaSet=rs0&directConnection=true'
node --import tsx --test src/tests/payment-gateway.integration.test.ts
```

Python needs PyYAML and jsonschema for the OpenAPI test; the Python SDK itself uses the standard library. Running `sdk-openapi.test.py` alone without the fixture deliberately skips its live HTTP case, so that standalone result is not evidence of live compatibility.

The copied TypeScript, HTML, management and full matrix fixtures remain available but were not all executed for this port. Discord/Telegram examples were not deployed and require their own bot credentials and setup. Neither SDK was published to a package registry. Browser-based hosted checkout behavior and a successful external webhook delivery remain separate deployment checks.
