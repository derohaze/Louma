# Payment gateway financial compatibility

This records the inspected Node contracts and the additive payment journal change. It is a
compatibility report, not a claim that the entire gateway has passed its acceptance criteria.
No production database or existing environment file was used for the checks below.

## Authoritative contracts

`back-end/src/shared/types/wallet-ledger.ts` and
`back-end/src/infrastructure/mongodb/schemas.ts` define the shared records. UUID public IDs
and references are strings; MongoDB `_id` values are ObjectIds. Persisted money is integer
minor units, with 10,000 minor units per LMA. A single movement is at most
9,007,199,254,740,000 minor units; an account projection is at most
9,007,199,254,740,991. Go BSON int64 money within these bounds can be read exactly by Node.
Go readers must also accept existing BSON int32/double integer money and reject fractional,
nonfinite, negative or excessive values.

`wallets` contains identity and state, never a balance. The validator rejects `balance`.
Ownership is `ownerUserId`; `isPrimary` selects the existing product wallet and the partial
unique owner-primary index prevents two primary wallets. Wallets are separate records;
the gateway must preserve the concrete wallet selected and authorized by the payer.

`ledger_accounts` holds `{ publicId, walletId, accountType, currency, balanceMinor,
createdAt }`. A wallet account has a string wallet reference; `fee_revenue` and
`system_treasury` have null wallet references. Wallet and fee-revenue accounts are
credit-normal: debit reduces and credit increases their projections. Existing mining
treasury accounting is **debit-normal issuance accumulation**: a mining treasury debit
increases its projection. The gateway payment/refund path does not use the treasury.

`ledger_entries` holds `{ publicId, transactionId, lineNumber, walletId,
ledgerAccountId, side, amountMinor, currency, correlationId, createdAt }`. Each line is
positive and references its journal's string `publicId`. `lineNumber` is BSON int32,
as are `wallets.financialVersion` and existing mining sequence counters. Go increments
of these fields must encode int32, not int64; otherwise MongoDB promotes the field to
long and the existing strict validator rejects the transaction.

`transactions` remains the permanent shared financial journal. Existing `transfer` and
`mining` branches and their partial unique replay indexes are retained. Existing mining
headers without `walletAccountId` and legacy transfers without `participants` remain
accepted to preserve their documented mixed-version compatibility.

## Gateway journal additions

Both `merchant_payment` and `merchant_refund` require the existing customer movement
fields: sender/receiver user IDs, wallet IDs, address snapshots, `participants` exactly
the ordered pair of user IDs, amount/fee/net minor units, note, idempotency key,
fingerprint, sender balance-after, correlation ID and timestamps. They additionally
require UUID `paymentId`, `operationId` and `merchantId`. They never store `transferId`,
including a null value.

Payment identity uses `operationId = paymentId`. A refund uses its own refund ID as
`operationId`, and `paymentId = originalPaymentId =` the original payment ID. The
gateway's durable payment/refund records coordinate retry fingerprints and settlement.
The shared journal adds the unique index
`transactions_merchant_operation_unique` on `(type, operationId)`, partial to the two
merchant types. The existing globally unique journal public ID and unique transaction
line number indexes remain authoritative.

Merchant validators require integral money, `amountMinor = feeMinor + netAmountMinor`,
positive total/net, bounded money and two different wallet IDs. Refunds additionally
require `originalPaymentId`, zero fee and net equal to the refunded amount. These
checks are additive; transfer and mining validation is not relaxed.

A payment of 100.0000 LMA with a 1.0000 processing fee posts:

| Account | Side | Amount |
| --- | --- | --- |
| Authorized payer wallet | Debit | 100.0000 |
| Selected merchant wallet | Credit | 99.0000 |
| Existing fee revenue account | Credit | 1.0000 |

Zero fees omit the revenue line. No zero-amount ledger entry is written. The payer
confirms and pays exactly the total; the merchant fee is deducted from that total.

Processing fees are non-refundable under this implementation policy. A refund debits
the original merchant wallet by the buyer refund amount and credits the original payer
wallet by the same amount, with no revenue-account movement. A full 100.0000 refund
requires the merchant to have the full 100.0000 available even if its original net was
99.0000. Insufficient funds must retain the pending refund request; no overdraft or
synthetic debt is allowed.

## Atomic authorization and spending boundary

Existing transfer execution in `modules/transfers/create.ts` proves credentials before
opening its money transaction, then increments the sender wallet's financial version
inside the transaction while matching active status and ownership. Freeze changes in
`modules/wallets/service.ts:setWalletFrozen` write the same wallet document. Credential
replacement/disablement in `modules/security/service.ts` also increments owned wallets
in its transaction. These conflicting writes force a concurrent financial operation
to retry and recheck its authorization state.

Go settlements must use that same sender-wallet guard and recheck current credential
versions against the Node-issued proof. TOTP uses the existing owner/purpose/step unique
row and recovery codes require a conditional update against the exact verified hash set.
Approval/proof consumption, debit, bounded credits, journal, payment settlement identity,
invoice changes and outbox event must commit together. Merchant application suspension,
developer eligibility, API key revocation, recurring mandate revocation and subscription
cancellation similarly require conflicting writes inside the monetary transaction,
rather than snapshot reads alone.

