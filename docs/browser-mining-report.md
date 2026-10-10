# Browser mining implementation and verification

Date: 2026-10-10. Local work only. No deployment, production database access,
commit, push, balance workaround or historical deletion.

Browser mining is implemented as the default explicit mode. A normal browser
automatically signs a fresh account/key/origin/evidence-bound challenge, then the
server consumes it in the transaction creating the session and exact-key leases.
Risky requests require the account password and enabled authenticator/recovery
factor before starting. No reward-review hold was implemented: the user chose
verification before admission.

## Policy and financial guarantees

| Input or event | Enforced response |
| --- | --- |
| Same canonical P-256 key on two accounts | One live session; unique leases and transaction recheck |
| Different keys, similar CPUs/GPUs or shared NAT | No identity merge or network ban |
| Correlated high-entropy history, reset, coordinated drift, sparse evidence or reported automation | Password plus enabled 2FA step-up |
| Fresh key with coherent unrelated evidence | Key possession only; no physical-device trust upgrade |
| Missing, expired, replayed, different-account/origin/evidence proof | No start or new enrollment |
| Failed lease write or aborted admission | Session, enrollment, nonce use and 2FA consumption roll back |
| Changed account history between assessment and commit | Revalidation and account fence require renewed verification |
| Duplicate settlement or concurrent stop | Existing journal idempotency, bounded reload and atomic balances |
| Missing/altered session admission or lease | No new reward credit, including stop and transfer auto-settlement |
| Explicit enrollment block/account suspension after admission | Deny new credit when observed in the financial snapshot |
| Expired/deleted proof history | Existing entitlement survives in session and permanent leases |

Account/key quotas remain authoritative in MongoDB and are rechecked inside
admission. Redis is absent in the integration fixtures. Browser flags cannot
disable proofs, leases or economic controls. Enrollment-attempt budgets are
account-scoped; multiple accounts still multiply the available budget.

## Permanent tests and raw evidence

`back-end/src/tests/browser-mining.integration.test.ts` exercises real Fastify
routes, real P-256 signatures, actual MongoDB validators/indexes and transactions.
The isolated runner allowlists its environment and creates its own loopback
replica set. It never loads application environment files.

The final full isolated run completed with exit 0 on 2026-10-10 at 19:45 UTC.
Durable evidence is in `docs/artifacts/browser-mining-2026-10-10/`:

| Verification | Result | Evidence |
| --- | --- | --- |
| Backend and frontend typecheck | Both exit 0 | `final-status.json`, respective typecheck logs |
| Unit tests | 155 passed, 0 failed | `unit.log` |
| Browser API/security regressions | 20 passed, 0 failed; 2 expensive cases run separately | `all.log` |
| Legacy/strict/adversarial regressions | 45 passed, 0 failed | `all.log` |
| Database/mining/device/pool/transfer/cleanup/pro integration | 136 passed, 0 failed | `all.log` |
| Architecture benchmark | `BENCHMARK_DONE`, exit 0 | `all.log` |
| Legacy start/load benchmarks | Both exit 0; load integrity violations empty | `all.log` |
| Browser scale | Completed 100,000-record case; later runner interrupted | `scale-completed-load-interrupted.log` |
| Browser load | 256/256 starts accepted in both completed runs, exit 0 | `browser-load.log`, `browser-load-telemetry.log` |
| Stale-risk counterfactual | Expected vulnerable failure reproduced | `risk-counterfactual.log` |

The 201 integration/adversarial test executions include deliberate OPEN witnesses:
a passing witness confirms the documented remaining boundary, not its remediation.
The architecture benchmark uses the isolated legacy diagnostic seed; browser
admission performance is measured separately. Empty typecheck logs mean no
diagnostics; their exit codes are recorded in `final-status.json`.

