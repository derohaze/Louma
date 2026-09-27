import { buildApp } from "./app.js";
import { loadConfig } from "./config/env.js";
import { connectMongo } from "./infrastructure/mongodb/client.js";
import { ensureDatabaseIndexes } from "./infrastructure/mongodb/indexes.js";
import { getCollections } from "./infrastructure/mongodb/collections.js";

const config = loadConfig();
const { client, db } = await connectMongo(config);

try {
  await ensureDatabaseIndexes(db);
  const app = await buildApp({ config, collections: getCollections(db), mongoClient: client });
  const close = async (signal: string) => {
    app.log.info({ signal }, "server_shutdown_started");
    await app.close();
    await client.close();
  };

  process.once("SIGINT", () => void close("SIGINT").then(() => process.exit(0)));
  process.once("SIGTERM", () => void close("SIGTERM").then(() => process.exit(0)));

  if (!config.ipinfoToken) {
    // Degrading quietly would hide that signups are being recorded without a location.
    app.log.warn(
      { variable: "IPINFO_TOKEN" },
      "signup_geolocation_disabled: connecting IPs are still stored, city/country/org stay null",
    );
  }

  await app.listen({ host: config.host, port: config.port });
} catch (error) {
  await client.close();
  throw error;
}
