import { LEDGER_AMOUNT_MAX_MINOR, MONEY_SCALE } from "../shared/types.js";
import { loadPaymentGatewayConfig, type PaymentGatewayConfig } from "../modules/payment-gateway/config.js";
import { loadGatewayConfig, type GatewayConfig } from "../../payment-gateway/config.js";

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

/**
 * One system mining pool, fully described by the environment.
 *
 * `baseHashrate` is the pool's power in H, split across its members for display
 * (`baseHashrate / activeMiners`). The reward factor is drawn per cycle in
 * `[rewardMinBps, rewardMaxBps]` basis points (10000 = 1.0x) and multiplies the
 * server-drawn base rate — bounded variance around the same average, never issuance.
 * `maxMembers` caps the room: a full pool refuses joins until someone leaves.
 */
export interface MiningPoolSpec {
  baseHashrate: number;
  rewardMinBps: number;
  rewardMaxBps: number;
  maxMembers: number;
}

export interface MiningPoolsConfig {
  low: MiningPoolSpec;
  medium: MiningPoolSpec;
  /**
   * How long a joined room is held before a cycle starts, and each time a cycle is created.
   *
   * A room is a *hold*, not a permanent membership: joining grants the room for this long, a start
   * extends it to the cycle's end, and the hold ends (releasing the room) the moment the cycle
   * ends. The grace exists so the join -> start step of one person is never a race.
   */
  holdSeconds: number;
  /**
   * Minimum time between two room changes (a join or switch to a different room). The cooldown is
   * anchored on the account's last membership write, so churn between rooms is bounded while
   * continuing in the same room — the normal stop/resume loop — is never throttled.
   */
  switchCooldownSeconds: number;
}

export type LmdgRiskMode = "monitor" | "challenge" | "enforce";

export interface LmdgConfig {
  identityMode: "browser" | "strict" | "legacy-test";
  enabled: boolean;
  leaseEnabled: boolean;
  highConfidenceThreshold: number;
  ambiguousThreshold: number;
  observationTtlSeconds: number;
  ipIntelTtlSeconds: number;
  browserKeyRequired: boolean;
  riskMode: LmdgRiskMode;
  challengeTtlSeconds: number;
  nonceTtlSeconds: number;
  /**
   * Enrollment controls: identity creation is a budgeted, server-side transition, not a
   * consequence of a syntactically valid payload. All four limits are consumed atomically and are
   * deliberately far above what one real person needs — they bound abuse churn, not normal use.
   *
   * `LMDG_ENROLLMENT_ENABLED=false` is the operational escape hatch: it restores the older
   * create-on-first-sight behaviour while leaving the rest of the guard in place.
   */
  enrollmentEnabled: boolean;
  /** New device clusters one account may enroll per rolling 24h. */
  maxNewClustersPerAccountPerDay: number;
  /**
   * New device clusters one network context (server-observed IP) may enroll per rolling hour.
   *
   * Sized for a *shared* address, not for one person: a NAT or carrier-grade NAT puts many
   * unrelated customers behind one observed IP, so a bound tuned to one person's habits refuses
   * honest first-time users as if they were churn (see `loadLmdgConfig`). The per-account budget
   * stays the per-person limit.
   */
  maxNewClustersPerNetworkPerHour: number;
  /** New device clusters one network context may enroll per rolling 24h. Same shared-address sizing. */
  maxNewClustersPerNetworkPerDay: number;
  /**
   * When a network context already holds another account's live mining lease, a cluster that has not
   * earned trust *on that network* is refused; neither a proof of possession nor a global
   * `established` state clears it. The only exemption is server-owned, network-scoped and fresh
   * credited activity — see `networkTrustFreshnessSeconds`. This is the rule that stops "same
   * network, freshly minted second identity" without locking out a device that has already mined
   * here.
   */
  networkLeaseLock: boolean;
  /** Allowed admissions (or bound proofs) a cluster needs before it becomes `established`. */
  establishMinAdmissions: number;
  /**
   * How long credited activity on one network keeps a cluster's exemption from the network lock.
   *
   * Trust is bound to the network it was earned on *and* to time: a cluster is a resident of a
    * network only while it has mined there recently. The window must cover one mining cycle plus
    * settlement and restart grace — the floor is 48 hours — or an available device would lose its
    * own exemption between cycles and be refused beside another account's lease until the network
    * went vacant again.
   */
  networkTrustFreshnessSeconds: number;
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
   * proxycheck.io key for MINING-path IP intelligence only (VPN/proxy/Tor/hosting + ASN/country).
   * Signup geolocation stays on ipinfo. Null disables the lookup; LMDG degrades to cached or
   * unknown network signals and mining keeps working.
   */
  proxycheckKey: string | null;
  proxycheckTimeoutMs: number;
  /**
   * Reserved for proxycheck callback payload verification if that integration is ever enabled.
   * Stored, never logged, currently unused by the pull queries LMDG performs.
   */
  proxycheckHmacKey: string | null;
  /**
   * The proxies whose `X-Forwarded-*` headers may be believed, by address or CIDR, or false when the
   * API terminates connections itself. A trusted *proxy*, never "any": believing every hop lets a
   * client prepend an address to `X-Forwarded-For` and choose the one the API stores at registration
   * and rate-limits by.
   */
  trustProxy: boolean | string[];
  /**
   * Shared secret the first-party frontend proxy uses to assert the real client IP.
   *
   * The API sits behind Cloudflare and the browser never talks to it directly: the page calls its
   * own origin, whose server forwards to the API. By the time the request arrives, `request.ip` is a
   * Cloudflare edge (or Vercel egress) address shared by many users — useless for the per-IP login
   * throttle and the stored signup IP. The proxy therefore stamps the connecting IP it saw into
   * `x-louma-client-ip`, and this secret authenticates that stamp. Null disables the header entirely
   * and every consumer falls back to `request.ip`.
   */
  proxySharedSecret: string | null;
  redis: RedisConfig;
  mining: MiningConfig;
  miningPools: MiningPoolsConfig;
  lmdg: LmdgConfig;
  paymentGateway: PaymentGatewayConfig;
  embeddedGateway: GatewayConfig | null;
}

