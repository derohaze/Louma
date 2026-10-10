# Historical strict-mode remediation report

The browser-only continuation supersedes this report's unavailable-mining policy.
See [Browser mining report](browser-mining-report.md) and ADR-018 for the current
implementation, verification evidence and limits. The strict-phase findings below
are preserved as historical evidence, not the current browser policy.

Date: 2026-10-10. Local changes only; no production database access, deployment,
commit or push. The pre-change report is preserved as
[prior-report.txt](artifacts/mining-remediation-2026-10-10/prior-report.txt).

The historical candidate scan has been replaced with complete indexed discovery.
Production mining now rejects all new unverified starts before admission state
changes. **No independently trusted device enrollment is available, so all new
mining is unavailable.** This is the requested fail-closed fallback. It is not a
finished native mining client or a demonstrated physical-device identity system.
Existing cycles can stop and settle; account and wallet operations remain web-based.

## Problems, corrections and evidence

| Problem | Root cause in the old code | Implemented correction | Before / after evidence |
| --- | --- | --- | --- |
| O(N) admission | Initial `find({})` examined historical profiles under a 2,000 ms budget | Bounded indexed evidence union, exact-match tokens, weighted feature cover, absence and legacy fallback; fresh transactional predicate | Original 50k start: 503 / 2582.2 ms. Restoring only the original loader in a temporary copy makes the strengthened 50k acceptance test fail with `503 !== 200`. Indexed acceptance succeeds. |
| Spoofed physical identity | New P-256 keys and coherent client-controlled traits create independent identities | Strict service guards before starts, resolution/enrollment and proofs; no unverified production fallback | Three original strict tests failed with actual 200 vs expected 403 before guards. Final strict tests deny forged/fresh-key starts and prove no device, lease, nonce, attempt or quota rows are created. |
| False-positive identity merges | Coarse machine hashes merge independent-key fixtures | Unverified evidence has no production enrollment authority; strict requests create/merge no identities | Legacy OPEN collision still reproduces. Strict shared-model/shared-NAT tests create zero identities. No measured real-device false-positive rate or working verified enrollment path is claimed. |
| Network residency ordering | A newcomer can start before an established resident, whose exemption permits overlap | Residency cannot bypass strict device authorization, regardless of order, IP or heuristic flags | Legacy OPEN ordering still reproduces. Both strict resident/newcomer orders refuse new cycles and preserve seeded historical records. |
| Partial/stale indexing | Missing or outdated evidence could remove a candidate | Missing-version fallback; same-document writes; guarded resumable backfill and full verifier | Interrupted migration commits 200/410, resumes remaining 210, preserves IDs; stale versioned tokens detected/rebuilt; partial migration refuses. |
| Probe timeout defect found during review | Per-query budgets reset and MongoDB code 50 escaped as HTTP 500 | Shared remaining deadline, cancellation and normalized 503 | Route injection fails before (`500 !== 503`) and passes after. Delayed probes verify outstanding reads cancel. |
| Stale observation defect found during final review | A partial observation could derive an old machine token while leaving a newer stored machine hash | Compare all four source fields before updating evidence/tokens; discard stale sampled observation | Permanent race test fails before with one mismatched row and passes after with the newer record intact. |

The four `OPEN` cases are confirmed failures of the isolated legacy policy. Their
passing test assertions do not mean those heuristics are repaired. They are kept
as evidence of why production strict mode cannot use that policy. There are no
production verified-device throughput or physical uniqueness claims.

## Architecture and invariants

[ADR-017](adr.md) records the candidate completeness proof and schema contract.
Candidate discovery covers all positive matcher verdicts, canonical keys, exact
machine hashes, directional learned rings, eligible drift and normalized raw
legacy snapshots. Idle and blocked records remain eligible. Covered selectivity
probes choose a complete feature cover; they do not decide trust. Candidate
unions over 200 refuse instead of truncating. Probe and initial matching share
the unchanged 2,000 ms budget; no global admission mutex was introduced.

