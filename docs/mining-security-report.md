# Mining security — current verified position

Date: 2026-10-10. Browser-only, self-hosted, no paid service or installed client.
Changes remain local: no production access, commit, push or deployment.

This is the single current mining security report. Earlier reports and raw test
evidence are consolidated in the [evidence archive](../artifacts/mining-security-evidence-2026-10-10.zip).
The archive preserves their original paths and an integrity manifest. Earlier
measurements and completion claims describe their own trees, not this final tree.

## Confirmed protections and remaining problems

| Scenario | Current result | Evidence / limit |
| --- | --- | --- |
| Equivalent P-256 key encoded differently | Prevented in tested sequential/concurrent starts | Canonical material comparison; two racing accounts produce one cycle and no loser leases. |
| Near-clone enrollment/admission races | Previous protection retained | Real snapshot barriers, device/network fences, bounded retries and unique leases. Six contenders across two API/Mongo clients produce one owner. |
| Recency-window omission | Previous protection retained | Full initial historical assessment plus transaction revalidation; older/live/blocked records remain enforceable. |
| Excessive per-account probing, rotating IPs, Redis unavailable | Bounded | MongoDB sliding windows: 12 starts/minute, 20 challenges/hour, 30 proofs/hour/account. More accounts still multiply the allowance. |
| Partial cycle/lease writes | Rolled back in tested failures | Actual MongoDB validator rejection aborts cycle, leases, fences and retained windows. Pending references are released; healthy retry succeeds. |
| Peer identity leases outlive the peer's own pending request | Addressed in this round | Every directly compared record retains the new cycle's end in the transaction, including peers whose identities it leases. |
| Idle learned history discarded by optimization | Regression found and removed | Prototype permits two cycles; final first assessment remains complete and permits only one. Counterfactual restores the failure. |
| Coherent alternate evidence, independent keys, separate networks | **Open** | Two accepted cycles with disjoint leases. Three edited identity slots already suffice; total replacement is not necessary. |
| Fresh independently generated P-256 keys with valid proofs | **Open** | Both keys pass real nonce/signature verification; that does not establish two physical computers. |
| Forged newcomer before established resident on the same network | **Open** | Both starts accepted under the existing residency exemption. |
| Coarse-profile collisions between independent-key fixtures | **Open false-positive risk** | Different keys and rendering values sharing the coarse machine core still yield a device-conflict 409. Synthetic witness, not a physical-device study or real-user error rate. |
| Large historical populations | **Still a scaling limit** | Initial assessment remains O(N), with a 2000 ms budget. The final 50,000-profile probe reports the actual full-start outcome separately from indexed transaction discovery. |

Tests named `OPEN` pass by reproducing an unresolved bypass/collision. A green
suite is not evidence that those attacks are closed. No thresholds were loosened
or broad fingerprint/network bans added in this round. Existing identity and
network restrictions still have legitimate-user costs.

## Final performance change and rejected prototype

The prototype excluded idle history from both admission scans. It started beside
50,000 idle profiles in 232.7 ms with two examined documents, but final review
found a security regression: learned feature rings can make correlation
directional. An idle peer may recognize caller A through its history, while the
reverse comparison using its current evidence says `different`. Excluding that
idle peer allowed A and the peer's account to mine simultaneously. Reinstating
the complete first assessment changes the result from `200,200` to `200,409`.
**The 232.7 ms full-start result does not describe the delivered implementation.**

The final implementation keeps full initial historical assessment, its risk
inputs and its compared IDs/lease keys. Only the second scan, inside the MongoDB
transaction, uses indexed discovery of current work. Historical resolution and
quota code remain unchanged. This reduces transaction work; it does not solve
the full-start O(N) bottleneck or establish a large-user capacity guarantee.

Optional `mining_devices.admissionPending` records outstanding starts before
assessment. `admissionLeaseEndsAt` conservatively retains cycle windows. The
transaction fence extends that end on every compared record, atomically with
cycle and lease creation. Early stops do not shorten it. `finally` releases only
the request's pending reference after completion/abort. A crash/failed release
leaves extra candidates; a timer must never make an in-flight request disappear.

Transaction discovery selects positive pending counts, future retained ends and
missing legacy ends. Two ordinary ascending indexes serve that exact query.
The existing 2000 ms scan budget and 200-correlated-record cap still apply;
exhaustion returns temporary 503 without accepting a partial comparison.
Large retained populations can still overload transaction discovery too.

## Executed verification

- Typecheck: exit 0. Unit tests: **151/151**.
- Integration: **142/142** — 34 adversarial, 46 database, 22 mining,
  35 mining-device and 5 pool-race. No failures, cancellations or skips.
- Architecture, start, 48-account and 256-account load benchmarks: exit 0.
- Fresh enrollment, 12 samples: p50 **120.46 ms**, p95 **160.95 ms**.
- Architecture mining-state query: p50 **1.37 ms**, p95 **1.85 ms**.
- 5,000 idle profiles: full start **579.7 ms**, transaction callbacks **8.7 ms**;
  the hidden blocked/raw-snapshot conflict still receives 409.
- 50,000 idle profiles: full start returns **503 in 2165.9 ms**. A separately
  exercised transaction-discovery scan takes **21.7 ms** and returns one pending
  candidate. Explain after pending cleanup examines zero documents/one index key.
  This proves a small transaction query, not a successful full start at that size.
- The history counterfactual filters the first scan again and restores two
  accepted cycles. The corrected implementation passes the same scenario.

