# Migrations

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
