import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { BSON, Long, ObjectId } from "mongodb";
import { merchantJournalIssues } from "./reconciliation.js";
import { publicTransaction } from "../transfers/intent.js";
import {
  LEDGER_AMOUNT_MAX_MINOR,
  type LedgerAccountRecord,
  type LedgerEntryRecord,
  type MerchantPaymentTransactionRecord,
  type MerchantRefundTransactionRecord,
} from "../../shared/types.js";

function fixture(feeMinor = 10_000) {
  const now = new Date("2026-10-08T00:00:00.000Z");
  const payer = { publicId: randomUUID(), ownerUserId: randomUUID() };
  const merchant = { publicId: randomUUID(), ownerUserId: randomUUID() };
  const paymentId = randomUUID();
  const header: MerchantPaymentTransactionRecord = {
    _id: new ObjectId(), publicId: randomUUID(), type: "merchant_payment", currency: "LMA", status: "completed",
    paymentId, operationId: paymentId, merchantId: randomUUID(), senderUserId: payer.ownerUserId, receiverUserId: merchant.ownerUserId,
    senderWalletId: payer.publicId, receiverWalletId: merchant.publicId, participants: [payer.ownerUserId, merchant.ownerUserId],
    senderAddress: "payer-address", receiverAddress: "merchant-address", amountMinor: 1_000_000, feeMinor,
    netAmountMinor: 1_000_000 - feeMinor, note: "Order", idempotencyKey: "checkout-order", requestFingerprint: "fingerprint",
    correlationId: randomUUID(), balanceAfterMinor: 0, createdAt: now, completedAt: now,
  };
  const accounts: LedgerAccountRecord[] = [
    { _id: new ObjectId(), publicId: randomUUID(), walletId: payer.publicId, accountType: "wallet", currency: "LMA", balanceMinor: 0, createdAt: now },
    { _id: new ObjectId(), publicId: randomUUID(), walletId: merchant.publicId, accountType: "wallet", currency: "LMA", balanceMinor: header.netAmountMinor, createdAt: now },
    { _id: new ObjectId(), publicId: randomUUID(), walletId: null, accountType: "fee_revenue", currency: "LMA", balanceMinor: feeMinor, createdAt: now },
  ];
  const lines: LedgerEntryRecord[] = accounts.flatMap((account, index) => index === 2 && feeMinor === 0 ? [] : [{
    _id: new ObjectId(), publicId: randomUUID(), transactionId: header.publicId, lineNumber: index + 1,
    walletId: account.walletId, ledgerAccountId: account.publicId, side: index === 0 ? "debit" : "credit",
    amountMinor: index === 0 ? header.amountMinor : index === 1 ? header.netAmountMinor : feeMinor,
    currency: "LMA", correlationId: header.correlationId, createdAt: now,
  }]);
  return { header, accounts, lines, wallets: [payer, merchant], original: null };
}

test("merchant receipts preserve the payer's exact total and keep balances private", () => {
  const evidence = fixture();
  const sent = publicTransaction(evidence.header, evidence.header.senderUserId);
  const received = publicTransaction(evidence.header, evidence.header.receiverUserId);
  assert.equal(sent.transferId, evidence.header.operationId);
  assert.equal(sent.type, "merchant_payment");
  assert.equal(sent.amount, "100.0000");
  assert.equal(received.netAmount, "99.0000");
  assert.equal(sent.balanceAfter, "0.0000");
  assert.equal("balanceAfter" in received, false);
  assert.equal("transferId" in evidence.header, false);
});

test("merchant reconciliation accepts exactly the wallet debit, net credit and optional fee credit", () => {
  for (const fee of [0, 10_000]) assert.deepEqual(merchantJournalIssues(fixture(fee)), []);
});

test("balanced journals with wrong financial intent or account bindings are rejected", () => {
  const evidence = fixture();
  const variants = [
    { ...evidence, header: { ...evidence.header, amountMinor: evidence.header.amountMinor + 1 } },
    { ...evidence, header: { ...evidence.header, feeMinor: 10_000.5 } },
    { ...evidence, header: { ...evidence.header, participants: [evidence.header.receiverUserId, evidence.header.senderUserId] as [string, string] } },
    { ...evidence, accounts: evidence.accounts.map((account, index) => index === 1 ? { ...account, walletId: randomUUID() } : account) },
    { ...evidence, wallets: evidence.wallets.map((wallet, index) => index === 1 ? { ...wallet, ownerUserId: randomUUID() } : wallet) },
    { ...evidence, lines: [...evidence.lines, evidence.lines[0]!] },
  ];
  for (const variant of variants) assert.ok(merchantJournalIssues(variant).some((issue) => issue.kind === "journal_mismatch"));
});

test("refunds return the confirmed amount to the original payer with no processing-fee reversal", () => {
  const original = fixture().header;
  const evidence = fixture(0);
  const header: MerchantRefundTransactionRecord = {
    ...evidence.header, type: "merchant_refund", operationId: randomUUID(), paymentId: original.paymentId,
    originalPaymentId: original.paymentId, merchantId: original.merchantId,
    senderUserId: original.receiverUserId, receiverUserId: original.senderUserId,
    senderWalletId: original.receiverWalletId, receiverWalletId: original.senderWalletId,
    participants: [original.receiverUserId, original.senderUserId],
  };
  const refund = {
    header, original,
    wallets: [{ publicId: header.senderWalletId, ownerUserId: header.senderUserId }, { publicId: header.receiverWalletId, ownerUserId: header.receiverUserId }],
    accounts: evidence.accounts.map((account, index) => ({ ...account, walletId: index === 0 ? header.senderWalletId : index === 1 ? header.receiverWalletId : null })),
    lines: evidence.lines.map((line, index) => ({ ...line, walletId: index === 0 ? header.senderWalletId : header.receiverWalletId })),
  };
  assert.deepEqual(merchantJournalIssues(refund), []);
  for (const invalid of [
    { ...refund, original: null },
    { ...refund, header: { ...header, merchantId: randomUUID() } },
    { ...refund, header: { ...header, originalPaymentId: randomUUID() } },
    { ...refund, header: { ...header, amountMinor: original.amountMinor + 1, netAmountMinor: original.amountMinor + 1 } },
  ]) assert.ok(merchantJournalIssues(invalid).length > 0);
});

test("Go BSON int64 money remains exact when the Node driver reads shared financial records", () => {
  const evidence = fixture(0);
  const encoded = BSON.serialize({ ...evidence.header, amountMinor: Long.fromNumber(LEDGER_AMOUNT_MAX_MINOR), netAmountMinor: Long.fromNumber(LEDGER_AMOUNT_MAX_MINOR) });
  const decoded = BSON.deserialize(encoded) as MerchantPaymentTransactionRecord;
  assert.equal(decoded.amountMinor, LEDGER_AMOUNT_MAX_MINOR);
  assert.equal(decoded.netAmountMinor, LEDGER_AMOUNT_MAX_MINOR);
  assert.equal(publicTransaction(decoded, decoded.senderUserId).amount, "900719925474.0000");
});