/**
 * Redis-backed ephemeral infrastructure: cache-aside reads, distributed rate limits, and
 * short-lived coordination. Every field degrades, never governs: Redis is absent by default
 * (`REDIS_URL` unset) and the application stays financially correct without it — MongoDB alone
 * remains the authority for money, and every Redis consumer treats an outage as a cache miss
 * (see docs/redis.md and ADR-002). No secrets, credentials, or plaintext key material may ever
 * be cached; only derived, rebuildable read models.
 */
export interface RedisConfig {
  /** Null disables Redis: the application runs MongoDB-only with in-process fallbacks. */
  url: string | null;
  /** Key namespace prefix; every key the application writes starts with it. */
  keyPrefix: string;
  connectTimeoutMs: number;
  commandTimeoutMs: number;
  /** Mining-settings cache TTL: operator changes propagate within this window at most. */
  miningSettingsCacheTtlSeconds: number;
  /** Pool-membership cache TTL: join/leave invalidates eagerly, this bounds staleness. */
  poolMembershipCacheTtlSeconds: number;
  /** Recipient display-name cache TTL for the transfer preview masking. */
  displayNameCacheTtlSeconds: number;
  /** Distributed per-account limit: transfer previews per minute (fail-open). */
  transferPreviewMaxPerMinute: number;
  /** Distributed per-account limit: mining starts per minute (fail-open). */
  miningStartMaxPerMinute: number;
  /** Distributed per-IP limit: login attempts per minute (fail-open with local fallback). */
  loginMaxPerMinute: number;
}

/**
 * Reads the Redis settings alone, so an operational script (mining-settings) can construct the
 * same handle the API uses for cache invalidation without requiring the API's secrets
 * (ACCESS_TOKEN_SECRET, APP_ENCRYPTION_KEY, FRONTEND_ORIGINS) on the host.
 */
