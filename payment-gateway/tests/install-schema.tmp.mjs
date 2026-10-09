import { createRequire } from "node:module";
import { schemas } from "../../back-end/src/infrastructure/mongodb/schemas.ts";
import { ensureCollection } from "../../back-end/src/infrastructure/mongodb/validators.ts";
import { ensureDatabaseIndexes } from "../../back-end/src/infrastructure/mongodb/indexes.ts";

const backendRequire = createRequire(new URL("../../back-end/package.json", import.meta.url));
const { MongoClient } = backendRequire("mongodb");
const [, , uri, databaseName] = process.argv;
if (!/^mongodb:\/\/(?:127\.0\.0\.1|localhost|\[::1\]):\d+\/(?:\?[^#]*)?$/.test(uri ?? "")) throw new Error("loopback URI required");
if (!/^louma_gateway_test_[a-zA-Z0-9_]+$/.test(databaseName ?? "")) throw new Error("isolated test database required");
const client = new MongoClient(uri);
try {
  await client.connect();
  const db = client.db(databaseName);
  for (const [name, validator] of Object.entries(schemas)) await ensureCollection(db, name, validator);
  await ensureDatabaseIndexes(db, { retentionTtlEnabled: false });
  process.stdout.write("node schema installed\n");
} finally {
  await client.close();
}
