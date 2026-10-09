import dns from "node:dns";
import { connectMongo } from "../infrastructure/mongodb/client.js";
import { getCollections } from "../infrastructure/mongodb/collections.js";
import { hasGatewayDeveloperAccess } from "../infrastructure/mongodb/gateway-developer-repository.js";
import { AppError } from "../shared/errors.js";

async function main() {
  const [email] = process.argv.slice(2);
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("Use an account email.");
  }
  const mongoUri = process.env["MONGODB_URI"];
  const mongoDatabase = process.env["MONGODB_DATABASE"];
  if (!mongoUri || !mongoDatabase) throw new Error("Configure MONGODB_URI and MONGODB_DATABASE in the selected environment file.");
  dns.setServers(["1.1.1.1", "9.9.9.9"]);
  const { client, db } = await connectMongo({ mongoUri, mongoDatabase, mongoConnectTimeoutMs: 5000, mongoServerSelectionTimeoutMs: 15000, mongoMaxPoolSize: 5 });
  try {
    const collections = getCollections(db);
    const user = await collections.users.findOne({ email: email.trim().toLowerCase(), status: "active" }, { projection: { publicId: 1 } });
    if (!user) throw new Error("No active account has that email in the development database. Sign up in the local app first, then retry.");
    const alreadyActive = await hasGatewayDeveloperAccess({ mongoClient: client, database: mongoDatabase, ownerUserId: user.publicId });
    if (alreadyActive) {
      console.log("Developer access is already active for that account.");
      return;
    }
    const now = new Date();
    await db.collection("gateway_developers").updateOne(
      { ownerUserId: user.publicId },
      { $set: { ownerUserId: user.publicId, status: "active", grantedBy: "operator:script", grantedAt: now, updatedAt: now }, $setOnInsert: { createdAt: now } },
      { upsert: true },
    );
    console.log("Developer access activated. It never expires; suspend it by setting status to suspended.");
  } finally { await client.close(); }
}

main().catch((error: unknown) => {
  console.error(error instanceof AppError ? error.message : error instanceof Error && !("code" in error) && !error.name.startsWith("Mongo") ? error.message : "Activation failed. Check database connectivity and retry.");
  process.exitCode = 1;
});
