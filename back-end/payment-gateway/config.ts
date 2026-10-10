export interface GatewayConfig {
  environment: "test" | "live";
  database: string;
  publicUrl: string;
  dashboardUrl: string;
  serviceKey: string;
  pepper: string;
  encryptionKey: Buffer;
  fee: {
    version: string;
    basisPoints: number;
  };
  liveEnabled: boolean;
  creationPaused: boolean;
  settlementPaused: boolean;
  billingPaused: boolean;
  merchantPaused: boolean;
  rateLimit: number;
}
function flag(
  values: NodeJS.ProcessEnv,
  name: string,
  fallback = false,
): boolean {
  const value = values[name];
  if (value === undefined || value === "") return fallback;
  if (value !== "true" && value !== "false")
    throw new Error(`${name} must be true or false`);
  return value === "true";
}
function origin(value: string, test: boolean): string {
  const url = new URL(value);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/" ||
    (url.protocol !== "https:" && !(test && local && url.protocol === "http:"))
  ) {
    throw new Error(
      "Gateway URLs must be HTTPS origins; test HTTP is restricted to loopback",
    );
  }
  return url.origin;
}
/** The module shares its host's MongoDB and Redis connections, never a second database. */
export function loadGatewayConfig(
  values: NodeJS.ProcessEnv,
): GatewayConfig | null {
  if (!flag(values, "GATEWAY_ENABLED")) return null;
  const environment = values["GATEWAY_ENVIRONMENT"] ?? "test";
  if (environment !== "test" && environment !== "live")
    throw new Error("GATEWAY_ENVIRONMENT must be test or live");
  // Beta policy: the embedded gateway shares the host's Atlas database
  // (MONGODB_DATABASE, e.g. "louma"). Never rename or repoint the database
  // from env to satisfy the gateway; test/live separation is by the
  // `environment` field and collection data, not by database name.
  // Integration tests still use isolated louma_gateway_test_* databases.
  const database = values["MONGODB_DATABASE"] ?? "";
  if (!database) {
    throw new Error("Gateway requires MONGODB_DATABASE");
  }
  if (values["NODE_ENV"] === "production" && environment !== "live")
    throw new Error("Production requires gateway live mode");
  const serviceKey = values["GATEWAY_SERVICE_KEY"] ?? "";
  const pepper = values["GATEWAY_API_KEY_PEPPER"] ?? "";
  const hex = values["GATEWAY_ENCRYPTION_KEY"] ?? "";
  if (
    Buffer.byteLength(serviceKey) < 32 ||
    Buffer.byteLength(pepper) < 32 ||
    !/^[a-f\d]{64}$/i.test(hex)
  ) {
    throw new Error(
      "Gateway requires generated service key, API key pepper, and 32-byte hex encryption key",
    );
  }
  const encryptionKey = Buffer.from(hex, "hex");
  if (
    serviceKey === pepper ||
    [serviceKey, pepper].some(
      (key) =>
        key.toLowerCase() === hex.toLowerCase() ||
        key === encryptionKey.toString(),
    )
  ) {
    throw new Error("Gateway keys must be separated by purpose");
  }
  if (environment === "live") {
    if (!values["REDIS_URL"])
      throw new Error("Live gateway requires REDIS_URL for shared rate limits");
    if (
      [serviceKey, pepper].some((key) => /^(change-me|replace)/i.test(key)) ||
      encryptionKey.every((value) => value === encryptionKey[0])
    ) {
      throw new Error(
        "Live gateway requires generated secrets, not placeholders",
      );
    }
  }
  const feeRaw = values["GATEWAY_FEE_BASIS_POINTS"] ?? "100";
  const rateRaw = values["GATEWAY_RATE_LIMIT"] ?? "120";
  if (!/^\d{1,4}$/.test(feeRaw) || Number(feeRaw) >= 10000)
    throw new Error("Invalid gateway fee basis points");
  if (!/^\d{1,5}$/.test(rateRaw) || Number(rateRaw) < 1)
    throw new Error("Invalid gateway rate limit");
  const version = values["GATEWAY_FEE_VERSION"] ?? "2026-10-08";
  if (!version || version.length > 40)
    throw new Error("Invalid gateway fee version");
  const liveEnabled = flag(values, "GATEWAY_LIVE_ENABLED");
  const gated = environment === "live" && !liveEnabled;
  return {
    environment,
    database,
    serviceKey,
    pepper,
    encryptionKey,
    publicUrl: origin(
      values["GATEWAY_PUBLIC_URL"] ?? "http://localhost:8000",
      environment === "test",
    ),
    dashboardUrl: origin(
      values["GATEWAY_DASHBOARD_URL"] ?? "http://localhost:3000",
      environment === "test",
    ),
    fee: { version, basisPoints: Number(feeRaw) },
    liveEnabled,
    creationPaused: flag(values, "GATEWAY_CREATION_PAUSED") || gated,
    settlementPaused: flag(values, "GATEWAY_SETTLEMENT_PAUSED") || gated,
    billingPaused: flag(values, "GATEWAY_BILLING_PAUSED") || gated,
    merchantPaused: flag(values, "GATEWAY_MERCHANT_PAUSED"),
    rateLimit: Number(rateRaw),
  };
}
