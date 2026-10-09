import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { MongoClient } from "mongodb";
import { ensureDatabaseIndexes } from "../infrastructure/mongodb/indexes.js";
import { getCollections } from "../infrastructure/mongodb/collections.js";
import { postBalancedJournal } from "../infrastructure/mongodb/repositories.js";
import { reconcileLedger } from "../modules/ledger/reconciliation.js";
import { ensureFeeAccount, ensureTreasuryAccount, provisionPrimaryWallet } from "../modules/wallets/service.js";
import { getTransaction, listTransactions } from "../modules/transfers/queries.js";
import type { MerchantPaymentTransactionRecord, MerchantRefundTransactionRecord, WalletRecord } from "../shared/types.js";

// An explicit loopback URI is required; existing application env files are never loaded.
const testUri = process.env["LOUMA_PAYMENT_COMPATIBILITY_MONGO_URI"];

test("real replica-set merchant journals preserve Node validators, receipts and reconciliation", { skip: testUri === undefined }, async (context) => {
  if (!testUri || !/^mongodb:\/\/(?:127\.0\.0\.1|localhost|\[::1\]):\d+\/(?:\?[^#]*)?$/.test(testUri)) throw new Error("Use an explicit loopback MongoDB URI with no database or credentials");
  const client = new MongoClient(testUri, { serverSelectionTimeoutMS: 5000, connectTimeoutMS: 5000 });
  const databaseName = `louma_payment_compatibility_${randomUUID().replaceAll("-", "")}`;
  const db = client.db(databaseName);
  let connected = false;
  try {
    await client.connect();
    connected = true;
    const topology = await db.admin().command({ hello: 1 });
    assert.ok(topology["setName"], "Financial integration requires a real replica set");
    await ensureDatabaseIndexes(db);
    await ensureDatabaseIndexes(db);
    const collections = getCollections(db);
    const now = new Date();
    const payerUserId = randomUUID();
    const merchantUserId = randomUUID();
    const session = client.startSession();
    let payerWallet: WalletRecord | undefined;
    let merchantWallet: WalletRecord | undefined;
    try {
      await session.withTransaction(async () => {
        for (const ownerUserId of [payerUserId, merchantUserId]) await collections.users.insertOne({ publicId: ownerUserId, email: `${ownerUserId}@payment-fixture.invalid`, passwordHash: "non-authenticating-fixture", profile: { displayName: "Payment fixture", country: null }, status: "active", emailVerifiedAt: null, createdAt: now, updatedAt: now } as never, { session });
        payerWallet = await provisionPrimaryWallet({ collections, ownerUserId: payerUserId, session, now });
        merchantWallet = await provisionPrimaryWallet({ collections, ownerUserId: merchantUserId, session, now });
      }, { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" } });
    } finally {
      await session.endSession();
    }
    assert.ok(payerWallet && merchantWallet);
    const payer = payerWallet;
    const merchant = merchantWallet;
    const payerAccount = await collections.ledgerAccounts.findOne({ walletId: payerWallet.publicId });
    const merchantAccount = await collections.ledgerAccounts.findOne({ walletId: merchantWallet.publicId });
    assert.ok(payerAccount && merchantAccount);
    const feeAccountId = await ensureFeeAccount(collections);
    const treasuryAccountId = await ensureTreasuryAccount(collections);

    async function fundWallet(walletId: string, accountId: string, amountMinor: number, ownerUserId: string) {
      const fundingSession = client.startSession();
      try {
        await fundingSession.withTransaction(async () => {
          await collections.ledgerAccounts.updateOne({ publicId: accountId }, { $inc: { balanceMinor: amountMinor } }, { session: fundingSession });
          await collections.ledgerAccounts.updateOne({ publicId: treasuryAccountId }, { $inc: { balanceMinor: amountMinor } }, { session: fundingSession });
          await postBalancedJournal(collections, {
            header: { publicId: randomUUID(), type: "mining", currency: "LMA", status: "completed", ownerUserId, walletId, miningSessionId: randomUUID(), sequenceNumber: 1, amountMinor, treasuryAccountId, walletAccountId: accountId, idempotencyKey: randomUUID(), correlationId: "gateway-test-funding", createdAt: now, completedAt: now },
            lines: [{ ledgerAccountId: treasuryAccountId, walletId: null, side: "debit", amountMinor, correlationId: "gateway-test-funding", createdAt: now }, { ledgerAccountId: accountId, walletId, side: "credit", amountMinor, correlationId: "gateway-test-funding", createdAt: now }],
            linePublicIds: [randomUUID(), randomUUID()],
          }, fundingSession);
        }, { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" } });
      } finally {
        await fundingSession.endSession();
      }
    }
    await fundWallet(payerWallet.publicId, payerAccount.publicId, 3_000_000, payerUserId);
    await fundWallet(merchantWallet.publicId, merchantAccount.publicId, 3_000_000, merchantUserId);
    const paymentId = randomUUID();
    const payment: Omit<MerchantPaymentTransactionRecord, "_id"> = {
      publicId: randomUUID(), type: "merchant_payment", currency: "LMA", status: "completed", paymentId, operationId: paymentId, merchantId: randomUUID(),
      senderUserId: payerUserId, receiverUserId: merchantUserId, senderWalletId: payerWallet.publicId, receiverWalletId: merchantWallet.publicId,
      participants: [payerUserId, merchantUserId], senderAddress: payerWallet.address, receiverAddress: merchantWallet.address,
      amountMinor: 1_000_000, feeMinor: 10_000, netAmountMinor: 990_000, balanceAfterMinor: 2_000_000, note: "Local contract fixture",
      idempotencyKey: "local-payment-contract", requestFingerprint: "local-payment-intent", correlationId: randomUUID(), createdAt: now, completedAt: now,
    };
    async function postMerchant(header: Omit<MerchantPaymentTransactionRecord, "_id"> | Omit<MerchantRefundTransactionRecord, "_id">, abort = false) {
      const debitAccount = header.type === "merchant_payment" ? payerAccount! : merchantAccount!;
      const creditAccount = header.type === "merchant_payment" ? merchantAccount! : payerAccount!;
      const financialSession = client.startSession();
      try {
        await financialSession.withTransaction(async () => {
          const guard = await collections.wallets.updateOne({ publicId: header.senderWalletId, ownerUserId: header.senderUserId, status: "active" }, { $inc: { financialVersion: 1 } }, { session: financialSession });
          assert.equal(guard.modifiedCount, 1);
          const debit = await collections.ledgerAccounts.updateOne({ publicId: debitAccount.publicId, balanceMinor: { $gte: header.amountMinor } }, { $inc: { balanceMinor: -header.amountMinor } }, { session: financialSession });
          assert.equal(debit.modifiedCount, 1);
          await collections.ledgerAccounts.updateOne({ publicId: creditAccount.publicId }, { $inc: { balanceMinor: header.netAmountMinor } }, { session: financialSession });
          if (header.feeMinor > 0) await collections.ledgerAccounts.updateOne({ publicId: feeAccountId }, { $inc: { balanceMinor: header.feeMinor } }, { session: financialSession });
          const lines = [
            { ledgerAccountId: debitAccount.publicId, walletId: header.senderWalletId, side: "debit" as const, amountMinor: header.amountMinor, correlationId: header.correlationId, createdAt: now },
            { ledgerAccountId: creditAccount.publicId, walletId: header.receiverWalletId, side: "credit" as const, amountMinor: header.netAmountMinor, correlationId: header.correlationId, createdAt: now },
            ...(header.feeMinor > 0 ? [{ ledgerAccountId: feeAccountId, walletId: null, side: "credit" as const, amountMinor: header.feeMinor, correlationId: header.correlationId, createdAt: now }] : []),
          ];
          await postBalancedJournal(collections, { header, lines, linePublicIds: lines.map(() => randomUUID()) }, financialSession);
          if (abort) throw new Error("Local rollback injection");
        }, { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" } });
      } finally {
        await financialSession.endSession();
      }
    }

    await context.test("a failed merchant transaction rolls back all financial facts", async () => {
      await assert.rejects(postMerchant(payment, true), /Local rollback injection/);
      assert.equal(await collections.transactions.countDocuments({ paymentId }), 0);
      assert.equal((await collections.ledgerAccounts.findOne({ publicId: payerAccount.publicId }))?.balanceMinor, 3_000_000);
      assert.equal((await collections.ledgerAccounts.findOne({ publicId: feeAccountId }))?.balanceMinor, 0);
      assert.equal((await reconcileLedger({ collections, mongoClient: client })).ok, true);
    });
    await postMerchant(payment);
    await context.test("journal identity is unique and the customer can read the gateway receipt", async () => {
      assert.equal("_id" in payment, false, "Repository posting must not mutate an immutable intent");
      await assert.rejects(collections.transactions.insertOne({ ...payment, publicId: randomUUID() } as never), (error: unknown) => (error as { code?: number }).code === 11000);
      const receipt = await getTransaction({ collections, ownerUserId: payerUserId, transactionId: payment.operationId });
      assert.equal(receipt.type, "merchant_payment");
      assert.equal(receipt.amount, "100.0000");
      assert.equal(receipt.transferId, payment.operationId);
      const received = await listTransactions({ collections, ownerUserId: merchantUserId, cursor: undefined, limit: 10, direction: "received" });
      assert.equal(received.transactions.length, 1);
      assert.equal(received.transactions[0]?.netAmount, "99.0000");
      await assert.rejects(getTransaction({ collections, ownerUserId: randomUUID(), transactionId: payment.operationId }));
      assert.equal((await reconcileLedger({ collections, mongoClient: client })).ok, true);
    });
    await context.test("strict validators reject malformed merchant financial identities and arithmetic", async () => {
      for (const malformed of [
        { ...payment, operationId: randomUUID(), feeMinor: 10_001 },
        { ...payment, operationId: randomUUID(), amountMinor: 1_000_000.5, netAmountMinor: 990_000.5 },
        { ...payment, operationId: randomUUID(), transferId: null },
        { ...payment, operationId: randomUUID(), participants: [payerUserId, merchantUserId, randomUUID()] },
        { ...payment, operationId: randomUUID(), senderAddress: 42 },
      ]) await assert.rejects(collections.transactions.insertOne({ ...malformed, publicId: randomUUID() } as never), (error: unknown) => (error as { code?: number }).code === 121);
    });
    await context.test("partial refunds reverse original participants and keep fee revenue", async () => {
      const refund: Omit<MerchantRefundTransactionRecord, "_id"> = {
        ...payment, type: "merchant_refund", publicId: randomUUID(), operationId: randomUUID(), originalPaymentId: paymentId,
        senderUserId: merchantUserId, receiverUserId: payerUserId, senderWalletId: merchant.publicId, receiverWalletId: payer.publicId,
        senderAddress: merchant.address, receiverAddress: payer.address, participants: [merchantUserId, payerUserId],
        amountMinor: 500_000, feeMinor: 0, netAmountMinor: 500_000, balanceAfterMinor: 3_490_000, idempotencyKey: randomUUID(), createdAt: new Date(now.getTime() + 1), completedAt: new Date(now.getTime() + 1),
      };
      await postMerchant(refund);
      assert.equal((await collections.ledgerAccounts.findOne({ publicId: feeAccountId }))?.balanceMinor, 10_000);
      const history = await listTransactions({ collections, ownerUserId: payerUserId, cursor: undefined, limit: 1, direction: "all" });
      assert.equal(history.transactions[0]?.type, "merchant_refund");
      assert.equal(history.transactions[0]?.transferId, refund.operationId);
      assert.ok(history.nextCursor);
      const next = await listTransactions({ collections, ownerUserId: payerUserId, cursor: history.nextCursor, limit: 1, direction: "all" });
      assert.equal(next.transactions[0]?.type, "merchant_payment");
      assert.deepEqual(await reconcileLedger({ collections, mongoClient: client }), { ok: true, issues: [] });
    });
    await context.test("the reconciler reports excessive cumulative refunds even when every line balances", async () => {
      const refund: Omit<MerchantRefundTransactionRecord, "_id"> = {
        ...payment, type: "merchant_refund", publicId: randomUUID(), operationId: randomUUID(), originalPaymentId: paymentId,
        senderUserId: merchantUserId, receiverUserId: payerUserId, senderWalletId: merchant.publicId, receiverWalletId: payer.publicId,
        senderAddress: merchant.address, receiverAddress: payer.address, participants: [merchantUserId, payerUserId],
        amountMinor: 600_000, feeMinor: 0, netAmountMinor: 600_000, balanceAfterMinor: 2_890_000, idempotencyKey: randomUUID(),
      };
      await postMerchant(refund);
      const reconciliation = await reconcileLedger({ collections, mongoClient: client });
      assert.equal(reconciliation.ok, false);
      assert.ok(reconciliation.issues.some((issue) => issue.kind === "journal_mismatch" && issue.detail.includes("total refunds")));
    });
  } finally {
    // The generated name and loopback-only connection confine teardown to this test's own database.
    if (connected) await db.dropDatabase();
    await client.close();
  }
});
