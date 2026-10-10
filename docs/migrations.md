# Migrations

## Browser admission cutover (ADR-018)

No production cutover was run. Drain every old admission writer and in-flight
request before deploying browser writers. Finish the evidence-v1 backfill and
read-only full verifier below. Preserve counts, IDs, balances and ledger totals.
Allow the final legacy quota windows to expire (24 hours after their anchors)
before enabling browser admission; old coarse quota subjects cannot be silently
reinterpreted as independent keys. Accrued legacy rewards remain settleable.

Bootstrap additive validators first (account fence, browser device kind, nonce
intent/use, bounded session receipt, mining 2FA purpose). Current default is
`LMDG_IDENTITY_MODE=browser`; maintenance rollback sets it to `strict` while
retaining the upgraded settlement/stop code and all additive records. Do not
deploy an older financial writer that ignores browser entitlement. Never mix
legacy and browser admission versions. Pilot on real devices before rollout.

## Mining evidence v1 (ADR-017)

This migration adds derived tokens to historical device documents without changing
their IDs, evidence history, owners, quotas, leases, balances or journal records.
No production migration was performed during implementation.

Deployment procedure, for a separately authorized maintenance window:

1. Preserve a backup and record device IDs/counts, active cycles/leases, quota
   counts, journal/entry counts and ledger reconciliation/totals. Keep the existing
   encryption key. Drain every old mining API writer and all in-flight requests.
   Block start/challenge/prove traffic until all instances run the strict guard.
2. Build the new application. Startup installs the bounded validator and two
   ordinary evidence indexes, then backfills missing-version rows in batches of
   200 before serving. It compares source fields on each majority write. Do not
   run an older binary beside it. Existing strict starts remain unavailable.
3. Run the full evidence verifier with trusted configuration already supplied by
   the operator. It does not load an environment file itself:

   ```powershell
   node --import tsx src/scripts/migrate-mining-evidence.ts
   ```

   Default is read-only. Exit 0 means no mismatch; 1 means mismatches or changed
   IDs/counts; 2 means configuration/storage failure. Reports contain counts and
   an ID digest, never evidence values, hardware IDs or connection credentials.
4. To repair missing OR stale versioned tokens, after verifying writers are
   drained and explicitly checking the configured database name:

   ```powershell
   node --import tsx src/scripts/migrate-mining-evidence.ts --execute --writers-drained --confirm-database=<exact-name>
   ```

   The flag asserts operator action; it cannot itself drain another process.
   The full repair streams 200-row cursor batches, writes one guarded document
   at a time and changes only derived fields. It may be interrupted/repeated.
   Require `after.mismatched=0`, `concurrentChanges=0`, unchanged counts/ID digest
   and exit 0. A concurrent source update is not overwritten; rerun only after
   identifying/draining the writer. Never ignore a nonzero result.
5. Verify named-index execution plans on representative distributions, no duplicate
   active leases, no new pending references, unchanged quota/history/financial
   totals and clean ledger reconciliation. Run strict route smoke tests: valid
   authenticated start/challenge/prove must refuse with the documented 403, while
   existing-cycle stop/settlement and wallet access remain functional.
6. Restore ordinary web traffic only after every instance has the strict guard.
   This deployment does not restore new mining availability. The hardware trust
   boundary in `mining-device-security.md` needs a separately validated release.

Rollback preserves all fields, indexes and history. Keep start/challenge/prove
blocked at ingress and retain the strict service guard even if reverting the
retrieval optimization. A plain rollback to a pre-guard binary reopens the known
spoofing bypass and is not a safe security rollback. Do not delete token fields
or reset pending references while a request can still commit. If old writers
ever ran again, perform full verification/rebuild before reusing indexed
discovery; missing-version bootstrap alone cannot repair stale versioned rows.
Encryption-key rotation cannot be achieved by token rebuild alone, because
stored source digests also use that key.

