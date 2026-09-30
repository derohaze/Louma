export type RuntimeEnvironment = "development" | "test" | "production";
export type CookieSameSite = "lax" | "strict" | "none";
export type LogLevel = "fatal" | "error" | "warn" | "info" | "debug" | "trace" | "silent";

/**
 * The range a mining cycle's rate is drawn from, held as exact integers rather than decimals.
 *
 * A rate is an amount of LMA per hour, and money in this codebase is never a float. The range is
 * therefore expressed in rate units: `1 / scale` LMA per hour, where `scale` is `10 ** decimals`.
 * A cycle's rate is one integer in `[minUnits, maxUnits]`, which makes it exact, comparable, and
 * safe to persist — no rounding creeps in between the draw, the database, and the accrued reward.
 */
export interface MiningRateSpec {
  minUnits: number;
  maxUnits: number;
  /** Units per LMA/hour: `10 ** decimals`. */
  scale: number;
  /** Decimal places a drawn rate carries; the unit of `minUnits` and `maxUnits`. */
  decimals: number;
}

export interface MiningConfig {
  enabled: boolean;
  settlementEnabled: boolean;
  /** Fixed length of a cycle. The product is a 24-hour cycle, so this is validated, not merely read. */
  cycleDurationSeconds: number;
  /** The product allows one live cycle per account; the database enforces it as well. */
  maxActiveCyclesPerUser: number;
  rate: MiningRateSpec;
}

export interface AppConfig {
  environment: RuntimeEnvironment;
  host: string;
  port: number;
  mongoUri: string;
  mongoDatabase: string;
  mongoConnectTimeoutMs: number;
  mongoServerSelectionTimeoutMs: number;
  /**
   * Connections one API process keeps open to the cluster.
   *
   * Sized per process, and the fleet multiplies it: twenty processes of twenty is four hundred
   * connections, which is the number the cluster's own connection limit has to be planned against.
   * It is configuration rather than a constant because the right value is a property of the database
   * and the workload, and it is exactly the knob a capacity measurement tunes.
   */
  mongoMaxPoolSize: number;
  accessTokenSecret: Buffer;
  encryptionKey: Buffer;
  frontendOrigins: string[];
  cookieSecure: boolean;
  cookieSameSite: CookieSameSite;
  rateLimitMax: number;
  rateLimitWindowMs: number;
  logLevel: LogLevel;
  /**
   * Whether startup may create the retention TTL indexes on notifications and security events.
   * Off by default: enabling deletion of customer-visible history is an explicit rollout decision
   * (see ensureDatabaseIndexes), not something a fresh boot should do on its own.
   */
  retentionTtlEnabled: boolean;
  /** ipinfo.io token for signup geolocation. Null disables the lookup; the IP itself is still stored. */
  ipinfoToken: string | null;
  ipinfoTimeoutMs: number;
  /**
   * The proxies whose `X-Forwarded-*` headers may be believed, by address or CIDR, or false when the
   * API terminates connections itself. A trusted *proxy*, never "any": believing every hop lets a
   * client prepend an address to `X-Forwarded-For` and choose the one the API stores at registration
   * and rate-limits by.
   */
  trustProxy: boolean | string[];
  mining: MiningConfig;
}

function required(name: string, values: NodeJS.ProcessEnv): string {
  const value = values[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function positiveInteger(name: string, raw: string, minimum = 1): number {
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new Error(`Invalid environment variable: ${name}`);
  }
  return value;
}

function optionalString(name: string, values: NodeJS.ProcessEnv): string | null {
  const value = values[name]?.trim();
  return value ? value : null;
}

function decodeKey(name: string, raw: string): Buffer {
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32 || key.toString("base64") !== raw) {
    throw new Error(`${name} must be a base64-encoded 32-byte key`);
  }
  return key;
}

function parseOrigins(raw: string): string[] {
  const origins = raw.split(",").map((origin) => origin.trim()).filter(Boolean);
  if (origins.length === 0) throw new Error("At least one FRONTEND_ORIGINS value is required");

  return origins.map((origin) => {
    let parsed: URL;
    try {
      parsed = new URL(origin);
    } catch {
      throw new Error("FRONTEND_ORIGINS must contain absolute origins");
    }
    if (parsed.origin !== origin || !["http:", "https:"].includes(parsed.protocol)) {
      throw new Error("FRONTEND_ORIGINS must contain origins without paths or credentials");
    }
    return origin;
  });
}

/**
 * Parses the trusted-proxy list. Only specific proxies may be named: `true` and `*` mean "believe
 * every hop", which is exactly the setting a client can forge, so they are rejected rather than
 * silently reinterpreted. An empty value disables proxy trust, which is the safe default.
 */
