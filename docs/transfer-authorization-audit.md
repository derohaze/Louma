# Transfer authorization: adversarial financial review

Scope: the custodial LMA wallet transfer path (`back-end/src/modules/transfers`, `security`,
`ledger`, `wallets`, `mining`, MongoDB validators/indexes) on branch `14`, including uncommitted
changes. Every claim below names the code path, the database invariant, or the test that supports it.

Environment used for the executed tests: the MongoDB cluster configured in `back-end/.env.development`
(managed replica set reached over the public internet; `setName=atlas-y9ac9l-shard-0`, primary
confirmed). Round-trip latency to it is 0.5–2 s, so **latency and throughput numbers from that cluster
are not production-representative**; correctness, concurrency semantics and reconciliation results are.

---

## 1. What was wrong before this change

### C1 — An accepted authenticator code could authorise unlimited transfers (critical, fixed)

Before: `createTransfer` called `verifyTransferSecondFactor` (security/service.ts), which verified the
TOTP token and returned the factor's `enabledAt` — nothing about *which* time step was accepted was
ever recorded. `verifyTotpToken` (security/totp.ts) uses otplib's default window, i.e. the current
30-second step only, but *within* that step any number of transfers could be authorised with one
observed code. A code seen on screen, in a proxy log, in a clipboard, or typed for a 2FA *login*
remained a valid transfer credential for the rest of the step, bounded only by the wallet balance.

Now: the accepted step is computed server-side (`totpTimeStep`, `floor(epoch / 30)`), persisted
(`two_factor_uses`), and consumed by an insert inside the transfer's own transaction, guarded by the
unique index `two_factor_uses_step_unique` on `(ownerUserId, purpose, timeStep)`. A second operation
in the same accepted step is refused with 409 `two_factor_code_already_used`.

### C2 — Authorization was not bound to the financial intent (critical, fixed)

