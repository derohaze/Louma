import type { FastifyInstance } from "fastify";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerAccountRoutes } from "./routes/account.js";
import { registerTransferRoutes } from "./routes/transfers.js";
import { registerMiningRoutes } from "./routes/mining.js";
import { registerMiningDeviceRoutes } from "./routes/mining-device.js";
import { registerSecurityRoutes } from "./routes/security.js";
import { registerNotificationRoutes } from "./routes/notifications.js";

/**
 * Customer API route composer.
 *
 * One group per business capability (mirrors `features/` on the frontend); shared
 * schemas and guards live in `schemas.ts` / `http-helpers.ts` (mirrors `shared/`).
 * Groups register in dependency-free order: auth first (sessions), reads last.
 */
export async function registerCustomerRoutes(app: FastifyInstance): Promise<void> {
  await registerAuthRoutes(app);
  await registerAccountRoutes(app);
  await registerTransferRoutes(app);
  await registerMiningRoutes(app);
  await registerMiningDeviceRoutes(app);
  await registerSecurityRoutes(app);
  await registerNotificationRoutes(app);
}
