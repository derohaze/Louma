# Financial invariants (non-negotiable)

1. MongoDB is the source of truth for balances, entries, transactions,
   issuance, and authorization. Redis is never authoritative for any of these.
2. Integer minor units only. No floats, no decimal strings in persisted money.
   Bounds: single movement <= LEDGER_AMOUNT_MAX_MINOR, projection <=
   LEDGER_BALANCE_MAX_MINOR (safe-integer range).
3. Double entry always: every header has >= 2 balanced lines; `assertBalanced`
   runs before any write; the reconciler independently checks balance,
   emptiness, orphans, duplicates, currency, references, projections, and
   negativity.
4. No balance mutation without its ledger event in the same transaction.
   Projections move only via conditional updates (funds-present debit,
   ceiling-checked credit).
5. Idempotency is durable (MongoDB unique indexes), never Redis-only:
   transfer (sender + key), mining (session + sequence, key namespace
   `mining:<session>:<sequence>`). Same key + different intent = rejection.
6. One approval, one spend (conditional consume inside the money transaction +
   consumedByTransactionPublicId uniqueness). One TOTP step, one operation
   (two_factor_uses unique per owner/purpose/step, inserted in-transaction,
   rolled back with failure).
7. Credential replacement races close via the wallet financialVersion guard:
   a transfer proven under a replaced password/factor cannot commit.
8. Freezes serialize with transfers through the same guard; a frozen wallet
   cannot send.
9. Issuance only via settlement: treasury-debit / wallet-credit, treasury
   never negative, capped at the 24h accrual, operator-pausable (payoutsPaused
   reports unconfirmed, never a zero-success).
10. Transactions are short, snapshot-read, majority-write, with no network
    calls inside. Retries are bounded and always re-check the idempotency
    record before re-executing.