Full measurements are recorded in the archive's
`docs/artifacts/mining-indexed-admission-2026-10-10/verification.json`, logs,
source hashes and load JSON. Files prefixed `prototype` preserve the rejected
both-scans-filtered implementation's results; they are not final-tree evidence.

Tests use Node 24.17.0, MongoDB 8.0.0, an owned loopback-only single-node replica
set, random isolated databases and synthetic secrets. Redis is disabled and the
runner never loads application `.env` files. Authenticated requests go through
Fastify `app.inject`; MongoDB transactions/indexes and P-256 signatures are real.
Two API instances use separate Mongo clients in one process.

The final larger load enrolls 256 accounts, with a fresh concurrency limit of
64 and returning limits of 8/16/32. Its fixtures reuse coarse characteristics:
**30 accepted, 226 device-conflict refusals**, both before and after. Returning
phases therefore have only 30 accounts, even at the limit of 32. Both load runs
have zero server failures and intact session/lease invariants. The final run
has zero orphan leases, missing cycle leases, negative quota references or
pending admissions; max active sessions/account is one.

| Accepted-request p95 | Before this round | Final tree |
| --- | ---: | ---: |
| Fresh wave, limit 64 | 3539.49 ms | 2964.91 ms |
| Returning start, limit 8 | 813.66 ms | 557.66 ms |
| Returning start, limit 16 | 1371.32 ms | 1165.78 ms |
| Returning start, limit 32; 30 accounts available | 2149.24 ms | 2233.71 ms |

The highest-concurrency sample is slower; no across-the-board speedup is
claimed. A separate final scale probe again returns full-start 503 with 50,000
idle profiles (2176.5 ms), while transaction discovery takes 11.4 ms and delivers
one record. Refusals and accepted latency must be read together. These fixtures
are not a real-user false-positive estimate or an experiment with 256
independently verified physical devices.

No Internet/TLS load, physical browser/device cohort, multi-host clock behavior,
replica failover or real-user false-positive rate was tested. The small start
benchmark's verification retry can report an already-active cycle; proof/retry
success comes from integration and the load benchmark. Workstation timings are
not production capacity or controlled causal speedup estimates.

## Stronger browser-only verification: realistic assurance

The [WebAuthn specification](https://www.w3.org/TR/webauthn-3/) and
[WebCrypto extractability documentation](https://developer.mozilla.org/en-US/docs/Web/API/CryptoKey/extractable)
were fetched during this review; excerpts are archived with the evidence.

| Option | Benefit | Limit / legitimate-user cost |
| --- | --- | --- |
| Browser key, server nonce and account budgets — implemented | Continuity, replay resistance, bounded account probing | A caller can generate another valid key and use another account. Non-extractable WebCrypto keys restrict API export, not the number of keys a computer may create. |
| WebAuthn with required user verification | Origin-bound credential possession and authenticator-mediated verification; adds friction to unattended scripts on supported devices | PIN/face/fingerprint verification is not a unique person/device identifier sent to the site. Multiple credentials/authenticators are possible; synchronized passkeys span devices. Prompts, compatibility and recovery need product work. |
| Trusted attestation plus non-backup-eligible credentials | Stronger evidence of authenticator/storage properties where supported and validated | Ordinary attestation is not a universal computer serial number. AAGUID identifies model/type. Multiple credentials remain possible; hardware allowlists exclude legitimate users. |
| Enterprise attestation | May identify a specific authenticator in managed deployments | Requires permitted RP/device configuration; not generally available to an ordinary public site. The authenticator need not be the computer mining. |
| Fresh server-bound computational challenge | Raises per-attempt cost | Optimized/parallel solvers remain possible; weak phones pay battery/heat/latency costs. Needs measured cost limits across device classes. Not implemented in this round. |
| Stronger account enrollment/ownership verification | Makes extra usable accounts harder to acquire | Changes onboarding/recovery and possibly privacy requirements; does not itself identify a physical computer. |

`excludeCredentials` avoids re-registering known credentials; it is not a
server-verifiable global one-device enrollment limit. Cookies, local storage,
obfuscation and JavaScript tamper flags can add continuity/telemetry but cannot
authorize physical uniqueness against a caller controlling the evidence.

The demonstrated limit is concrete: two valid independent keys and two consistent
evidence sets are accepted. They can come from two legitimate computers or one
controlled client. Blocking every such case would also block legitimate devices.
Stronger browser credentials can reduce automation without resolving this
ambiguity. There is no evidence that AI-assisted evasion is impossible.

## Rollout requirements and reproduction

See **ADR-016** in [adr.md](adr.md) and [database.md](database.md). Drain every old
mining-start writer and its in-flight work before bootstrap/serving this version.
Bootstrap initializes missing windows in batches of 200 through the latest old
active session/lease end, preserving pending counts and concurrently published
new-version windows. Legacy records remain conservative candidates meanwhile.

Mixed old/new writers are unsafe because old code does not publish windows.
After running old writers during rollback, re-upgrade requires drained backfill
of all windows, not only missing ones. Reclaim crashed pending references only
after draining writers and verifying no transaction can still commit. No
production cleanup, history deletion, financial changes or deployment occurred.
Expected historical/retained-population capacity and independent-device collision
measurements remain necessary before claiming readiness for wider rollout.

From `back-end`, using a locally installed MongoDB executable:

```powershell
npm run typecheck
npm test
node src/tests/run-isolated-mining-audit.mjs 'C:/Program Files/MongoDB/Server/8.0/bin/mongod.exe' all
node src/tests/run-isolated-mining-audit.mjs 'C:/Program Files/MongoDB/Server/8.0/bin/mongod.exe' scale
```
