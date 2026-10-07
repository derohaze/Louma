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