Transactions repeat the predicate in a fresh snapshot, retain assessed IDs/keys
and preserve device/network write fences, unique leases, majority writes, short
snapshot transactions and bounded retries. Creation, backfill and observation
writes keep derived tokens consistent with source evidence. MongoDB remains the
financial authority; no Redis identity, balance or authorization cache is added.
No unique/TTL index is removed, historical record deleted, or reward rule changed.
Below-threshold diagnostic telemetry can inspect fewer unrelated records than
the old full scan; positive matcher completeness is the guarantee.

The [hardware trust boundary and device matrix](mining-device-security.md) names
what is missing. Read-only host inspection found a ready TPM but no manufacturer
EK certificate or configured independent verifier. TPM signing alone does not
link multiple keys to one approved physical device. Browser updates, different
browsers, resets, shared NAT and VM/attestation claims have synthetic backend
coverage or explicit unsupported status; no real multi-device study was performed.

## Verification

The final full isolated runner exited 0 using MongoDB 8.0.0, one fresh loopback
replica set per run, Redis disabled, random databases, synthetic credentials and
Fastify `app.inject`. No application environment files were loaded.

| Check | Result |
| --- | --- |
| Backend unit suite | 155 passed, zero failures |
| Permanent adversarial suite | 45 passed, zero failures, including five strict guard cases and six evidence cases |
| Database / financial integration | 46 passed |
| Mining / quota integration | 22 passed |
| Mining-device integration | 35 passed |
| Pool concurrency integration | 5 passed |
| Transfer-security integration | 15 passed |
| Cleanup-account integration | 3 passed |
| Pro integration | 10 passed |
| Integration total (seven standard suites) | 136 passed |
| Architecture benchmark | Completed; `BENCHMARK_DONE` |
| Backend / frontend typechecks | Exit 0 |
| Independent static review | Two probe findings repaired; follow-up and stale-observation review found no remaining material findings |

The UI changes were typechecked; no real-browser or real-hardware acceptance
session was performed. The hardware matrix explicitly labels that limitation.

Financial regression setup initially exposed two existing test defects: an
unfunded fixture spent before funding (correctly rejected by the validator), and
rollback expected hard-coded subscription version 1 although new grants start at
0. Tests now fund before spending and compare the version read before the failed
transaction. Production financial code and validators were not relaxed. Failing
and repaired logs are retained.

Adversarial evidence covers multiple API/Mongo clients, actual snapshot write
conflicts, bounded five-attempt retry exhaustion, canonical keys, fresh-key proofs,
forged fingerprints, directional history, hidden blocked/raw records, 70 live
fixture devices, IP switching, rate-limit races, expired nonces, quota races,
abandoned/pending work and transaction rollback after invalid lease insertion.
Strict recovery/key-rotation claims and unsupported attestation refuse. This is
not successful native attestation or hardware recovery testing.

Architecture query p50s were 0.54–1.59 ms and p95s 0.71–3.27 ms in the final run.
Wallet lookups examined one key/document. Several history/idempotency queries
were guaranteed misses or used empty collections, so their plans do not establish
populated production performance. Covered evidence probes separately verified
zero fetched documents. Existing concurrency barriers observed actual transaction
retry callbacks and one resulting owner. Detailed logs include the actual counts.

## Scalability and load

Final scale measurements follow. All
numbers concern the isolated legacy matching diagnostic, not strict verified
mining. There are eight start samples per history size, no HTTP/TLS/network
transport, one local MongoDB with a 256 MiB WiredTiger cache, and no Redis.
Percentiles from eight samples are descriptive only. The fixture contains raw
legacy records and conservatively retained windows; separate adversarial tests
exercise actual active cycles. High-collision unions are tested to refuse safely.

| Historical profiles | Accepted / refused | First start ms | p50 ms | p95 / p99 ms | Candidate docs / keys examined |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 1,000 | 8 / 0 | 174.2 | 129.1 | 174.2 / 174.2 | 1 / 22 |
| 5,000 | 8 / 0 | 129.9 | 129.2 | 147.2 / 147.2 | 1 / 22 |
| 50,000 | 8 / 0 | 310.9 | 299.8 | 319.4 / 319.4 | 1 / 23 |
| 100,000 | 8 / 0 | 562.7 | 579.9 | 659.9 / 659.9 | 1 / 19 |

