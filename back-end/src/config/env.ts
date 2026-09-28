export type RuntimeEnvironment = "development" | "test" | "production";
export type CookieSameSite = "lax" | "strict" | "none";
export type LogLevel = "fatal" | "error" | "warn" | "info" | "debug" | "trace" | "silent";

export interface AppConfig {
  environment: RuntimeEnvironment;
  host: string;
  port: number;
  mongoUri: string;
  mongoDatabase: string;
  mongoConnectTimeoutMs: number;
  mongoServerSelectionTimeoutMs: number;
  accessTokenSecret: Buffer;
  encryptionKey: Buffer;
  frontendOrigins: string[];
  cookieSecure: boolean;
  cookieSameSite: CookieSameSite;
  rateLimitMax: number;
  rateLimitWindowMs: number;
  logLevel: LogLevel;
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
    // this component's own configuration file.
    port: positiveInteger("LOUMA_API_PORT", values["LOUMA_API_PORT"] ?? "3001"),
    mongoUri,
    mongoDatabase: required("MONGODB_DATABASE", values),
    mongoConnectTimeoutMs: positiveInteger("MONGODB_CONNECT_TIMEOUT_MS", values["MONGODB_CONNECT_TIMEOUT_MS"] ?? "5000"),
    mongoServerSelectionTimeoutMs: positiveInteger("MONGODB_SERVER_SELECTION_TIMEOUT_MS", values["MONGODB_SERVER_SELECTION_TIMEOUT_MS"] ?? "5000"),
    accessTokenSecret: decodeKey("ACCESS_TOKEN_SECRET", required("ACCESS_TOKEN_SECRET", values)),
    encryptionKey: decodeKey("APP_ENCRYPTION_KEY", required("APP_ENCRYPTION_KEY", values)),
    frontendOrigins: parseOrigins(rawOrigins),
    cookieSecure,
    cookieSameSite: sameSite as CookieSameSite,
    rateLimitMax: positiveInteger("RATE_LIMIT_MAX", values["RATE_LIMIT_MAX"] ?? "120"),
    rateLimitWindowMs: positiveInteger("RATE_LIMIT_WINDOW_MS", values["RATE_LIMIT_WINDOW_MS"] ?? "60000"),
    logLevel: logLevel(values["LOG_LEVEL"] ?? (isProduction ? "info" : "debug")),
    ipinfoToken: optionalString("IPINFO_TOKEN", values),
    ipinfoTimeoutMs: positiveInteger("IPINFO_TIMEOUT_MS", values["IPINFO_TIMEOUT_MS"] ?? "2500"),
    trustProxy: parseTrustedProxies("TRUST_PROXY", values),
  };
}