Before: the client sent recipient/amount/note; the server recomputed the amounts and executed the
request. The factor proof proved only "this account holds a credential" — it named no amount, no
recipient, no fee. A compromised or malicious client could show a 10 LMA confirmation and send 10,000;
the server had nothing to compare against (OWASP "transaction data must be protected from modification
between review and authorization", WYSIWYS).

Now: `POST /transfers/preview` computes the canonical recipient (wallet id, not the spelling typed) and
the three amounts server-side and stores them as a single-use approval
(`transfer_authorizations`, `intentHash` = sha256 over recipient wallet id, recipient user id,
canonical address, amount, fee, net, currency, note; `expiresAt = now + 10 min`). `POST /transfers`
executes *that* approval: the body's recipient/amount/note are checked against it and rejected on any
difference (`transfer_authorization_mismatch`), and the ledger lines are built from the approval's
numbers. The approval is consumed by a conditional update inside the money transaction.

### C3 — A failed transfer burned a recovery code (high, fixed)

Before: `consumeRecoveryCode` ran *before* `createTransfer` opened its transaction, so a transfer that
then failed (insufficient funds, freeze, conflict, connection loss) had already permanently spent the
user's recovery code — the "burn the credential while the operation fails" antipattern, for a
non-renewable credential.

Now: both consumptions (authenticator step, and recovery code conditional on the exact hash set
verified) happen inside the financial transaction and roll back with it.

---

## 2. Design decision: challenge → transaction-bound consume → commit

Two candidate shapes were evaluated.

1. `authorization → transaction-bound consume → financial commit`
2. `authorization challenge → transaction-specific authorization record → final transfer consumes it atomically`

The implementation is (2) with the consume *inside* the financial transaction, which is what makes
(1)'s atomicity property hold as well. Reasons, in order of importance:

- **The consume is atomic with the money in both directions.** A failed transfer (funds, freeze,
  conflict, connection loss, injected failure) rolls the consumption back, so the user keeps the
  approval *and* the code; a committed transfer means the code and the approval are spent. There is no
  window in which a code is burned for a transfer that did not happen, and none in which money moved
  on an unconsumed proof.
- **The consume is a database-level concurrency guarantee, not a check.** `updateOne({consumedAt: null,
  expiresAt: {$gt: now}}, {$set: {consumedAt, consumedByTransactionPublicId, …}})` plus the unique
  partial index on `consumedByTransactionPublicId` and the unique step index mean two racing requests
  cannot both pass; the loser either write-conflicts (driver retries the callback) or matches no
  document, and converges on a product rejection.
- **Ambiguous commits resolve to the approval, not to a second execution.** `UnknownTransactionCommitOutcome`,
  duplicate-key and exhausted-transient cases are decided by reading the idempotency record for the same
  key: if it exists, its result is returned; if not, the request fails with a retryable 503
  (`transfer_conflict`) — never a success, never a re-execution.

Transfer passwords are handled on the same standard but not made single-use: a password is not a
one-time secret, every transfer legitimately uses it, and making it single-use would be a product lie.
What *is* enforced is that the approval is single-use (so one password entry approves one transfer),
that the credential snapshot is compared inside the transaction (`changedAt`), and that replacing the
password bumps the wallet's `financialVersion` in the same transaction — so a transfer in flight cannot
settle under a credential its owner has just replaced.

---

## 3. Threat-model matrix

Format: scenario → outcome, invariant that prevents it, test that proves it. "Safe" means: money
cannot be duplicated or lost, authorization cannot be bypassed, and the failure is fail-closed.

| # | Scenario | Outcome | Invariant | Test |
|---|---|---|---|---|
| A | Duplicate submission | Safe — one effect | `transactions_sender_wallet_idempotency_unique` `(senderWalletId, idempotencyKey)`; in-transaction duplicate read; fingerprint = approval `intentHash` | "one idempotency key under simultaneous requests…"; pre-existing "same idempotency key racing…" |
| B | Double click | Safe | Same key reused by the wizard for identical parameters → replay | Same as A |
| C | Double tab | Two approvals, two keys, two transfers *if* the user authorises both (each needs a fresh code) | One accepted TOTP step per operation | "a replayed authenticator code cannot authorise a second transfer" |
| D | Multiple browsers | Same as C | Same | Same |
| E | Multiple devices | Same as C | Same | Same |
| F | Simultaneous requests | Safe — exactly one | Conditional approval consume + conditional debit | "one approval is executed at most once, even under simultaneous requests" (1×201, 4×409) |
| G | Retry after timeout | Safe | Replay by key; same fingerprint | "a network retry after commit returns the completed transfer…" (existing) |
| H | Response lost after commit | Safe | `findCommittedTransfer` on every retry path | Same |
| I | Mongo primary step-down | Not directly testable here (managed cluster) | `TransientTransactionError` label → bounded retry + replay check before each retry; exhausted → 503 `transfer_conflict` | "an injected failure at … rolls the transfer back completely"; retry classification unit-visible in `isTransientTransactionError` |
| J | Transaction retry | Safe | Each attempt re-reads the idempotency record; identifiers generated once per request | "transient…" paths above |
| K | Unknown commit outcome | Fail-closed, replayable | `UnknownTransactionCommitOutcome` → replay if the record exists, else 503 | "a network retry after commit…" |
| L | Duplicate idempotency key | Safe | Unique index; replay semantics | A/2 |
| M | Key reused with modified parameters | Rejected | `requestFingerprint` = approved `intentHash` | "the transfer executes the approved intent…" (mismatch), "one idempotency key…" (`idempotency_key_reused`) |
| N | Stolen authenticated session | **Partial (open, H1)** — see §5 | Approval + factor required *if the account has one*; without a credential, `kind: "none"` authorises | "a direct call cannot move money without a server-issued approval" covers the approval half |
| O | Stolen refresh token | Same as N | Rotation/one-time refresh handling unchanged | Existing suite: "a racing refresh is served, while a token replayed later signs every session out" |
| P | Stolen access token | Same as N | 15-minute token; approval + factor | Same as N |
| Q | Leaked transfer password | Bounded | Single-use approval per entry; per-credential argon2 verification; failure lockout | "an approval is single-use" + §4 lockout |
| R | Replayed TOTP | **Fixed (was critical)** | Unique `(ownerUserId, purpose, timeStep)` insert in-transaction | "a replayed authenticator code cannot authorise a second transfer" |
| S | Concurrent TOTP use | Safe | Same unique index | "simultaneous requests with the same authenticator code authorise exactly one transfer" |
| T | Brute-force authorization | Bounded | 10 failed proofs / 15 min / account → 403 `transfer_authorization_locked`; counts only guess-shaped failures (index-served count over `security_events`) | Lockout logic in `assertTransferAuthorizationAttemptsRemain`; not covered by a dedicated test (see §7 L) |
| U | Password change racing a transfer | Safe | `financialVersion` bump in `setTransferPassword` + in-transaction snapshot comparison | Existing suite: "the transfer proves one of the account's credentials…"; comparison is `transfer_authorization_changed` |
| V | 2FA change racing a transfer | Safe | `twoFactorEnabledAt` comparison in-transaction; enable/disable writes the credential | Same path |
| W | Freeze racing a transfer | Safe | Wallet `financialVersion` guard inside the transaction | Existing: "a freeze racing a transfer serialises…" |
| X | Unfreeze racing a transfer | Safe | Same guard (any status change bumps the version) | Same |
| Y | Mining settlement racing a transfer | Safe — one issuance | `miningSessions` CAS on `settledMinor`; `mining_settlements_session_sequence_unique`; settlement posts exactly `accrued - settled` | Existing mining suite (`npm run test:integration:mining`) |
| Z | Concurrent transfers from one wallet | Safe | Conditional debit `balanceMinor: {$gte: amount}` | Existing stress volley; new burst test |
| AA | Concurrent transfers to one receiver | Safe | Receiver credit is `$inc` with an upper bound; the receiver is not a lock | New burst test (12 approvals against one receiver) |
| AB | Concurrent transfers hitting the fee account | Correct under contention; throughput-bound (M4) | Fee credit is a conditional `$inc` on one document; conflicts retry | New burst/concurrency tests; benchmark harness |
| AC | Direct API bypass of the wizard | Rejected | `authorizationId` required by the route schema *and* by the service; unknown/foreign approvals are 404 | "a direct call cannot move money without a server-issued approval" (400 without the field, 401 with it unauthenticated, 404 for fabricated) |
| AD | Parameter tampering | Rejected | Body is compared with the approval, never used to build the transfer | "the transfer executes the approved intent…" |
| AE | Amount manipulation | Rejected | Same; amounts re-derived from the approved amount by `calculateTransferAmounts` | Same |
| AF | Recipient mutation | Rejected | Approval names `recipientWalletId` + canonical address | Same |
| AG | Canonical-address mismatch | Safe | The credited wallet is the approved `recipientWalletId`; a re-spelling must resolve to the same wallet | Same (+ `resolveRecipient` fallback) |
| AH | Stale preview | Bounded | Approval TTL 10 min, enforced by the consume's `expiresAt` condition | "an approval cannot be borrowed…, nor survive its expiry" |
| AI | Stale balance | Safe | The debit's conditional update decides, not any displayed number | "an approved amount cannot overdraw a wallet that was spent in the meantime" |
| AJ | Transaction replay | Safe | Same as A/G | A/2 |
| AK | Ledger projection corruption | Detected | `reconcileLedger` (projection vs entries; negative balances); new test asserts the sign convention per account type | "the wallet, receiver, fee and treasury projections all equal their immutable entries" |
| AL–AP | Partial failure after debit/credit/fee/header/lines | Impossible — atomic | One `withTransaction` (snapshot read concern, majority write concern); injected-failure tests at every write point | Existing: "an injected failure at … rolls the transfer back completely" (6 points); new: `after_authorization_consume`, `after_credential_consume` |
| AQ | Notification failure | Safe | Notifications are inserted in the same transaction (no phantom, no lost notice); the stream is a hint | Existing notification tests; "one approval is executed at most once…" asserts exactly 2 notices |
| AR | Database outage | Fail-closed | Connection/selection errors surface as failures, never successes; no money path retries blindly | Error classification in `createTransfer`; not load-tested (§7 D) |
| AS | Replication lag | Bounded | `writeConcern: majority` + snapshot reads inside the transaction | Transaction options in `createTransfer` |
| AT | Transient Mongo errors | Bounded, safe | Label/code classification, 3 attempts with backoff, replay check before each | Injected-failure and retry tests |
| AU | Hot-document contention | Measured, not cured | Conflicts are retried by the driver; the money invariants hold under them | Burst/concurrency tests; `npm run bench:transfers` |
| AV | Account enumeration | Present, low impact | Addresses are identifiers; `notFound` vs `conflict` distinguishes existence; rate-limited (30/min/IP). Approvals are opaque: unknown and foreign both 404 | "a direct call cannot move money without a server-issued approval" |
| AW | Authorization oracle abuse | Bounded | Same answer for foreign/unknown approvals; lockout on guesses | Same + lockout |
| AX | Rate-limit bypass using many IPs | Open (H2) | Per-IP route limits only; see §5 | — |
| AY | High-frequency low-value transfers | Bounded by balance/fee/rate limits | Per-IP 30/min on the transfer route; no per-account velocity limit (H2) | Burst test shows the funds bound |
| AZ | High-frequency high-value transfers | Same as AY | Same | Stale-balance and burst tests |
| BA | Many accounts controlled by one attacker | Partially bounded | LMDG device/network controls on mining; nothing transfer-specific | Mining suite |
| BB | Internal/admin accidental mutation | Not reachable through the API | No PATCH/DELETE on financial resources; validators reject mutated documents; CLI tools are read-only except the control row | Existing: "historical ledger records are immutable through the application surface" |
| BC | Future integrations writing directly to balances | Guarded | Single writer per balance: `createTransfer` (transfer), `settleSession` (issuance), `fund` is test-only. Reconciliation is the detector for anything else | `reconcileLedger` CLI + `npm run cleanup:test-accounts:dev` for test data |

---

### 3.1 Mechanisms that were already sound (audited, not changed)

- The sender debit is a conditional atomic update (`balanceMinor: {$gte: amount}`), so no code path can overdraw a wallet.
- The ledger is append-only through the API: no endpoint updates or deletes a transaction, an entry, or an account.
- `assertBalanced` refuses any ledger set that does not balance before a single write is attempted.
- Every financial transaction runs with `readConcern: snapshot` and `writeConcern: majority`.
- Unique indexes, not check-then-insert: one primary wallet per owner, canonical address/custom address, one ledger account per wallet, one fee and one treasury account, ledger entry id, transaction line identity, transfer id, wallet-scoped transfer idempotency key, mining settlement identity, mining cycle identity, credential ownership.
- The freeze/transfer and password-change/transfer races are closed by the same `financialVersion` conflict boundary — a single write-conflict object both sides must touch.
- Mining settlement is a compare-and-set on `settledMinor` against the window-clamped accrual, so it can neither double-credit nor exceed the cycle's total.
- Reconciliation recomputes every projection from the immutable entries and flags negative balances; the sign convention is credit-normal for wallets and fee revenue, debit-normal for the treasury (now covered by a dedicated test, and verified across the whole dev database: `ok: true, issues: 0`).
- Financial rejections are recorded as security events with a correlation id, including the idempotency key and amount, so a failure can be traced to the request that produced it.

## 4. Changes made

Backend (`back-end/src`):

- `shared/types.ts` — `TransferIntent`, `TransferAuthorizationRecord`, `TwoFactorUseRecord`,
  `FinancialControlsRecord`, `PublicTransferAuthorization`; `TRANSFER_AUTHORIZATION_TTL_MS` (10 min),
  `TRANSFER_AUTHORIZATION_RETENTION_MS` (30 d), `TOTP_PERIOD_SECONDS` (30),
  `TWO_FACTOR_USE_RETENTION_MS` (7 d).
- `infrastructure/mongodb/collections.ts` — `transferAuthorizations`, `twoFactorUses`, `financialControls`.
- `infrastructure/mongodb/indexes.ts` — strict validators + indexes (§6).
- `modules/transfers/service.ts` —
  `previewTransfer` issues the approval and returns `authorization {id, expiresAt, intent}`;
  `createTransfer` requires `authorizationId`, executes the approved intent, checks the body against it,
  consumes the approval and the factor proof inside the transaction, and maps exhausted transient
  failures to 503 `transfer_conflict`; `intentHashOf`/`publicAuthorization`/
  `loadTransferAuthorization`/`assertTransferAuthorizationAttemptsRemain` added.
- `modules/security/service.ts` — `proveTransferCredential` (verifies, writes nothing, returns the
  proof descriptor incl. the accepted `timeStep`), `consumeTransferCredentialProof` (inserts the step /
  consumes the recovery code conditionally, inside the caller's transaction), `totpTimeStep`.
  `verifyTransferSecondFactor` removed (its only caller was the transfer path).
- `modules/financial-controls/service.ts` (new) — operator controls with a 1-second read cache;
  absent row means "not paused"; `setFinancialControls`, `resetFinancialControlsCache`.
- `modules/mining/service.ts` — settlement refuses while `payoutsPaused` (reports *unconfirmed*, so no
  caller can read a paused settlement as a smaller reward; the cycle stays open and unstranded).
- `modules/http/routes.ts` — preview accepts and returns the approval; the transfer route requires
  `authorizationId` (schema + service).
- `scripts/financial-controls.ts` (new) — operator CLI (`--status`, `--transfers-paused --reason …`,
  `--transfers-resumed`, `--payouts-paused`).
- `scripts/cleanup-test-accounts.ts` (new) — removes integration-suite accounts and their ledger
  footprint, adjusting shared projections by exactly the net of the deleted entries. Report-only
  unless `--apply`.

Frontend (`frontend/src`):

- `lib/api.ts` — `ApiTransferPreview.authorization` typed.
- `components/wallet-pages.tsx` — the wizard carries the approval, sends `authorizationId`, retires the
  approval when the intent changes, and returns to the amount stage when the server refuses an
  expired/spent/mismatched approval.

Package scripts: `test:integration:transfers`, `bench:transfers`, `financial:controls[:dev]`,
`cleanup:test-accounts[:dev]`; `test:integration` now includes the new suite.

Failure policy (Phase 17) — every error class, and what the code does with it:

| Error | Decision |
|---|---|
| `insufficient_funds`, `wallet_frozen`, `wallet_limit_exceeded`, `self_transfer` | reject (409/403), record `transfer_rejected`, rollback |
| `invalid_*` credential / `invalid_two_factor_code` | reject (403), record, count toward the lockout |
| `two_factor_code_already_used`, `recovery_code_already_used` | reject (409), record — never retried |
| `transfer_authorization_used` / `_expired` / `_mismatch` / `_changed` | reject (409), record — client re-approves |
| `idempotency_key_reused` | reject (409), no execution |
| `transfer_authorization_locked` | reject (403), record |
| `transfers_paused` | reject (503), no write attempted |
| Transient/unknown-commit/duplicate-key, record missing | retry (bounded), then 503 `transfer_conflict` |
| Transient/unknown-commit/duplicate-key, record present | return the existing result (`replayed: true`, HTTP 200) |
| Reconciliation reports a critical issue | operator action: `financial:controls --transfers-paused` (fail closed by hand; no automatic trip-wire) |

---

## 5. Open risks (not fixed here)

- **H1 — an account with no transfer credential can transfer with a session alone.**
  `proveTransferCredential` returns `kind: "none"` when the account has neither a transfer password nor
  an enabled authenticator, and the transfer proceeds. A stolen session (or access token) is therefore
  sufficient to move that account's funds. This is pre-existing product policy ("an account with
  neither may send directly"), so it was not changed silently; the fix is a product decision
  (require credential enrollment before the first send, or require the account password when no
  transfer credential exists).
- **H2 — no per-account velocity or cumulative-amount limits.** Limits today: per-IP route limits
  (preview/transfer 30/min, register/login 5/min, 2FA verify 8/min, refresh 20/min) and the new
  per-account authorization-failure lockout. A distributed attacker holding a valid session (and a
  credential) is bounded only by the balance; many accounts (BA) are not bounded at all on the transfer
  path. Recommended next: per-wallet rolling limits on count and 24 h amount, checked before the
  transaction and recorded as security events.
- **H3 — the reconciliation trip-wire is manual.** `npm run reconcile:ledger` exits 1 on discrepancies,
  but nothing stops financial writes automatically. The control row + CLI is the documented response.
  Automating it needs a scheduler and an alerting channel, which this repository does not have.
- **M1 — preview writes a row per amount quote** (bounded by the route rate limit; 30-day retention).
- **M2 — enumeration:** an authenticated user can tell whether an address exists (404 vs 200/409).
  Inherent to address-based payments; rate-limited; approvals themselves are not probeable.
- **M3 — notifications are written inside the financial transaction** (chosen: exactly-once, no
  phantoms, no lost notices). Cost: two extra inserts per transfer. A transactional outbox would move
  that cost out of the critical section at the price of a second durable write path; not justified at
  the measured scale.
- **M4 — the fee account is one document per fee-bearing transfer.** Correctness does not depend on it
  (conditional `$inc`; conflicts retry), throughput might. Deliberately *not* partitioned before
  measurement — `npm run bench:transfers` exists to decide it, and the comparison between shape A
  (fee) and shape C (fee rounded to zero) isolates its cost.
- **M5 — clients must treat 503 `transfer_conflict` as retry-with-the-same-key.** The wizard already
  reuses the key for identical parameters; any other client must not mint a new key to retry.
- **M6 — API compatibility:** `POST /api/v1/transfers` now requires `authorizationId` and the preview
  returns an approval, so the frontend and any other client must ship together. Old clients get 400.

---

## 6. Database invariants and index changes

New collections (strict validators, `validationAction: "error"`), created idempotently at boot by
`ensureDatabaseIndexes`:

- `transfer_authorizations` — `publicId` unique; `consumedByTransactionPublicId` unique (partial,
  string) → *one approval, one transaction*; `(ownerUserId, createdAt desc)`; TTL on `retainUntil`
  (30 days after expiry, audit retention).
- `two_factor_uses` — **unique `(ownerUserId, purpose, timeStep)`** → *one accepted code, one financial
  operation*; TTL on `retainUntil` (7 days).
- `financial_controls` — single document `_id: "global"`; policy only, no money.

Current index guarantees: `transactions_sender_wallet_idempotency_unique (senderWalletId, idempotencyKey)` partial on
`type: "transfer"`; `transactions_transfer_id_unique`; `transactions_public_id_unique`;
`ledger_entries_public_id_unique`; `ledger_entries_transaction_line_unique (transactionId, lineNumber)`;
`ledger_accounts_wallet_unique`; `ledger_accounts_revenue_unique`, `ledger_accounts_treasury_unique`;
`wallets_owner_primary_unique`, `wallets_address_unique`, `wallets_custom_address_unique` (partial);
`two_factor_owner_unique`, `transfer_password_owner_unique`; `mining_settlements_session_sequence_unique`,
`mining_settlements_idempotency_unique`; `mining_sessions_one_active_per_user` (partial);
`mining_device_leases_one_active_per_device` (partial); `mining_devices_anchor_unique` (partial);
`mining_device_nonces_unique`.

Wallet identity migration: `docs/migrations.md` describes the in-place address replacement, backup,
database confirmation, bounded resumability, and startup gate. No wallet alias is retained; old
transaction address snapshots remain immutable. The transfer approval protocol and its
`authorizationId` field are unchanged for the frontend.

Reconciliation sign convention, verified independently: wallets and `fee_revenue` are credit-normal
(a credit grows the balance), `system_treasury` is debit-normal (a debit grows it, which is how issuance
posts debit-treasury/credit-wallet without driving the treasury negative). The new test recomputes
every involved account from its immutable entries with an independent formula and asserts equality with
the projection; a whole-database run against the dev cluster reported `ok: true, issues: 0`.

---

## 7. Tests

New: `back-end/src/tests/transfer-security.integration.test.ts` (14 tests; `npm run test:integration:transfers`):

1. the transfer executes the approved intent, not the request that carries it (amount/recipient/note tampering)
2. a direct call cannot move money without a server-issued approval (fabricated/malformed/borrowed; route schema requires the field)
3. one approval is executed at most once, even under simultaneous requests (5 concurrent)
4. one idempotency key under simultaneous requests produces one effect and replays for the rest
5. an approval cannot be borrowed by another account, nor survive its expiry
6. a replayed authenticator code cannot authorise a second transfer
7. simultaneous requests with the same authenticator code authorise exactly one transfer
8. a failed transfer burns neither the approval nor the authenticator step (injected failure *after* both consumptions; asserts the rollback on the database)
9. an approval survives a transfer that failed on the funds check, and is usable afterwards
10. an approved amount cannot overdraw a wallet that was spent in the meantime
11. the wallet, receiver, fee and treasury projections all equal their immutable entries
12. an operator pause fails closed: no transfer executes while it is on
13. a burst of approved transfers keeps the ledger exact and the wallet solvent (12 approvals vs 25.0000)
14. the authorization invariants hold across everything this run wrote (one consumption per approval, one per accepted step, every consumed approval names a balanced transaction)

Existing suite updated for the two-step flow (`approve` + `send` helpers, approval ids in the direct
calls, cleanup of the new collections) and its reconciliation exemption now lists every suite's funding
prefix, so a suite killed mid-run cannot produce a false orphan alarm.

Concurrency results observed (real simultaneous requests against the configured cluster; the money
assertions all passed — the only failures in earlier runs were the funding-debris artefacts described
above, since fixed):

- one approval, 5 simultaneous sends → exactly 1 success, 4 × 409 `transfer_authorization_used`; one transaction; sender debited once; receiver credited once; exactly 2 notifications; approval records `consumedAt` + the transaction id it authorised.
- one idempotency key, 5 simultaneous sends → 1 executed, 4 replays, all five responses carrying the same `transferId`.
- one accepted code, two simultaneous sends with two different approvals → exactly 1 authorised, exactly 1 `two_factor_uses` row.
- 12 approvals × 3.0000 against 25.0000 → all-or-nothing per approval: committed transfers' debits equal the balance drop exactly, every refusal is `insufficient_funds`, and approvals that were refused stay unconsumed.

Suite tally on the last full run before the two test-side timing fixes: 12 of 14 passed; the two
failures were a code generated before the approval round trips (a step boundary, not a product
failure — the fix generates the code immediately before the send, as an owner does) and the
funding-debris reconciliation described above.

Payouts pause (issuance) verified directly against the cluster: with `payoutsPaused` set, `settleMining`
refused with `mining_settlement_failed`, the wallet stayed at 0 and **0 settlements posted**; with the
pause cleared the same cycle settled once (983,333 minor) as one balanced journal
debit-treasury/credit-wallet, moving both projections by the same amount. Nothing was stranded by the
pause: the reward posted in full on resume.

**Load test (Phase 16): not completed.** `npm run bench:transfers` (shapes A–D, concurrency ladder,
p50/p95/p99, refusals, retry-exhausted) is implemented and documented, but this environment's cluster
(shared, remote, 0.5–2 s round trips) cannot support a meaningful 10→1000 TPS ladder, and reporting its
numbers as capacity would be exactly the unfounded claim this review is meant to avoid. What was
measured instead: the suites' own transfers complete correctly under 5–12-way concurrency with
retries and conflicts, and contention is handled by retry, not by violating an invariant.

---

## 8. Operational runbook

```
# Is the ledger sound? (exit 0 ok, 1 discrepancies, 2 run failed)
npm run reconcile:ledger

# Stop / resume money movement (no deploy needed; takes effect within ~1s per process)
npm run financial:controls -- --status
npm run financial:controls -- --transfers-paused --reason "INC-1234 reconciliation failure"
npm run financial:controls -- --payouts-paused    --reason "INC-1234 issuance halted"
npm run financial:controls -- --transfers-resumed --reason "INC-1234 resolved"

# Remove integration-suite accounts and their ledger footprint (report first, then --apply)
npm run cleanup:test-accounts:dev
npm run cleanup:test-accounts:dev -- --apply
```

Pause semantics: in-flight transactions may still commit (a brake, not a rollback); everything that
commits remains reconcileable; correct a broken balance only with compensating ledger entries, never by
overwriting a projection.

---

## 9. Assumptions

- The database is a replica set (transactions, majority write concern, snapshot reads).
- Index creation happens before the API serves traffic (`ensureDatabaseIndexes` at boot). If a
  deployment ever serves transfers before the new unique indexes exist, the step/approval guarantees
  degrade to conditional-update-only (still no double execution from the same process, but the
  database-level refusal of a second step is what makes the invariant hold across processes).
- Server clocks are synchronised (TOTP step boundaries) and the API is the only writer of balances.
- The frontend that sends `authorizationId` ships with this backend.