export function loadRedisConfig(values: NodeJS.ProcessEnv): RedisConfig {
  const url = optionalString("REDIS_URL", values);
  if (url !== null && !url.startsWith("redis://") && !url.startsWith("rediss://")) {
    throw new Error("REDIS_URL must use the redis or rediss scheme");
  }
  const keyPrefix = (values["REDIS_KEY_PREFIX"] ?? "louma").trim() || "louma";
  if (!/^[a-z0-9_-]{1,32}$/.test(keyPrefix)) {
    throw new Error("REDIS_KEY_PREFIX must be 1..32 lowercase letters, digits, '-' or '_'");
  }
  return {
    url,
    keyPrefix,
    connectTimeoutMs: positiveInteger("REDIS_CONNECT_TIMEOUT_MS", values["REDIS_CONNECT_TIMEOUT_MS"] ?? "2000"),
    commandTimeoutMs: positiveInteger("REDIS_COMMAND_TIMEOUT_MS", values["REDIS_COMMAND_TIMEOUT_MS"] ?? "1000"),
    miningSettingsCacheTtlSeconds: positiveInteger("REDIS_MINING_SETTINGS_TTL_SECONDS", values["REDIS_MINING_SETTINGS_TTL_SECONDS"] ?? "30"),
    poolMembershipCacheTtlSeconds: positiveInteger("REDIS_POOL_MEMBERSHIP_TTL_SECONDS", values["REDIS_POOL_MEMBERSHIP_TTL_SECONDS"] ?? "60"),
    displayNameCacheTtlSeconds: positiveInteger("REDIS_DISPLAY_NAME_TTL_SECONDS", values["REDIS_DISPLAY_NAME_TTL_SECONDS"] ?? "300"),
    transferPreviewMaxPerMinute: positiveInteger("REDIS_LIMIT_TRANSFER_PREVIEW_PER_MINUTE", values["REDIS_LIMIT_TRANSFER_PREVIEW_PER_MINUTE"] ?? "30"),
    miningStartMaxPerMinute: positiveInteger("REDIS_LIMIT_MINING_START_PER_MINUTE", values["REDIS_LIMIT_MINING_START_PER_MINUTE"] ?? "10"),
    loginMaxPerMinute: positiveInteger("REDIS_LIMIT_LOGIN_PER_MINUTE", values["REDIS_LIMIT_LOGIN_PER_MINUTE"] ?? "10"),
  };
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

/**
 * Reads the secret that authenticates the first-party proxy's client-IP stamp.
 *
 * Empty means the deployment has no proxy asserting IPs, so the header is never trusted. A short
 * value is refused at boot rather than silently accepted: a guessable secret would let any direct
 * caller choose the IP the login throttle counts and the signup row stores.
 */
function parseProxySharedSecret(values: NodeJS.ProcessEnv): string | null {
  const raw = values["PROXY_SHARED_SECRET"]?.trim();
  if (!raw) return null;
  if (raw.length < 16) throw new Error("PROXY_SHARED_SECRET must be at least 16 characters");
  return raw;
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
  // The hourly rate alone is not the bound that matters: a settlement posts up to the FULL 24-hour
  // accrual in ledger lines, and every money integer must stay inside the exact-integer range.
  // Without this check an operator could configure a rate whose daily total overflows safe-integer
  // arithmetic — creating cycles that can never settle and can never be replaced while active.
  const scale = 10 ** decimals;
  const maxTotalMinor = (BigInt(maxUnits) * BigInt(MONEY_SCALE) * BigInt(MINING_CYCLE_SECONDS)) / (BigInt(scale) * 3600n);
  if (maxTotalMinor < 1n || maxTotalMinor > BigInt(LEDGER_AMOUNT_MAX_MINOR)) {
    throw new Error("MINING_RATE_MAX_LMA_PER_HOUR is too large: its 24-hour total must fit in one ledger movement");
  }

  return {
    enabled,
    settlementEnabled,
    cycleDurationSeconds,
    maxActiveCyclesPerUser,
    rate: { minUnits, maxUnits, scale, decimals },
  };
}

/** Parses one pool's room settings (`PREFIX_BASE_HASHRATE`, `PREFIX_REWARD_MIN/MAX_BPS`, `PREFIX_MAX_MEMBERS`). */
function loadMiningPoolSpec(values: NodeJS.ProcessEnv, prefix: string, defaultMinBps: number, defaultMaxBps: number): MiningPoolSpec {
  const baseHashrate = positiveInteger(`${prefix}_BASE_HASHRATE`, values[`${prefix}_BASE_HASHRATE`] ?? "100");
  const rewardMinBps = positiveInteger(`${prefix}_REWARD_MIN_BPS`, values[`${prefix}_REWARD_MIN_BPS`] ?? String(defaultMinBps));
  const rewardMaxBps = positiveInteger(`${prefix}_REWARD_MAX_BPS`, values[`${prefix}_REWARD_MAX_BPS`] ?? String(defaultMaxBps));
  // Basis points are a multiplier on the base rate: 10000 = 1.0x. The ceiling (5x) only has to
  // keep the scaled rate inside the ledger's exact-integer range — the start path re-checks the
  // 24-hour total before opening a cycle, so an oversized factor fails the start, never the ledger.
  for (const [name, bps] of [[`${prefix}_REWARD_MIN_BPS`, rewardMinBps], [`${prefix}_REWARD_MAX_BPS`, rewardMaxBps]] as const) {
    if (bps > 50_000) throw new Error(`${name} must be at most 50000 (5.0x)`);
  }
  if (rewardMinBps > rewardMaxBps) {
    throw new Error(`${prefix}_REWARD_MIN_BPS must not exceed ${prefix}_REWARD_MAX_BPS`);
  }
  if (rewardMinBps > 10_000 || rewardMaxBps < 10_000) {
    throw new Error(`${prefix}_REWARD band must include 10000 (1.0x) so pool choice changes variance, not average issuance`);
  }
  if (rewardMinBps + rewardMaxBps !== 20_000) {
    throw new Error(`${prefix}_REWARD band must average 10000 (1.0x) so pool choice changes variance, not average issuance`);
  }
  const maxMembers = positiveInteger(`${prefix}_MAX_MEMBERS`, values[`${prefix}_MAX_MEMBERS`] ?? "1000");
  return { baseHashrate, rewardMinBps, rewardMaxBps, maxMembers };
}

function loadMiningPoolsConfig(values: NodeJS.ProcessEnv): MiningPoolsConfig {
  return {
    low: loadMiningPoolSpec(values, "MINING_POOL_LOW", 8500, 11500),
    medium: loadMiningPoolSpec(values, "MINING_POOL_MEDIUM", 7000, 13000),
    // Ten minutes to press Start, and one room change per fifteen minutes: long enough that a
    // person moving between rooms is never surprised, short enough to bound churn.
    holdSeconds: positiveInteger("MINING_POOL_HOLD_SECONDS", values["MINING_POOL_HOLD_SECONDS"] ?? "600"),
    switchCooldownSeconds: positiveInteger("MINING_POOL_SWITCH_COOLDOWN_SECONDS", values["MINING_POOL_SWITCH_COOLDOWN_SECONDS"] ?? "900"),
  };
}

function loadLmdgConfig(values: NodeJS.ProcessEnv): LmdgConfig {
  const identityMode = values["LMDG_IDENTITY_MODE"] ?? "browser";
  if (identityMode !== "browser" && identityMode !== "strict") throw new Error("LMDG_IDENTITY_MODE must be browser or strict");
  const legacyTest = booleanFlag("LMDG_TEST_LEGACY_IDENTITY", values["LMDG_TEST_LEGACY_IDENTITY"], false);
  if (legacyTest && (values["NODE_ENV"] !== "test" ||
      !/^mongodb:\/\/127\.0\.0\.1:\d+\/\?replicaSet=louma_audit$/.test(values["MONGODB_URI"] ?? "") ||
      !/^louma_(?:mining_)?audit_[a-f0-9]{32}$/.test(values["MONGODB_DATABASE"] ?? ""))) {
    throw new Error("LMDG_TEST_LEGACY_IDENTITY is restricted to the isolated loopback audit runner");
  }
  const enabled = booleanFlag("LMDG_ENABLED", values["LMDG_ENABLED"], true);
  const leaseEnabled = booleanFlag("LMDG_DEVICE_LEASE_ENABLED", values["LMDG_DEVICE_LEASE_ENABLED"], true);
  const high = Number(values["LMDG_HIGH_CONFIDENCE_MATCH_THRESHOLD"] ?? "78");
  const ambiguous = Number(values["LMDG_AMBIGUOUS_MATCH_THRESHOLD"] ?? "55");
  if (!Number.isFinite(high) || high < 50 || high > 100) throw new Error("LMDG_HIGH_CONFIDENCE_MATCH_THRESHOLD must be 50..100");
  if (!Number.isFinite(ambiguous) || ambiguous < 20 || ambiguous >= high) throw new Error("LMDG_AMBIGUOUS_MATCH_THRESHOLD must be 20..high-1");
  // The device and account risk checks read a 30-day history window: a shorter observation
  // retention would silently undercount prior activity and lower risk scores, so the floor is the
  // window the engine reasons over, not an arbitrary duration.
  //
  // An installation that configured a *valid* value under the old range (say seven days) must not
  // fail to boot because the floor moved: the configured value is raised to the floor with a
  // warning instead, so the effective retention is the one the engine can reason over and the
  // operator is told exactly what changed. The value is still validated (a positive integer).
  const configuredObservationTtlSeconds = positiveInteger(
    "LMDG_DEVICE_OBSERVATION_TTL_SECONDS",
    values["LMDG_DEVICE_OBSERVATION_TTL_SECONDS"] ?? String(90 * 24 * 60 * 60),
  );
  const observationTtlSecondsFloor = 30 * 24 * 60 * 60;
  const observationTtlSeconds = Math.max(configuredObservationTtlSeconds, observationTtlSecondsFloor);
  if (observationTtlSeconds !== configuredObservationTtlSeconds) {
    console.warn(
      `LMDG_DEVICE_OBSERVATION_TTL_SECONDS=${configuredObservationTtlSeconds} is below the ${observationTtlSecondsFloor}-second history window the risk engine reads; using ${observationTtlSeconds} so prior device activity is not silently undercounted.`,
    );
  }
  const ipIntelTtlSeconds = positiveInteger("LMDG_IP_INTELLIGENCE_TTL_SECONDS", values["LMDG_IP_INTELLIGENCE_TTL_SECONDS"] ?? String(24 * 60 * 60), 300);
  const browserKeyRequired = booleanFlag("LMDG_BROWSER_KEY_REQUIRED", values["LMDG_BROWSER_KEY_REQUIRED"], false);
  const rawMode = (values["LMDG_RISK_MODE"] ?? "enforce").trim();
  if (rawMode !== "monitor" && rawMode !== "challenge" && rawMode !== "enforce") throw new Error("LMDG_RISK_MODE must be monitor, challenge, or enforce");
  const enrollmentEnabled = booleanFlag("LMDG_ENROLLMENT_ENABLED", values["LMDG_ENROLLMENT_ENABLED"], true);
  const maxNewClustersPerAccountPerDay = positiveInteger("LMDG_MAX_NEW_CLUSTERS_PER_ACCOUNT_PER_DAY", values["LMDG_MAX_NEW_CLUSTERS_PER_ACCOUNT_PER_DAY"] ?? "3", 1);
  // The network-scoped counters are both a churn backstop and the *only* bound on one machine
  // multiplying its mining allowance by editing hardware slots — they have to do two jobs, and their
  // magnitude is the balance between them.
  //
  // They are not a per-person limit: an address is shared, and behind a NAT or a carrier-grade NAT
  // many unrelated customers arrive from one observed IP. The measured legitimate demand of one
  // address is small and bursty (the suites and probes mine ten machines from one IP in a run), so
  // the hour cap keeps a 2x headroom over that and the day cap a 4x one.
  //
  // They are the allowance bound because a *fresh* device allowance always costs a new machine
  // identity (an existing machine returning after its window closed opens the next window on its
  // own anchor and spends nothing here), and no similarity rule can see an identity that moved three
  // or more of the six engine-stable slots: measured, such an observation is `different` from the
  // machine it was copied from on every signal the server has, exactly like an unrelated machine
  // (see docs/mining-device-privacy-verification.md, sixth pass). So the step between one address
  // and the next machine identity is the fixed point of the whole swap: 20 identities an hour and
  // 40 a day bound one network to 40 fresh device allowances a day, where the shared 10h device
  // quota wants one. Lowering them further trades honest NATs for margin; raising them reopens the
  // multiplication, which is why they stay real, tunable bounds.
  const maxNewClustersPerNetworkPerHour = positiveInteger("LMDG_MAX_NEW_CLUSTERS_PER_NETWORK_PER_HOUR", values["LMDG_MAX_NEW_CLUSTERS_PER_NETWORK_PER_HOUR"] ?? "20", 1);
  const maxNewClustersPerNetworkPerDay = positiveInteger("LMDG_MAX_NEW_CLUSTERS_PER_NETWORK_PER_DAY", values["LMDG_MAX_NEW_CLUSTERS_PER_NETWORK_PER_DAY"] ?? "40", 1);
  if (maxNewClustersPerNetworkPerDay < maxNewClustersPerNetworkPerHour) {
    throw new Error("LMDG_MAX_NEW_CLUSTERS_PER_NETWORK_PER_DAY must be at least LMDG_MAX_NEW_CLUSTERS_PER_NETWORK_PER_HOUR");
  }
  const networkLeaseLock = booleanFlag("LMDG_NETWORK_LEASE_LOCK", values["LMDG_NETWORK_LEASE_LOCK"], true);
  const establishMinAdmissions = positiveInteger("LMDG_ESTABLISH_MIN_ADMISSIONS", values["LMDG_ESTABLISH_MIN_ADMISSIONS"] ?? "3", 2);
  // The floor covers one full mining cycle plus settlement and restart grace: a cycle runs exactly
  // 24 hours, and the next start always lands after that (settlement, then a later start), so a
  // 24-hour window would expire a resident device's exemption just before its next start beside
  // another account's lease. An installation that configured a shorter window (valid under the
  // previous range) is raised to the floor with a warning instead of failing to boot — the same
  // migration path the observation TTL uses.
  const configuredNetworkTrustFreshnessSeconds = positiveInteger(
    "LMDG_NETWORK_TRUST_FRESHNESS_SECONDS",
    values["LMDG_NETWORK_TRUST_FRESHNESS_SECONDS"] ?? String(3 * 24 * 60 * 60),
  );
  const networkTrustFreshnessFloorSeconds = 48 * 60 * 60;
  const networkTrustFreshnessSeconds = Math.max(configuredNetworkTrustFreshnessSeconds, networkTrustFreshnessFloorSeconds);
  if (networkTrustFreshnessSeconds !== configuredNetworkTrustFreshnessSeconds) {
    console.warn(
      `LMDG_NETWORK_TRUST_FRESHNESS_SECONDS=${configuredNetworkTrustFreshnessSeconds} is shorter than one mining cycle; using ${networkTrustFreshnessSeconds} so a device that mined on a network keeps its exemption between its own cycles.`,
    );
  }
  return {
    identityMode: legacyTest ? "legacy-test" : identityMode,
    enabled,
    leaseEnabled,
    highConfidenceThreshold: high,
    ambiguousThreshold: ambiguous,
    observationTtlSeconds,
    ipIntelTtlSeconds,
    browserKeyRequired,
    riskMode: rawMode,
    challengeTtlSeconds: positiveInteger("LMDG_CHALLENGE_TTL_SECONDS", values["LMDG_CHALLENGE_TTL_SECONDS"] ?? "300", 60),
    nonceTtlSeconds: positiveInteger("LMDG_NONCE_TTL_SECONDS", values["LMDG_NONCE_TTL_SECONDS"] ?? "300", 60),
    enrollmentEnabled,
    maxNewClustersPerAccountPerDay,
    maxNewClustersPerNetworkPerHour,
    maxNewClustersPerNetworkPerDay,
    networkLeaseLock,
    establishMinAdmissions,
    networkTrustFreshnessSeconds,
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
    // Production defaults to all interfaces: inside a container (Coolify/Docker)
    // 127.0.0.1 is unreachable from the platform's reverse proxy.
    host: values["HOST"] ?? (isProduction ? "0.0.0.0" : "127.0.0.1"),
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
    proxycheckKey: optionalString("PROXYCHECK_KEY", values),
    proxycheckTimeoutMs: positiveInteger("PROXYCHECK_TIMEOUT_MS", values["PROXYCHECK_TIMEOUT_MS"] ?? "2500"),
    proxycheckHmacKey: optionalString("PROXYCHECK_HMAC_KEY", values),
    trustProxy: parseTrustedProxies("TRUST_PROXY", values),
    proxySharedSecret: parseProxySharedSecret(values),
    redis: loadRedisConfig(values),
    mining: loadMiningConfig(values),
    miningPools: loadMiningPoolsConfig(values),
    lmdg: loadLmdgConfig(values),
    paymentGateway: loadPaymentGatewayConfig(values),
    embeddedGateway: loadGatewayConfig(values),
  };
}