First start means the first measured request after fixture seeding/enrollment and
index construction, not a cold operating-system cache or fresh database boot.
All 32 starts succeeded within the unchanged budget. Each population ended with
zero pending admission references and zero active leases after explicit stops.
The candidate plans used the evidence index for initial and transactional reads.

| Profiles | Node CPU ms across 8 starts (user + system) | Peak Node RSS MiB | Mongo resident MiB after run |
| ---: | ---: | ---: | ---: |
| 1,000 | 843 | 198.0 | 415 |
| 5,000 | 641 | 263.8 | 509 |
| 50,000 | 607 | 289.6 | 753 |
| 100,000 | 966 | 244.3 | 795 |

Each eight-start window recorded 606 finds, 88 updates, 72 getMores, 40 distincts,
24 aggregates, 25 inserts, eight commits and eight findAndModify commands. These
are whole-request command totals, including covered probes and other admission
work; examined-doc/key numbers above concern the candidate queries only. Memory
includes fixture/process effects and Mongo allocation retained between populations.

Final 256-account load, fresh starts at concurrency 64: **30 accepted, 226 refused
with `mining_device_already_in_use`**. All-request latency p50 **2466.74 ms**, p95
**4284.86 ms**, p99 **4476.02 ms**. This rejection composition is unchanged from
the baseline. Returning 30 accounts all succeeded at concurrency 8/16/32; their
start p95s were 544.68 / 996.14 / 1769.33 ms. Peak Node RSS was 498.61 MiB.
Integrity checks passed with zero violations, zero pending references, zero orphan
leases/cycles, zero negative quota references and at most one active cycle per
account. The ending 30 active cycles and their 316 lease keys belonged to the
accepted users. The runner then shut down its own isolated MongoDB.

The 256-account diagnostic must not be interpreted as increased real-user capacity
or a measured physical-device false-positive rate. Refused requests are included
in `allRequestLatencyMs`; older `latencyMs` and per-allowed counters describe
accepted requests only. Some retained raw reports have the old note mentioning
allowed-only metrics; the explicit all-request field is the source for this report.
CPU/memory and all database command counts for scale runs are retained in JSONL.
The load report includes process memory, event-loop delay, outcomes, Mongo method
counts, retry/error samples and final integrity checks. Mongo server CPU was not
separately sampled. The 2,000 ms assessment budget is not an overall API SLA under
load; request work and queueing outside assessment can take longer.

## Operations and delivery

[Migration/deployment/rollback instructions](migrations.md#mining-evidence-v1-adr-017)
require drained old writers, unchanged encryption key, safe backup, strict route
closure, bounded bootstrap, full token verification, counts/ID checks and ledger
reconciliation. The standalone migration is read-only by default and requires
explicit database confirmation plus a drained-writer assertion to repair.
No operator command was run against production. A rollback must preserve the
strict guard or ingress closure; returning to an old browser-only binary reopens
the known bypass. After any old writer ran, missing-only backfill is insufficient.

The [exact file list](artifacts/mining-remediation-2026-10-10/implementation-files.txt)
identifies every changed implementation, test and document. Main changes are the
candidate-evidence model, Mongo evidence query/backfill/verifier, admission and
observation writers, strict policy/config/service guards, requirements/state API,
English/Arabic mining UI, permanent attack tests and isolated runners. The
[evidence index](artifacts/mining-remediation-2026-10-10/README.md) links raw before/
after logs, counterfactual commands, benchmark data and the independent review.

The delivered security guarantee is prevention of **unverified new mining** under
the strict service policy. Legitimate new mining is unavailable until independently
trusted enrollment is implemented and validated. There is no claim of successful
one-device-one-enrollment, arbitrary compromise resistance or zero false positives.
