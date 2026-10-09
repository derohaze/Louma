# SDK execution evidence — 2026-10-08

The supported merchant clients are Node.js and Python. Real HTTP matrices are
separate from offline parsing, configuration and HMAC checks. Matrix credentials
must belong to isolated synthetic merchants in a local test database. The scripts
read an API key from an ignored local file and never print it.

| SDK | Installed runtime/compiler | Offline verification | Real API matrix |
|---|---|---|---|
| Node.js | Node v24.17.0; tsc 5.9.3 for declarations | 4 tests passed; public declarations compile | Pending local fixture |
| Python | Python 3.14.6 | 3 tests passed | Pending local fixture |

No runtime or package was installed or published. A successful import does not
mean the complete client contract has passed.

The matrices cover checkout creation, exact money output, payment retrieval,
same-key replay, different-intent rejection, malformed amounts, missing
resources, wrong keys, environment and insecure URL guards, catalog and
subscription consent, pagination, and checkout expiration. Offline HMAC checks
cover raw UTF-8 bytes, timestamp boundaries, expired and future timestamps,
tampered bodies, incorrect secrets, and malformed headers. These checks do not
prove recurring renewal, payer consent, refund settlement, webhook delivery or
order fulfillment; those require the gateway integration suites.

Commands from the repository root (PowerShell):

```powershell
node --test payment-gateway/tests/sdk-javascript.test.mjs
node --test payment-gateway/tests/sdk-management.mjs
python payment-gateway/tests/sdk-python.test.py
node frontend/node_modules/typescript/bin/tsc --noEmit --allowJs --target ES2022 --module nodenext --moduleResolution nodenext --types node --typeRoots frontend/node_modules/@types payment-gateway/tests/sdk-typescript.mts
python payment-gateway/api/build-openapi.py
python payment-gateway/tests/sdk-openapi.test.py
```

For real API checks, use a local test gateway and an isolated synthetic merchant:

```powershell
$env:LMA_BASE_URL = 'http://127.0.0.1:8090'
$env:LMA_API_KEY_FILE = (Resolve-Path '.temp/sdk-test-key.txt').Path
node payment-gateway/tests/sdk-matrix.mjs
python payment-gateway/tests/sdk-matrix.py
node payment-gateway/tests/sdk-management.mjs
python payment-gateway/tests/sdk-openapi.test.py
```

Do not call a skipped API check a passed matrix.
