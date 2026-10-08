# Pro subscriptions and custom addresses

## Operator activation

Run the local, ignored script from the workspace:

```powershell
python scripts/activate-pro.py
```

It asks only for account email and duration: `1` monthly, `2` yearly, `3` lifetime.
It uses `back-end/.env.development` by default. For another database, set
`LOUMA_PRO_ENV_FILE` to the absolute path of its backend environment file before
running. Keep that file and the ignored script on a trusted operator machine;
neither belongs in a public deployment or frontend bundle. Bun and installed
backend dependencies are required; Python needs only its standard library to run
the operator wrapper.

The script prints an activation key before execution. If the response is lost,
retry the same intent using the tracked backend CLI and that same key:

```powershell
cd back-end
bun --env-file=.env.development src/scripts/activate-pro.ts person@example.com monthly THE_SAME_ACTIVATION_KEY
```

A new script invocation generates a new grant and extends an active finite
subscription. Same key with a different account/plan is rejected. A lifetime
account cannot receive another grant. Suspended or missing accounts are rejected.
The account reference identifies its owner in `users`; passwords and tokens are
never copied into subscription records. Login, session refresh and `/api/v1/me`
return the current subscription projection. No existing account is automatically
granted Pro during deployment.

## Address behavior

Accept `Ali`, `Ali123` and up to 16 ASCII letters/digits. Reject two characters,
17 characters, leading digits, Unicode letters, whitespace, `@`, underscores and
all other symbols. Store aliases in lower case, compare without case, and accept
bare aliases in transfers. Customers can change an alias once per 30 days;
re-saving the same alias is a no-op. Canonical receiving addresses remain valid.

Free accounts receive `403 pro_required` on protected data and mutation routes.
Direct frontend navigation checks the API before rendering the page. Frontend
visibility and its expiry timer are advisory; backend authorization uses MongoDB
on every operation. Expired aliases resolve as missing immediately, including
execution of a previously previewed alias payment. The original address remains
usable. Another Pro account can reclaim the alias immediately. Archive entries
remain owned by their original account and cannot route payments.

The API server runs a non-overlapping sweep every minute, processing at most
100 expired subscriptions and 100 alias candidates per pass. It is cleanup,
not authorization. Historical rows have no TTL; the history UI reads the newest
20 rows without loading the full archive.

## History windows and plan benefits

History windows are rolling periods measured back from the current server time:

| Feature                  | Free                      | Louma Pro                                    |
| ------------------------ | ------------------------- | -------------------------------------------- |
| Overview statistics      | 24 hours, 7 days, 30 days | 24 hours, 7 days, 30 days, 90 days, 120 days |
| Analytics                | 24 hours, 7 days, 30 days | 24 hours, 7 days, 30 days, 90 days, 120 days |
| Mining history           | 24 hours, 7 days, 30 days | 24 hours, 7 days, 30 days, 90 days, 120 days |
| Custom receiving address | Not included              | Included                                     |

Overview, Analytics and Mining history request one snapshot bounded by the longest window allowed
for the signed-in plan (30 days for Free, 120 for Pro), cache it for two minutes, and filter the
selected 1/7/30/90/120-day period in the browser. Changing a period therefore does not issue another
history request. The Mining history selector starts at 30 days. The general transaction-history
endpoint without a `days` filter continues to serve the account's existing transfer history.

These windows control dashboard visibility and queries; they do not physically delete old data.
Transactions and ledger entries are permanent financial facts and never expire. Requests for the
Pro-only 90- or 120-day windows without an active Pro subscription return `403 pro_required`; invalid
window values fail query validation. Frontend controls only expose windows the current subscription
permits.
MongoDB-backed subscription state is authoritative, so an expired or downgraded account cannot
keep using Pro-only 90- or 120-day windows by editing a request.

Keep this matrix current when a plan benefit or history window changes. Update the backend window
policy and its integration coverage together with the frontend range controls and this reference.

## Rollout and rollback

This release adds `subscriptions` and `wallet_address_history` with validators
and documented indexes. It keeps all existing wallet/financial uniqueness
constraints. Startup installs them additively; the operator CLI installs only
the two new collections and their indexes. No historical ledger amount, wallet
identity, or transaction snapshot is rewritten. Existing legacy aliases are
inactive until archived/released; the old spelling is retained in history.

Before deployment, take a database backup. Deploy backend guards and frontend
changes together, replace all older API instances, then enable operator grants.
Old processes do not enforce Pro or the new alias intent and must not serve
traffic alongside this release. Verify the isolated integration suite and ledger
reconciliation before opening traffic.

For rollback, stop activation and alias traffic, preserve both new collections
and all archive rows, and keep backend guards deployed. Reverting to pre-Pro
backend code reopens entitlement bypasses; it is not a safe live rollback.
Restore application behavior through a forward fix or a guarded maintenance
window. Never restore archived aliases automatically: another account may have
already reclaimed them. Any database restoration requires the existing counts,
IDs, totals and reconciliation checklist in `migrations.md`.

## Verification

```powershell
Push-Location back-end
bun run typecheck
bun test src/config/env.test.ts src/modules/ledger/money.test.ts src/modules/mining/mining.test.ts src/modules/mining/quota.test.ts src/modules/mining/settings.test.ts src/modules/mining-device/lmdg.test.ts src/modules/security/csrf.test.ts src/modules/security/crypto.test.ts src/modules/security/access-token.test.ts src/modules/security/totp.test.ts src/modules/security/notification-stream.test.ts src/modules/geo/ipinfo.test.ts src/modules/geo/proxycheck.test.ts src/modules/wallets/address.test.ts src/modules/subscriptions/policy.test.ts src/modules/wallets/custom-address.test.ts
bun test --timeout=120000 --env-file=.env.development src/tests/pro.integration.test.ts
bun --env-file-if-exists=.env.development src/tests/architecture-benchmark.ts
Pop-Location
Push-Location frontend
bun run typecheck
bun run build
Pop-Location
```

The Pro integration suite creates and drops only a newly generated
`louma_pro_test_*` database, never the configured application database. It
requires a MongoDB replica set and permission to create a disposable database.
