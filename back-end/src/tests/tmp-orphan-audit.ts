/**
 * Temporary forensic lookup: does anything in the database know the two transaction ids that six
 * ledger entries point at? If a notification, authorization, or settlement names the id, the header
 * existed once and was removed later; if nothing does, the entries were written without a header.
 * Deleted after use.
 */
import { connectMongo } from "../infrastructure/mongodb/client.js";
import { getCollections } from "../infrastructure/mongodb/collections.js";

const required = (name: string): string => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
};

const MISSING = ["af3539b1-2fc7-4f41-bea4-3714f365f9f4", "a68d03ea-fc25-44a5-bbdc-19a13ff2ca62"];

const { client, db } = await connectMongo({
  mongoUri: required("MONGODB_URI"),
  mongoDatabase: required("MONGODB_DATABASE"),
  mongoConnectTimeoutMs: 20_000,
  mongoServerSelectionTimeoutMs: 20_000,
  mongoMaxPoolSize: 10,
});
try {
  const collections = getCollections(db);
  const byTransferId = await collections.transactions.find({ transferId: { $in: MISSING } }).toArray();
  console.log("transactions by transferId:", byTransferId.length, byTransferId.map((t) => t.publicId));

  const named: Record<string, string[]> = {};
  const scan: Array<[string, string[]]> = [
    ["notifications", ["transactionId", "transferId", "correlationId"]],
    ["security_events", ["transactionId", "transferId", "correlationId"]],
    ["transfer_authorizations", ["transactionId", "transferId"]],
    ["mining_settlements", ["transactionId"]],
    ["users", ["publicId"]],
    ["wallets", ["publicId"]],
  ];
  for (const [name, fields] of scan) {
    const collection = db.collection(name);
    for (const field of fields) {
      const hits = await collection.find({ [field]: { $in: MISSING } }, { projection: { publicId: 1, [field]: 1 } }).toArray();
      if (hits.length > 0) named[`${name}.${field}`] = hits.map((hit) => String(hit[field]));
    }
  }
  console.log("id references found in:", JSON.stringify(named, null, 2));

  // What survives today around the moment those entries were written?
  const around = await collections.transactions
    .find({ createdAt: { $gte: new Date("2026-10-01T03:14:00Z"), $lte: new Date("2026-10-01T03:18:00Z") } })
    .toArray();
  console.log("transactions written 03:14-03:18:", around.length);
  for (const transaction of around) {
    console.log(" ", JSON.stringify({ publicId: transaction.publicId, transferId: transaction.transferId, amountMinor: transaction.amountMinor, status: transaction.status, at: transaction.createdAt?.toISOString?.() }));
  }

  const orphanWindow = await collections.ledgerEntries
    .find({ createdAt: { $gte: new Date("2026-10-01T03:14:00Z"), $lte: new Date("2026-10-01T03:18:00Z") } })
    .toArray();
  console.log("ledger entries written 03:14-03:18:", orphanWindow.length);
  console.log("distinct transactionIds among them:", new Set(orphanWindow.map((entry) => entry.transactionId)).size);
} finally {
  await client.close();
}
