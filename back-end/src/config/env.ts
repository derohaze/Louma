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
  };
}