Debit condition: available projection `>= amountMinor`. Credit condition: projection
`<= MAX_SAFE_BALANCE - creditedAmount`. Snapshot reads, majority writes, bounded retries
and durable replay lookup before reexecution are required. No network request belongs
inside this transaction. The gateway must determine uncertain outcomes from durable
settlement records and return retryable uncertainty when those facts cannot be read.

Existing Node transfer mining accrual calls `settleMiningForOwner` before spending. That
function posts only confirmed journaled rewards to the session's concrete wallet and
account. Go should request that existing capability securely before settlement, then
atomically spend only the authoritative projection. Unconfirmed accrual is not available
money. A mining-settlement failure must not manufacture either a balance or a successful
merchant payment.

Wallet freeze currently prohibits sending; it does not prohibit account login or receipt
of funds. A refund's sender is the merchant wallet and must obey the same freeze rule.
Recurring billing remains bound to the originally authorized wallet.

## Customer history and reconciliation

Customer history and receipt lookup now include transfer, merchant-payment and
merchant-refund types, while mining stays in its separate history. Existing response
navigation field `transferId` carries the gateway `operationId` for a merchant receipt;
the database journal does not borrow a transfer identity. Sender balance-after is never
returned to the receiving customer. The legacy participants fallback remains bounded
and transfer-specific. Owner scoping applies to lookup and pagination cursors.

The existing reconciler still independently verifies account projections, negative
balances, balanced journal totals, empty headers, orphan lines, duplicate public IDs,
account references and currency. Added semantic checks verify the merchant header's
amount relationship, ordered participants and wallet ownership; exactly the two wallet
postings plus optional revenue posting; correct wallet/revenue account binding; refund
reversal against its original merchant payment; and cumulative refunds no greater than
the original buyer total. A balanced set sent to the wrong account is a critical
`journal_mismatch`. All checks share the existing read-only snapshot session. At most
four lines are materialized per merchant header, sufficient to detect excess lines.

Repository posting copies the journal header before insertion, because the Node driver
adds `_id` to its input object. Keeping the financial intent unmodified prevents a
derived refund/retry object from retaining a previous event's MongoDB identity.

## Safe rollout and rollback

1. Keep gateway settlements disabled. Back up and inspect the target database using the
   existing migration policy. Run all new migrations only under the operator's explicit
   production change procedure; local verification does not authorize production writes.
2. Install the expanded Node journal schema and reader/reconciler compatibility release.
   Drain **every** older Node/schema installer instance before enabling Go financial writes.
   Old instances call `ensureCollection` at startup and can replace the expanded validator
   with the old transfer/mining-only validator. A rolling deployment with an old schema
   writer still restartable is unsafe.
3. Verify the live collection validator explicitly contains both merchant branches and
   remains strict/error. Verify all existing uniqueness/TTL indexes and the new merchant
   operation uniqueness index. Do not use a schema marker alone as proof of the validator.
4. Apply gateway-owned collections/indexes, using the same financial operation index name,
   ordered keys and partial filter. Verify isolated sandbox database credentials cannot
   access the live wallet/ledger database.
5. Verify Go readiness, secure Node identity/mining handoff, end-to-end settlement and strict
   reconciliation in the isolated environment before the owner enables gateway traffic.

Rollback disables gateway financial writers first and retains all financial history and
gateway facts. The expanded Node reader/validator release must remain installed after any
merchant journal exists; reverting to a pre-merchant Node version risks rejected updates,
invisible receipts and schema downgrades. There is no destructive automatic down migration.
Existing Pro `subscriptions` and `subscription_grants` remain separate from gateway
merchant subscriptions and invoices.

The future unified financial write boundary should reuse these shared journal identities,
wallet guards and durable approvals, after executable transfer/mining/payment compatibility
tests prove the migration. This change does not move existing Node transfer/mining writing
to Go or require a risky simultaneous rewrite.

## Verification evidence

Executed without environment files:

- `bun run typecheck`: exit 0.
- `node --import tsx --test src/modules/ledger/merchant-compatibility.test.ts`:
  5 passed, 0 failed. Covers receipt money/privacy, balanced but incorrect account/intent
  detection, refund reversal, and Go BSON int64 compatibility at the exact money limit.
- `$env:LOUMA_PAYMENT_COMPATIBILITY_MONGO_URI='mongodb://127.0.0.1:27177/?replicaSet=gateway-test'; node --import tsx --test src/tests/payment-gateway-financial.integration.test.ts`:
  6 passed, 0 failed against an actual local replica set (five nested scenarios and the
  parent case). Each run creates a random `louma_payment_compatibility_*` database and
  drops only that database during teardown. The suite rejects non-loopback URIs and never
  loads existing application configuration.

The real database suite validates Node schema/index installation twice, complete monetary
rollback, durable operation uniqueness, scoped receipts/pagination, malformed financial
journal rejection, clean strict payment/refund reconciliation, and detection of intentionally
excessive cumulative refunds. The excess-refund case deliberately corrupts only its synthetic
isolated fixture to test detection. Funding itself has balanced journal headers and entries;
the clean reconciliation cases use no funding exclusions.

An initial real database run failed because MongoDB insertion mutated the reusable header
with `_id`; the repository copy fix was applied and the affected suite rerun successfully.
These compatibility tests do not substitute for the gateway's real REST, concurrency,
freeze/revocation race, worker, SDK, browser, load or failure-injection test matrix.
