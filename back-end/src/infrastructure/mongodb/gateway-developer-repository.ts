import type { MongoClient } from "mongodb";

/** Grants are operator-managed; registration and Pro subscriptions never grant payment access. */
export async function hasGatewayDeveloperAccess(input: { mongoClient: MongoClient; database: string; ownerUserId: string }): Promise<boolean> {
  const grant = await input.mongoClient.db(input.database).collection("gateway_developers").findOne(
    { ownerUserId: input.ownerUserId, status: "active" },
    { projection: { _id: 1 } },
  );
  return grant !== null;
}
