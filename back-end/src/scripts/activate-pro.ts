import { randomUUID } from "node:crypto";
import dns from "node:dns";
import { connectMongo } from "../infrastructure/mongodb/client.js";
import { getCollections } from "../infrastructure/mongodb/collections.js";
import { ensureSubscriptionStorage } from "../infrastructure/mongodb/subscription-storage.js";
import { grantSubscription } from "../modules/subscriptions/service.js";
import { AppError } from "../shared/errors.js";
import type { SubscriptionPlan } from "../shared/types.js";

async function main() {
  const [email, plan, activationKey = randomUUID()] = process.argv.slice(2);
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !["monthly", "yearly", "lifetime"].includes(plan ?? "")) {
    throw new Error("Use an account email and monthly, yearly, or lifetime.");
  }
  const mongoUri = process.env["MONGODB_URI"];
  const mongoDatabase = process.env["MONGODB_DATABASE"];
  if (!mongoUri || !mongoDatabase) throw new Error("Configure MONGODB_URI and MONGODB_DATABASE in the selected environment file.");
  dns.setServers(["1.1.1.1", "9.9.9.9"]);
  const { client, db } = await connectMongo({ mongoUri, mongoDatabase, mongoConnectTimeoutMs: 5000, mongoServerSelectionTimeoutMs: 15000, mongoMaxPoolSize: 5 });
  try {
    await ensureSubscriptionStorage(db);
    const collections = getCollections(db);
    const user = await collections.users.findOne({ email: email.trim().toLowerCase(), status: "active" }, { projection: { publicId: 1 } });
    if (!user) throw new Error("No active account has that email.");
    const subscription = await grantSubscription({ collections, mongoClient: client, ownerUserId: user.publicId,
      plan: plan as SubscriptionPlan, activationKey, createdBy: "operator:python" });
    console.log(`Pro activated: ${subscription.plan}. Expires: ${subscription.expiresAt ?? "never"}.`);
  } finally { await client.close(); }
}

main().catch((error: unknown) => {
  console.error(error instanceof AppError ? error.message : error instanceof Error && !("code" in error) && !error.name.startsWith("Mongo") ? error.message : "Activation failed. Check database connectivity and retry with the same activation key.");
  process.exitCode = 1;
});
