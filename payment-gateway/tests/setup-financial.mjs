import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { ensureDatabaseIndexes } from "../../back-end/src/infrastructure/mongodb/indexes.ts";
import { getCollections } from "../../back-end/src/infrastructure/mongodb/collections.ts";
import { postBalancedJournal } from "../../back-end/src/infrastructure/mongodb/repositories.ts";
import { reconcileLedger } from "../../back-end/src/modules/ledger/reconciliation.ts";
import { ensureFeeAccount, ensureTreasuryAccount, provisionPrimaryWallet, setWalletFrozen } from "../../back-end/src/modules/wallets/service.ts";
import { setTransferPassword } from "../../back-end/src/modules/security/service.ts";
import { createTransfer, previewTransfer } from "../../back-end/src/modules/transfers/service.ts";
import { settleSession } from "../../back-end/src/modules/mining/service.ts";
import { getTransaction, listTransactions } from "../../back-end/src/modules/transfers/queries.ts";

const backendRequire = createRequire(new URL("../../back-end/package.json", import.meta.url));
const { MongoClient } = backendRequire("mongodb");
const [mode, uri, databaseName, owner, recipientWalletId] = process.argv.slice(2);
if (!/^mongodb:\/\/(?:127\.0\.0\.1|localhost|\[::1\]):\d+\/(?:\?[^#]*)?$/.test(uri ?? "")) throw new Error("Financial fixtures require an explicit loopback URI without credentials or database");
if (!/^louma_gateway_test_[0-9a-f-]{36}$/.test(databaseName ?? "")) throw new Error("Financial fixtures require their generated isolated database name");
const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000, connectTimeoutMS: 5000 });
try {
  await client.connect();
  const db = client.db(databaseName);
  const hello = await db.admin().command({ hello: 1 });
  if (!hello.setName) throw new Error("Financial fixtures require a replica set");
  const collections = getCollections(db);
  if (mode === "reconcile") {
    const report = await reconcileLedger({ collections, mongoClient: client });
    process.stdout.write(JSON.stringify(report));
    if (!report.ok) process.exitCode = 1;
  } else if (mode === "freeze") {
    await setWalletFrozen({ collections, ownerUserId: owner, frozen: true, requestId: "gateway-test-freeze" });
    process.stdout.write(JSON.stringify({ frozen: true }));
  } else if (mode === "password") {
    await setTransferPassword({ collections, mongoClient: client, ownerUserId: owner, currentPassword: undefined, newPassword: "GatewayFixture1234", requestId: "gateway-test-credential-replacement" });
    process.stdout.write(JSON.stringify({ changed: true }));
  } else if (mode === "transfer") {
    const recipient = await collections.wallets.findOne({ publicId: recipientWalletId });
    if (!recipient) throw new Error("Fixture transfer recipient missing");
    const preview = await previewTransfer({ collections, ownerUserId: owner, recipientAddress: recipient.address, amount: "10.0000", note: "Node compatibility transfer", requestId: "gateway-cross-writer-preview" });
    if (!preview.authorization) throw new Error("Node transfer approval missing");
    const input = { collections, mongoClient: client, ownerUserId: owner, authorizationId: preview.authorization.id, recipientAddress: recipient.address, amount: "10.0000", note: "Node compatibility transfer", idempotencyKey: randomUUID(), requestId: "gateway-cross-writer-transfer" };
    const transfer = await createTransfer(input);
    const replay = await createTransfer(input);
    if (!replay.replayed || replay.id !== transfer.id) throw new Error("Node transfer durable replay failed");
    process.stdout.write(JSON.stringify({ transfer, replay }));
  } else if (mode === "mine") {
    const wallet = await collections.wallets.findOne({ ownerUserId: owner, isPrimary: true });
    const account = wallet && await collections.ledgerAccounts.findOne({ walletId: wallet.publicId, accountType: "wallet" });
    if (!wallet || !account) throw new Error("Fixture mining wallet missing");
    const now = new Date();
    const endedAt = new Date(now.getTime() - 1000);
    const session = { publicId: randomUUID(), ownerUserId: owner, walletId: wallet.publicId, ledgerAccountId: account.publicId, status: "active", cycleNumber: 1, startedAt: new Date(endedAt.getTime() - 3600_000), endsAt: endedAt, durationSeconds: 3600, rateUnits: 100, rateScale: 1, rateDecimals: 0, rate: "100", rateUnit: "LMA/hour", settledMinor: 0, settlementSequence: 0, lastSettledAt: null, createdAt: now, updatedAt: now };
    const inserted = await collections.miningSessions.insertOne(session);
    const input = { collections, mongoClient: client, config: { mining: { settlementEnabled: true } }, session: { ...session, _id: inserted.insertedId }, wallet, walletAccount: account, correlationId: "gateway-cross-writer-mining" };
    const settlement = await settleSession(input);
    const replay = await settleSession({ ...input, session: settlement.session });
    if (!settlement.confirmed || settlement.postedMinor !== 1_000_000 || !replay.confirmed || replay.postedMinor !== 0) throw new Error("Node mining durable replay failed");
    const journals = await collections.transactions.countDocuments({ type: "mining", miningSessionId: session.publicId });
    if (journals !== 1) throw new Error("Node mining created multiple issuance journals");
    process.stdout.write(JSON.stringify({ postedMinor: settlement.postedMinor, replayedMinor: replay.postedMinor, journals }));
  } else if (mode === "receipt") {
    const receipt = await getTransaction({ collections, ownerUserId: owner, transactionId: recipientWalletId });
    const history = await listTransactions({ collections, ownerUserId: owner, cursor: undefined, limit: 20, direction: "all" });
    if (receipt.type !== "merchant_payment" || !history.transactions.some((transaction) => transaction.type === "merchant_payment" && transaction.id === receipt.id)) throw new Error("Existing customer history cannot read Go merchant journal");
    process.stdout.write(JSON.stringify({ receipt, history }));
  } else if (mode === "setup") {
    await ensureDatabaseIndexes(db);
    const now = new Date();
    const identities = {};
    for (const name of ["payer", "payer2", "merchant", "otherMerchant"]) {
      const userId = randomUUID();
      const sessionId = randomUUID();
      const session = client.startSession();
      try {
        await session.withTransaction(async () => {
          await collections.users.insertOne({ publicId: userId, email: `${userId}@gateway-fixture.invalid`, passwordHash: "non-authenticating-fixture", profile: { displayName: `Gateway ${name}`, country: null }, status: "active", emailVerifiedAt: null, createdAt: now, updatedAt: now }, { session });
          const wallet = await provisionPrimaryWallet({ collections, ownerUserId: userId, session, now });
          await collections.sessions.insertOne({ publicId: sessionId, ownerUserId: userId, refreshTokenHash: null, previousRefreshTokenHash: null, status: "active", twoFactorAttempts: 0, createdAt: now, lastActiveAt: now, expiresAt: new Date(now.getTime() + 3600_000), revokedAt: null }, { session });
          identities[name] = { userId, sessionId, walletId: wallet.publicId, address: wallet.address };
        }, { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" } });
      } finally {
        await session.endSession();
      }
    }
    const feeAccountId = await ensureFeeAccount(collections);
    const treasuryAccountId = await ensureTreasuryAccount(collections);
    for (const name of ["payer", "payer2"]) {
      const identity = identities[name];
      const account = await collections.ledgerAccounts.findOne({ walletId: identity.walletId, accountType: "wallet" });
      if (!account) throw new Error("Fixture wallet account is missing");
      const amountMinor = 1_000_000;
      const session = client.startSession();
      try {
        await session.withTransaction(async () => {
          await collections.ledgerAccounts.updateOne({ publicId: account.publicId }, { $inc: { balanceMinor: amountMinor } }, { session });
          await collections.ledgerAccounts.updateOne({ publicId: treasuryAccountId }, { $inc: { balanceMinor: amountMinor } }, { session });
          await postBalancedJournal(collections, {
            header: { publicId: randomUUID(), type: "mining", currency: "LMA", status: "completed", ownerUserId: identity.userId, walletId: identity.walletId, miningSessionId: randomUUID(), sequenceNumber: 1, amountMinor, treasuryAccountId, walletAccountId: account.publicId, idempotencyKey: randomUUID(), correlationId: "gateway-contract-funding", createdAt: now, completedAt: now },
            lines: [{ ledgerAccountId: treasuryAccountId, walletId: null, side: "debit", amountMinor, correlationId: "gateway-contract-funding", createdAt: now }, { ledgerAccountId: account.publicId, walletId: identity.walletId, side: "credit", amountMinor, correlationId: "gateway-contract-funding", createdAt: now }],
            linePublicIds: [randomUUID(), randomUUID()],
          }, session);
        }, { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" } });
      } finally {
        await session.endSession();
      }
    }
    for (const name of ["merchant", "otherMerchant"]) await db.collection("gateway_developers").insertOne({ ownerUserId: identities[name].userId, status: "active", financialVersion: 0, createdAt: now });
    const reconciliation = await reconcileLedger({ collections, mongoClient: client });
    if (!reconciliation.ok) throw new Error(`Fixture funding did not reconcile: ${JSON.stringify(reconciliation)}`);
    process.stdout.write(JSON.stringify({ ...identities, feeAccountId, treasuryAccountId }));
  } else {
    throw new Error("Unsupported fixture action");
  }
} finally {
  await client.close();
}