function parseTrustedProxies(name: string, values: NodeJS.ProcessEnv): boolean | string[] {
  const raw = values[name]?.trim();
  if (!raw || raw === "false") return false;
  if (raw === "true" || raw === "*") {
    throw new Error(`${name} must name the proxy addresses or CIDRs (for example 10.0.0.0/8), not every hop`);
  }
  const proxies = raw.split(",").map((entry) => entry.trim()).filter(Boolean);
  if (proxies.length === 0) return false;
  for (const proxy of proxies) {
    if (!/^[0-9a-fA-F:.]+(\/\d{1,3})?$/.test(proxy)) throw new Error(`${name} must contain only IP addresses or CIDRs`);
    // A `/0` prefix covers the whole address space, so `0.0.0.0/0` and `::/0` are `*` spelled out —
    // every peer trusted, and therefore an `X-Forwarded-For` a client can forge. They are refused
    // here for the same reason `true` and `*` are.
    const prefix = proxy.includes("/") ? Number(proxy.slice(proxy.indexOf("/") + 1)) : -1;
    if (prefix === 0) {
      throw new Error(`${name} must not trust every hop: ${proxy} covers the whole address space`);
    }
  }
  return proxies;
}

function logLevel(raw: string): LogLevel {
  const allowed: LogLevel[] = ["fatal", "error", "warn", "info", "debug", "trace", "silent"];
  if (!allowed.includes(raw as LogLevel)) throw new Error("Invalid LOG_LEVEL");
  return raw as LogLevel;
}

/** The product's mining cycle is 24 hours; a deployment may not lengthen or shorten it. */
const MINING_CYCLE_SECONDS = 24 * 60 * 60;
/**
 * Upper bound on rate precision. Reward arithmetic is exact integer math, so the limit exists only
 * to keep the drawn rate inside the safe-integer range and the PERSISTED document readable — not
 * because the arithmetic would round.
 */
const MINING_MAX_RATE_DECIMALS = 8;

function booleanFlag(name: string, raw: string | undefined, fallback: boolean): boolean {
  const value = raw?.trim();
  if (value === undefined || value === "") return fallback;
  if (value !== "true" && value !== "false") throw new Error(`${name} must be true or false`);
  return value === "true";
}

/**
 * Parses a decimal LMA/hour rate into exact rate units.
 *
 * Precision is enforced rather than rounded: a value carrying more decimal places than
 * `MINING_RATE_DECIMALS` is rejected, so an operator who writes `0.03751` under a 4-decimal setting
 * is told the setting cannot represent it instead of silently having it truncated. Trailing zeroes
 * within the configured precision are accepted.
 */
function rateUnits(name: string, raw: string, decimals: number): number {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(raw.trim());
  if (!match) throw new Error(`${name} must be a non-negative decimal number`);
  const fraction = match[2] ?? "";
  if (fraction.length > decimals) {
    throw new Error(`${name} has more decimal places than MINING_RATE_DECIMALS (${decimals}) can represent`);
  }
  const units = Number(match[1]) * 10 ** decimals + Number(fraction.padEnd(decimals, "0"));
  if (!Number.isSafeInteger(units) || units <= 0) {
    throw new Error(`${name} must be a positive value within the safe integer range`);
  }
  return units;
}

function loadMiningConfig(values: NodeJS.ProcessEnv): MiningConfig {
  const enabled = booleanFlag("MINING_ENABLED", values["MINING_ENABLED"], true);
  const settlementEnabled = booleanFlag("MINING_SETTLEMENT_ENABLED", values["MINING_SETTLEMENT_ENABLED"], true);

  const cycleDurationSeconds = positiveInteger(
    "MINING_CYCLE_DURATION_SECONDS",
    values["MINING_CYCLE_DURATION_SECONDS"] ?? String(MINING_CYCLE_SECONDS),
  );
  if (cycleDurationSeconds !== MINING_CYCLE_SECONDS) {
    throw new Error(`MINING_CYCLE_DURATION_SECONDS must be exactly ${MINING_CYCLE_SECONDS} (24 hours)`);
  }

  const maxActiveCyclesPerUser = positiveInteger(
    "MINING_MAX_ACTIVE_CYCLES_PER_USER",
    values["MINING_MAX_ACTIVE_CYCLES_PER_USER"] ?? "1",
  );
  if (maxActiveCyclesPerUser !== 1) {
    throw new Error("MINING_MAX_ACTIVE_CYCLES_PER_USER must be 1: the product runs one cycle per account");
  }

  const decimals = positiveInteger("MINING_RATE_DECIMALS", values["MINING_RATE_DECIMALS"] ?? "6");
  if (decimals > MINING_MAX_RATE_DECIMALS) {
    throw new Error(`MINING_RATE_DECIMALS must be at most ${MINING_MAX_RATE_DECIMALS}`);
  }
  const minUnits = rateUnits("MINING_RATE_MIN_LMA_PER_HOUR", values["MINING_RATE_MIN_LMA_PER_HOUR"] ?? "0.0100", decimals);
  const maxUnits = rateUnits("MINING_RATE_MAX_LMA_PER_HOUR", values["MINING_RATE_MAX_LMA_PER_HOUR"] ?? "0.0500", decimals);
  if (minUnits > maxUnits) {
    throw new Error("MINING_RATE_MIN_LMA_PER_HOUR must not exceed MINING_RATE_MAX_LMA_PER_HOUR");
  }

  return {
    enabled,
    settlementEnabled,
    cycleDurationSeconds,
    maxActiveCyclesPerUser,
    rate: { minUnits, maxUnits, scale: 10 ** decimals, decimals },
  };
}