Final regression database/log directory:
`C:/Users/haze/AppData/Local/Temp/louma-mining-audit-z4UR9Z`.
Earlier full regression: `louma-mining-audit-5sFVIH`.
Earlier browser runs (including the diagnosed concurrency-response failure):
`louma-mining-audit-MwkWC3`, `louma-mining-audit-VHgW2t`, and `louma-mining-audit-Sebdd2`
under the same Temp directory. All source changes remain uncommitted.

The first 256-user NAT run failed with 256 HTTP `rate_limited` responses before
admission. The old Fastify IP bucket was the cause. Mining routes now append their
limiter after authentication and key it by the verified account, keeping the same
configured limits and MongoDB budgets. A permanent 24-user NAT proof/start test
also covers this below the expensive load suite.

Measured scale: a signed admission request beside 100,000 coherent indexed
synthetic history records completed in **58.78 ms** (earlier run: 79.60 ms).
The post-start evidence query explain examined **1 key / 1 document**. A 100,000
record high-collision bucket required account verification and then allowed
admission; it did not merge identities or refuse based on similarity.

Measured load after the HTTP fix: **256/256 accepted**, C32, one NAT, no Redis.
The final run with MongoDB command telemetry measured all signed-start responses:
**p50 501.43 ms / p95 686.56 ms / p99 690.40 ms**. Node CPU for these waves:
user 4.219 s, system 0.532 s; RSS 289.37 MB before / 352.23 MB after (decimal MB,
not peak). Registration and challenge/prove setup are outside these latency
percentiles. This is admission latency, not whole user onboarding or browser
rendering time.

MongoDB command monitoring recorded 8,704 finds, 1,280 updates, 1,280 inserts,
256 aggregates and 256 commits: **11,776 commands / 46 per accepted start**.
There were **256 transaction starts, 256 commits and 0 observed write conflicts**
in this independent-account load. The dedicated contention tests separately
exercise actual write-conflict retries. Post-load assertions confirm 256 running
sessions, 256 enrollments and 512 active exact-key lease rows.

The earlier completed load without command telemetry also accepted 256/256:
p50 432.43 ms / p95 481.51 ms / p99 483.69 ms; CPU user 3.657 s, system 0.531 s;
RSS 308.36 MB before / 311.49 MB after. These are two local observations, not
a controlled estimate of monitoring overhead or a production capacity claim.

Scale evidence: Temp `louma-mining-audit-TJ3Y3Y/browser.log`; successful load:
Temp `louma-mining-audit-2RKAOj/browser-load.log`; final telemetry:
Temp `louma-mining-audit-02BLbs/browser-load.log`, retained as
`docs/artifacts/browser-mining-2026-10-10/browser-load-telemetry.log`.
The earlier scale runner was
interrupted after its scale case, so only its completed scale measurement is
reported. The load case was run again separately and completed with exit 0.

The reproducible stale-risk counterfactual removes only transaction risk
revalidation in a temporary source copy. The unchanged interleaving test then
returns **200 without step-up**, failing its required 403 assertion. Current
code returns **403 mining_account_verification_required**. Raw counterfactual:
Temp `louma-browser-counterfactual-UK7Cs8/counterfactual-output.txt`.

These are local synthetic fixtures and in-process HTTP injection, not production
capacity or measured real-user false-positive rates.

## Reproduction and implementation map

From `back-end`, with MongoDB 8 installed (substitute only the executable path):

```powershell
node src/tests/run-isolated-mining-audit.mjs 'C:/Program Files/MongoDB/Server/8.0/bin/mongod.exe' all
node src/tests/run-isolated-mining-audit.mjs 'C:/Program Files/MongoDB/Server/8.0/bin/mongod.exe' browser-scale
node src/tests/run-isolated-mining-audit.mjs 'C:/Program Files/MongoDB/Server/8.0/bin/mongod.exe' browser-load
node src/tests/run-browser-risk-counterfactual.mjs 'C:/Program Files/MongoDB/Server/8.0/bin/mongod.exe'
npm run typecheck
npm test
```

Run `npm run typecheck` from `frontend` as well. These audit commands create
isolated MongoDB instances and preserve their raw output; do not replace them
with the ordinary integration scripts that load application environment files.