Isolated verification covers interruption after 200 of 410 rows, resumed counts
and IDs, partial migration refusal, stale versioned rows, read-only preflight,
repair idempotency and a stale observation racing a newer machine value.

## Policy

Never destructive-first: plan, backup/export, preflight counts, transform,
validate, consistency checks, compatibility, post-migration reconciliation,
and only then removal. Repeatable or safely resumable; overlapping runs
converge (insert-if-missing keyed on stable ids, unique-index races re-verify
instead of failing). Never delete a financial collection because the code
stopped referencing it.

## mining_settlements -> transactions (done, pending collection drop)

Each legacy settlement row becomes the journal header it shadowed, under the
SAME publicId the ledger lines already reference — no entry rewritten.
Runner: `npm run migrate:mining-settlements` (preflight counts, migration
report, id-set + totals verification, reconciliation, exit 0 only when clean).
Startup also runs the same idempotent migration after the journal uniqueness
indexes exist.

Drop checklist for `mining_settlements` (all required):
1. migration report: inserted+alreadyMigrated == settlements, mismatched == 0,
   unresolvable == 0;
2. every legacy publicId present in transactions with equal amountMinor;
3. totals equal (legacy sum == represented sum);
4. reconciliation clean (strict, no exclusions);
5. no code references the collection except the migration itself;
6. backup/export retained.

Status: code migrated (settle.ts writes journal-only since this change);
legacy indexes retained until the drop; collection NOT yet dropped.

## Legacy wallet addresses -> canonical wallet addresses

The wallet document is updated in place from `addressVersion: 0` to
`addressVersion: 1`. Each row receives a fresh 128-bit random canonical address;
`address` and `addressNormalized` are both replaced and `updatedAt` advances.
The old address is not copied to an alias field and cannot be used to route a
new transfer after cutover. Address generation is random and the global unique
index on `addressNormalized` is the final collision check; only a collision on
that index retries, with a three-attempt bound.

Runner: `npm run migrate:wallet-addresses:dev` for the configured development
database, or the built `migrate:wallet-addresses` runner for the production
configuration. It is dry-run by default. Execute requires both
`--confirm-database=<MONGODB_DATABASE>` and `--backup-confirmed` after verifying
the backup/export. The updated API first backfills fields and creates the new
indexes, then refuses to serve while any wallet is not version 1. Pause API
traffic during the one-time replacement and restart after verification.

Preflight checks the target database name, required global-address and
primary-wallet unique indexes, wallet/address versions, valid old and canonical
formats, exactly one primary wallet per existing user, and one wallet ledger
account per wallet. Existing wallet-ledger accounts without a wallet are counted
and left untouched when their balance is zero and they have no ledger entries;
the preflight blocks if an orphan account carries financial data. The migration
is bounded to batches of 200 and resumable:
each wallet update is atomic, and already migrated rows are skipped on rerun.
Postflight verifies the wallet count and wallet-ledger-account count are
unchanged, every wallet is version 1 with a valid canonical address, and no
legacy wallet row remains. Balances, ledger entries, journal headers and their
historical address snapshots are never rewritten. There is intentionally no
old-address alias or application rollback path; a repeat run is a no-op.

This is an identity-field migration, not a financial migration. The immutable
wallet `publicId` and every ledger foreign key stay the same. Verify the report
and run the ledger reconciler on the isolated target before opening traffic.

## Incident note (2026-10-02, dev database)

Two killed test runs left debris: entry-less mining headers (recreated by the
migration from settlements whose entries a partial cleanup had removed) and
funding lines deleted while their projections lived on. Repaired by:
deleting headers/accounts with zero entries and no owner, re-inserting the
17 funding pairs (treasury-debit/wallet-credit, `adversarial-funding-restored-*`),
recomputing the treasury projection from entries. Reconciliation with the
suites' funding exclusions: ok:true. Lesson applied: the migration now only
inserts a header when the settlement row resolves a wallet account, and
mismatches are reported, never auto-fixed.