export function loadConfig(values: NodeJS.ProcessEnv = process.env): AppConfig {
  const environment = values["NODE_ENV"] ?? "development";
  if (!["development", "test", "production"].includes(environment)) {
    throw new Error("NODE_ENV must be development, test, or production");
  }

  const mongoUri = required("MONGODB_URI", values);
  if (!mongoUri.startsWith("mongodb://") && !mongoUri.startsWith("mongodb+srv://")) {
    throw new Error("MONGODB_URI must use the mongodb or mongodb+srv scheme");
  }

  const sameSite = values["COOKIE_SAME_SITE"] ?? "lax";
  if (!["lax", "strict", "none"].includes(sameSite)) {
    throw new Error("COOKIE_SAME_SITE must be lax, strict, or none");
  }

  const isProduction = environment === "production";
  const cookieSecure = values["COOKIE_SECURE"] === undefined
    ? isProduction
    : values["COOKIE_SECURE"] === "true";
  if (isProduction && !cookieSecure) throw new Error("COOKIE_SECURE must be true in production");
  if (sameSite === "none" && !cookieSecure) {
    throw new Error("COOKIE_SECURE=true is required with COOKIE_SAME_SITE=none");
  }

  const rawOrigins = values["FRONTEND_ORIGINS"] ?? (isProduction ? "" : "http://localhost:5173");
  if (isProduction && !rawOrigins) {
    throw new Error("Missing required environment variable: FRONTEND_ORIGINS");
  }

  return {
    environment: environment as RuntimeEnvironment,
    host: values["HOST"] ?? "127.0.0.1",
    // Not `PORT`: that name is commonly exported by unrelated tools in the same shell, and
    // `node --env-file` never overrides an inherited variable, so a stray value would win over
    // this component's own configuration file. The fallback matches the frontend dev proxy default
    // so a backend started without its environment file still answers where the proxy sends `/api`.
    port: positiveInteger("LOUMA_API_PORT", values["LOUMA_API_PORT"] ?? "8000"),
    mongoUri,
    mongoDatabase: required("MONGODB_DATABASE", values),
    mongoConnectTimeoutMs: positiveInteger("MONGODB_CONNECT_TIMEOUT_MS", values["MONGODB_CONNECT_TIMEOUT_MS"] ?? "5000"),
    mongoServerSelectionTimeoutMs: positiveInteger("MONGODB_SERVER_SELECTION_TIMEOUT_MS", values["MONGODB_SERVER_SELECTION_TIMEOUT_MS"] ?? "5000"),
    mongoMaxPoolSize: positiveInteger("MONGODB_MAX_POOL_SIZE", values["MONGODB_MAX_POOL_SIZE"] ?? "20"),
    accessTokenSecret: decodeKey("ACCESS_TOKEN_SECRET", required("ACCESS_TOKEN_SECRET", values)),
    encryptionKey: decodeKey("APP_ENCRYPTION_KEY", required("APP_ENCRYPTION_KEY", values)),
    frontendOrigins: parseOrigins(rawOrigins),
    cookieSecure,
    cookieSameSite: sameSite as CookieSameSite,
    rateLimitMax: positiveInteger("RATE_LIMIT_MAX", values["RATE_LIMIT_MAX"] ?? "120"),
    rateLimitWindowMs: positiveInteger("RATE_LIMIT_WINDOW_MS", values["RATE_LIMIT_WINDOW_MS"] ?? "60000"),
    logLevel: logLevel(values["LOG_LEVEL"] ?? (isProduction ? "info" : "debug")),
    retentionTtlEnabled: (values["RETENTION_TTL_ENABLED"] ?? "false").trim() === "true",
    ipinfoToken: optionalString("IPINFO_TOKEN", values),
    ipinfoTimeoutMs: positiveInteger("IPINFO_TIMEOUT_MS", values["IPINFO_TIMEOUT_MS"] ?? "2500"),
    trustProxy: parseTrustedProxies("TRUST_PROXY", values),
    mining: loadMiningConfig(values),
  };
}