| Correction | Main implementation files |
| --- | --- |
| Browser mode and strict maintenance setting | `back-end/src/config/env.ts`, `back-end/src/modules/mining-device/verified-policy.ts` |
| Canonical key and intent-bound proof | `back-end/src/modules/mining-device/browser-identity.ts`, `proof.ts` |
| Indexed historical risk and account step-up | `back-end/src/modules/mining-device/browser-admission.ts`, `back-end/src/modules/security/service.ts` |
| Account fence, atomic enrollment/nonce, permanent reward entitlement | `back-end/src/infrastructure/mongodb/browser-mining.ts` |
| Session/lease/quota integration and all reward paths | `back-end/src/modules/mining/start.ts`, `settle.ts`, `stop.ts`, `quota-store.ts` |
| Shared-NAT HTTP correction | `back-end/src/modules/http/http-helpers.ts`, `routes/mining.ts`, `routes/mining-device.ts` |
| Additive persisted contracts | `back-end/src/infrastructure/mongodb/schemas.ts`, `back-end/src/shared/types/{auth,device,mining}.ts` |
| Signed UI flow and Arabic/English verification form | `frontend/src/features/mining/device-guard/device-proof.ts`, `cycle/useMiningCycle.ts`, `cycle/MiningReadyPanel.tsx`, mining cycle locale files |
| Indexed evidence migration inherited from the first remediation phase | `back-end/src/infrastructure/mongodb/mining-evidence.ts`, `indexes.ts`, `back-end/src/scripts/migrate-mining-evidence.ts` |

The NAT failure's before/after evidence is retained in
`before-http-budget-fix.log` and `browser-load.log`. The stale-risk counterfactual
isolates the transaction revalidation change. Other repairs have permanent
regression coverage; they are not claimed to have separate counterfactual runs.

## Independent review

The read-only review found stale risk decisions, false entitlement failures after
concurrent legitimate stops, and lost exact legacy key blocks. The implementation
now fences account history, revalidates its risk snapshot, reloads legitimate
changed settlement snapshots, and preserves exact-key operator blocks. Permanent
tests cover each finding, enabled 2FA, Origin changes and transaction rollback.
The final independent re-review could not run because the review provider's
token-rate limit was exceeded; the initial independent findings and subsequent
local regression results are distinguished here.

## Limits and real-device pilot

The `OPEN BROWSER` witness deliberately still admits two coherent independently
keyed account fixtures. Browser inputs cannot establish physical uniqueness or
prevent an operator who owns multiple accounts from passing password verification.
The legacy OPEN spoofing/network/false-positive witnesses are retained, not
relabelled fixed. No protection against hardware compromise or relays is claimed.

| Pilot scenario | Required real-device evidence | Current status |
| --- | --- | --- |
| Two identical-model laptops, separate keys | Both can start without coarse identity collision | Synthetic test only |
| Siblings on residential NAT / office or carrier NAT | Normal starts; measure step-up and rejection rates | Synthetic test only |
| Same computer, multiple browsers/private profiles | Observe risk and account recovery; no physical uniqueness promise | Not physically exercised |
| Update/reinstall/storage reset | Same account quota/history survives; legitimate step-up recovery works | Synthetic backend test |
| VPN changes / privacy browsers / VM | Stable key continuity, bounded evidence uncertainty, working recovery | Synthetic backend test |
| Desktop/mobile WebCrypto + IndexedDB persistence | Complete UI proof/reauth flow, accessibility and reload behavior | Real-device pilot pending |

Pilot metrics: accepted/step-up/conflict rates by browser and network cohort,
successful verification recovery, account enrollment churn, p50/p95/p99 latency,
MongoDB keys/docs examined, transaction aborts, reward reconciliation, and errors.
Expand cohorts only after reconciling all receipts/leases/journals and reviewing
false positives. Roll back new admissions using strict mode while retaining
upgraded reward readers and history. Detailed cutover rules are in ADR-018 and
`docs/migrations.md`.
