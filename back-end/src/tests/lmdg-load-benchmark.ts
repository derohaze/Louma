/**
 * LMDG decision-path LOAD benchmark (test-only instrumentation).
 *
 * `lmdg-start-benchmark.ts` answers "did any step of one request become unbounded or N+1" by
 * measuring requests one at a time. This script answers the complementary question: what do the
 * same protection decisions — device resolution, admission control, the lease transaction, the
 * credit, the nested device-status reads and the challenge/prove handshake — cost when thousands
 * of cycles run concurrently, and how does that cost move with in-flight concurrency?
 *
 * Shape of the run (all through the real routes on a real `buildApp`, same as the integration
 * suites):
 *
 *   setup          register N accounts (each its own peer address) and join a pool
 *   fresh@C        N first starts, C in flight: full enrollment for N distinct machine identities
 *   known@C(level) stop N cycles, rejoin the same room (a stop releases it), then start N again
 *                  on the same devices: the returning path, repeated once per entry in
 *                  `BENCH_LEVELS` so the same population is measured at several concurrency levels.
 *                  A returning start may come back `mining_device_challenge_required` (rapid repeats
 *                  are exactly the pattern the risk policy re-verifies); those accounts then run the
 *                  full challenge -> prove -> retry handshake at the same level, as a browser does
 *   status@C       device/status for a sample of the running devices
 *   verify@C       stop a sample, then challenge -> prove -> retry start on the same device
 *
 * What is measured per phase: outcome mix (status:code), wall time and throughput, latency
 * percentiles over ALLOWED requests only (a refusal is a shorter path and would flatter the
 * numbers), and the Mongo work each allowed request performed — reads, writes, documents scanned
 * and transactions. The counts are attributed per request with `AsyncLocalStorage`, so concurrent
 * requests do not blend into one global counter; collections are counted through a Proxy around
 * the same `Collections`/`MongoClient` handed to the app, so no production code is instrumented.
 *
 * Integrity is checked at the end, not assumed: one active cycle per account, every active cycle
 * owns its own active device-lease keys, no active lease key belongs to a session that is not
 * running, every active cycle carries the device it was admitted on, and enrollment-budget rows
 * never go negative.
 *
 * Honest limits (also written into the report):
 *   - `app.inject` is in-process: HTTP parsing, TLS and the network are outside the measurement.
 *   - Redis is disabled, exactly as in the integration suites: the distributed rate limits fall
 *     back to the in-process limiter and the route's mining-start limiter short-circuits.
 *   - One local MongoDB deployment, one client process. This is not a production capacity number.
 *   - Peer addresses are private 10.x test addresses, so the IP-intelligence providers are never
 *     consulted (none are configured here either).
 *   - Device evidence is synthetic and unique per account, so each cycle owns one machine
 *     identity. A real population shares machine traits; those shared traits are what the fuzzy
 *     ambiguity rule is for, and this run measures the admission path, not that rule.
 *
 * Usage (throwaway database required — the script writes thousands of fixtures and stops the
 * cycles it starts between phases):
 *   MONGODB_URI=... MONGODB_DATABASE=louma_load_probe BENCH_ALLOW_DESTRUCTIVE_CLEANUP=1 \
 *     BENCH_ACCOUNTS=1000 BENCH_LEVELS=16,64,256 BENCH_OUT=load.json \
 *     node --env-file-if-exists=.env.development --import tsx src/tests/lmdg-load-benchmark.ts
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { cpus } from "node:os";
import { monitorEventLoopDelay } from "node:perf_hooks";
import type { MongoClient } from "mongodb";
import { buildApp } from "../app.js";
import { loadConfig } from "../config/env.js";
import { connectMongo } from "../infrastructure/mongodb/client.js";
import { ensureDatabaseIndexes } from "../infrastructure/mongodb/indexes.js";
import { getCollections, type Collections } from "../infrastructure/mongodb/collections.js";
import { disabledRedis } from "../infrastructure/redis/client.js";
import { ipHash } from "../modules/mining-device/identity.js";

const ACCOUNTS = positiveInt("BENCH_ACCOUNTS", 1000);
const FRESH_CONCURRENCY = positiveInt("BENCH_FRESH_CONCURRENCY", 64);
const LEVELS = (process.env["BENCH_LEVELS"] ?? "16,64,256")
  .split(",")
  .map((value) => Number(value.trim()))
  .filter((value) => Number.isInteger(value) && value > 0);
const READ_CONCURRENCY = positiveInt("BENCH_READ_CONCURRENCY", 64);
const STATUS_SAMPLE = positiveInt("BENCH_STATUS_SAMPLE", 500);
const VERIFY_SAMPLE = positiveInt("BENCH_VERIFY_SAMPLE", 100);
const SETUP_CONCURRENCY = positiveInt("BENCH_SETUP_CONCURRENCY", 16);
const PASSWORD = "SmokeTest1234";
const OUT = process.env["BENCH_OUT"] ?? null;
/**
 * The script creates thousands of accounts, devices and cycles and stops its own cycles between
 * phases. It cannot tell a throwaway database from a shared one, so the operator has to say so.
 */
const DESTRUCTIVE_CLEANUP_ALLOWED = (process.env["BENCH_ALLOW_DESTRUCTIVE_CLEANUP"] ?? "").trim() === "1";

function positiveInt(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

// --------------------------------------------------------------------------- Mongo op attribution

interface OpCounts {
  reads: Record<string, number>;
  writes: Record<string, number>;
  docsScanned: number;
  transactions: number;
}

const emptyCounts = (): OpCounts => ({ reads: {}, writes: {}, docsScanned: 0, transactions: 0 });
/**
 * One store per measured request. Any Mongo call made while a request context is active lands in
 * that request's store; calls made outside a measured request (setup) land in the background
 * store, so they cannot pollute a phase.
 */
const opContext = new AsyncLocalStorage<OpCounts>();
const backgroundCounts = emptyCounts();
const bucketOf = (): OpCounts => opContext.getStore() ?? backgroundCounts;
const bump = (target: Record<string, number>, key: string): void => {
  target[key] = (target[key] ?? 0) + 1;
};

const READ_METHODS = new Set(["find", "findOne", "countDocuments", "distinct", "aggregate", "estimatedDocumentCount"]);
const WRITE_METHODS = new Set([
  "insertOne", "insertMany", "updateOne", "updateMany", "replaceOne",
  "findOneAndUpdate", "findOneAndReplace", "findOneAndDelete",
  "deleteOne", "deleteMany", "bulkWrite",
]);

/**
 * Wrap one collection so every read and write is attributed by name and its materialised document
 * count is summed — cursors are wrapped at `toArray`, which is how this codebase drains them, so
 * `docsScanned` is the number the "no unbounded candidate scan" claim has to be checked against.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function wrapCollection(name: string, collection: any): any {
  return new Proxy(collection, {
    get(target, prop) {
      const value = target[prop];
      if (typeof value !== "function") return value;
      const method = String(prop);
      if (READ_METHODS.has(method)) {
        return (...args: unknown[]) => {
          bump(bucketOf().reads, `${name}.${method}`);
          const result = value.apply(target, args);
          if (result && typeof result.toArray === "function") {
            const original = result.toArray.bind(result);
            result.toArray = async () => {
              const docs = await original();
              bucketOf().docsScanned += Array.isArray(docs) ? docs.length : 0;
              return docs;
            };
            return result;
          }
          if (method === "findOne" && result && typeof result.then === "function") {
            return result.then((doc: unknown) => {
              if (doc) bucketOf().docsScanned += 1;
              return doc;
            });
          }
          return result;
        };
      }
      if (WRITE_METHODS.has(method)) {
        return (...args: unknown[]) => {
          bump(bucketOf().writes, `${name}.${method}`);
          return value.apply(target, args);
        };
      }
      return value.bind(target);
    },
  });
}

function wrapCollections(collections: Collections): Collections {
  const wrapped: Record<string, unknown> = {};
  for (const key of Object.keys(collections) as (keyof Collections)[]) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    wrapped[key as string] = wrapCollection(String(key), collections[key] as any);
  }
  return wrapped as unknown as Collections;
}

/** Counts `session.withTransaction`, i.e. the start/stop path's real transaction use. */
function wrapClient(client: MongoClient): MongoClient {
  return new Proxy(client, {
    get(target, prop) {
      if (prop === "startSession") {
        return (...args: unknown[]) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const session = (target.startSession as any).apply(target, args) as any;
          return new Proxy(session, {
            get(sessionTarget, sessionProp) {
              if (sessionProp === "withTransaction") {
                return (...txArgs: unknown[]) => {
                  bucketOf().transactions += 1;
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  return (sessionTarget.withTransaction as any).apply(sessionTarget, txArgs);
                };
              }
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const value = (sessionTarget as any)[sessionProp];
              return typeof value === "function" ? value.bind(sessionTarget) : value;
            },
          });
        };
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const value = (target as any)[prop];
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

// ----------------------------------------------------------------------------------- fixtures

const WINDOWS_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const MAC_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const LINUX_UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

const SHAPES: [number, number, number][] = [
  [1366, 768, 1], [1440, 900, 2], [1600, 900, 1], [1728, 1117, 2], [1920, 1080, 1],
  [1920, 1200, 1.25], [2048, 1536, 2], [2560, 1080, 1], [2560, 1440, 1], [2560, 1600, 2],
  [2880, 1800, 2], [3840, 2160, 1.5],
];
const ZONES: [string, number][] = [
  ["Africa/Cairo", -180], ["Europe/London", 0], ["America/New_York", 300],
  ["Asia/Dubai", -240], ["Europe/Berlin", -120], ["Asia/Riyadh", -180],
];

/**
 * One synthetic desktop per account. Two things make each account its own machine rather than a
 * neighbour: the rendering digests (GPU strings, limits, canvas/audio/WebGL/fonts/codecs) all move
 * with the index, and `audioSampleRate` — a machine-core trait that is not bucketed — is unique per
 * index, so no two accounts can share a machine key. Without that, the population would collapse
 * into one device cluster and the run would measure the conflict rule instead of the admission
 * path. `browserKeyPublicKey` is a real P-256 JWK so the same account can complete a challenge
 * later; the key material is what the proof binds to, and it must not change between phases.
 *
 * `maxTouchPoints` and the capture-device counts are deliberately absent. Every other machine
 * trait is bucketed, so with them reported two synthetic machines can agree on every machine trait
 * except the unique audio device — a machine score of 9/11 ≈ 82%, at or above the same-machine
 * threshold — and the guard would, correctly, read them as one computer: the fresh burst would turn into
 * `device_lease_active` denials and measure the identical-machine rule instead of load. Leaving
 * those two bucketed traits unreported keeps the machine score of any pair at or below 75%, below
 * the same-machine ratio, while the machine key stays unique through the audio device. This is a
 * fixture property, not a path property: a real population contains genuinely identical machines,
 * and the one-machine rule is supposed to treat them as one.
 */
function machineEvidence(run: string, index: number, jwkText: string): Record<string, unknown> {
  const [width, height, pixelRatio] = SHAPES[index % SHAPES.length]!;
  const [timezone, timezoneOffsetMinutes] = ZONES[index % ZONES.length]!;
  const platform = ["Win32", "MacIntel", "Linux x86_64"][index % 3]!;
  const userAgent = platform === "Win32" ? WINDOWS_UA : platform === "MacIntel" ? MAC_UA : LINUX_UA;
  return {
    visitorId: `load-visitor-${run}-${index}`,
    fingerprintConfidence: 0.95,
    fingerprintVersion: "v5",
    platform,
    userAgent,
    screenWidth: width,
    screenHeight: height,
    screenAvailWidth: width,
    screenAvailHeight: height - (index % 5) * 8,
    screenColorDepth: [30, 32][index % 2],
    pixelRatio,
    hardwareConcurrency: [2, 4, 8, 16, 32][index % 5],
    deviceMemory: [1, 2, 4, 8, 16, 32][index % 6],
    webglVendor: `load-vendor-${run}-${index}`,
    webglRenderer: `load-renderer-${run}-${index}`,
    webglLimitsHash: `load-limits-${run}-${index}`,
    webglExtensionsHash: `load-ext-${run}-${index}`,
    webgpuHash: `load-webgpu-${run}-${index}`,
    // Machine-core trait, unbucketed: unique per index by construction (see the function comment).
    audioSampleRate: 22050 + index * 750,
    audioChannels: (index % 2) + 1,
    colorGamut: ["srgb", "p3", "rec2020"][index % 3],
    hdr: index % 3 !== 0,
    webglHash: `load-webgl-${run}-${index}`,
    canvasHash: `load-canvas-${run}-${index}`,
    audioHash: `load-audio-${run}-${index}`,
    fontsHash: `load-fonts-${run}-${index}`,
    codecsHash: `load-codecs-${run}-${index}`,
    timezone,
    timezoneOffsetMinutes,
    locale: "en-US",
    languages: "en-US,en",
    language: "en-US",
    platformVersion: `${index % 7}.${index % 5}.${index % 3}`,
    browserKeyPublicKey: jwkText,
    integrity: { webdriver: false, headlessHint: false, impossibleUaPlatform: false, missingCapabilities: false },
  };
}

/**
 * Private 10.x addresses, one per account and stable across that account's phases (the network a
 * cycle is taken from is part of the admission decision, so it must not move between the fresh
 * start and its retry). `isPublicIp` treats them as reserved, so no provider is ever consulted.
 */
function ipForIndex(index: number): string {
  const host = index + 1;
  return `10.${(host >> 16) & 0xff}.${(host >> 8) & 0xff}.${host & 0xff}`;
}

interface Account {
  index: number;
  ip: string;
  token: string;
  csrf: string;
  userId: string | null;
  evidence: Record<string, unknown>;
  jwk: JsonWebKey;
  privateKey: CryptoKey;
}

interface Sample {
  ms: number;
  status: number;
  code: string | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: any;
  reads: number;
  writes: number;
  docsScanned: number;
  transactions: number;
  readsByMethod: Record<string, number>;
  writesByMethod: Record<string, number>;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))]!;
}

const round2 = (value: number): number => Math.round(value * 100) / 100;
const mean = (values: number[]): number => (values.length === 0 ? 0 : round2(values.reduce((sum, value) => sum + value, 0) / values.length));

/** Sum of each collection method across a phase — the shape of the path, not just its size. */
function mergeMethodCounts(samples: Sample[], key: "readsByMethod" | "writesByMethod"): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const sample of samples) for (const [name, value] of Object.entries(sample[key])) totals[name] = (totals[name] ?? 0) + value;
  return Object.fromEntries(Object.entries(totals).sort((a, b) => b[1] - a[1]));
}

interface Wave {
  label: string;
  samples: Sample[];
  wallMs: number;
}

/** Runs `task` over every item with at most `concurrency` in flight; results keep item order. */
async function mapPool<T, R>(items: T[], concurrency: number, task: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await task(items[index]!, index);
    }
  };
  const workers = Math.min(Math.max(1, concurrency), Math.max(1, items.length));
  await Promise.all(Array.from({ length: workers }, worker));
  return results;
}

function summarise(wave: Wave): Record<string, unknown> {
  const allowed = wave.samples.filter((sample) => sample.status === 200);
  const refused = wave.samples.filter((sample) => sample.status !== 200);
  const latencies = allowed.map((sample) => sample.ms).sort((a, b) => a - b);
  const wallSeconds = wave.wallMs / 1000;
  const stats = (values: number[]): { mean: number; max: number } => ({ mean: mean(values), max: round2(Math.max(...values, 0)) });
  return {
    phase: wave.label,
    requests: wave.samples.length,
    allowed: allowed.length,
    wallMs: round2(wave.wallMs),
    requestsPerSecond: wallSeconds === 0 ? null : round2(wave.samples.length / wallSeconds),
    allowedPerSecond: wallSeconds === 0 ? null : round2(allowed.length / wallSeconds),
    outcomes: wave.samples.reduce<Record<string, number>>((acc, sample) => {
      const key = `${sample.status}:${sample.code ?? "-"}`;
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {}),
    // Latency over ALLOWED requests only: a refusal is a shorter path and would flatter the numbers.
    latencyMs: {
      min: round2(latencies[0] ?? 0),
      p50: round2(percentile(latencies, 50)),
      p95: round2(percentile(latencies, 95)),
      p99: round2(percentile(latencies, 99)),
      max: round2(latencies[latencies.length - 1] ?? 0),
      mean: mean(latencies),
    },
    refusedLatencyMs: refused.length === 0 ? null : { p50: round2(percentile(refused.map((s) => s.ms).sort((a, b) => a - b), 50)), mean: mean(refused.map((s) => s.ms)) },
    perAllowed: allowed.length === 0 ? null : {
      mongoReads: stats(allowed.map((sample) => sample.reads)),
      mongoWrites: stats(allowed.map((sample) => sample.writes)),
      docsScanned: stats(allowed.map((sample) => sample.docsScanned)),
      transactions: stats(allowed.map((sample) => sample.transactions)),
    },
    mongoReadsByMethod: mergeMethodCounts(allowed, "readsByMethod"),
    mongoWritesByMethod: mergeMethodCounts(allowed, "writesByMethod"),
  };
}

// --------------------------------------------------------------------------------------- main

async function main(): Promise<void> {
  if (!DESTRUCTIVE_CLEANUP_ALLOWED) {
    console.error(
      "BENCHMARK REFUSED: this script creates thousands of accounts/devices/cycles and stops its own cycles between phases." +
        " Point it at a throwaway database and set BENCH_ALLOW_DESTRUCTIVE_CLEANUP=1 to confirm that is what it is pointed at.",
    );
    process.exit(2);
  }
  if (LEVELS.length === 0) {
    console.error("BENCHMARK REFUSED: BENCH_LEVELS must contain at least one positive concurrency level.");
    process.exit(2);
  }
  const config = loadConfig();
  const connection = await connectMongo(config, { serverSelectionTimeoutMS: 30_000, connectTimeoutMS: 20_000 });
  const client = connection.client;
  const real = getCollections(connection.db);
  await ensureDatabaseIndexes(connection.db);
  // The fixtures are keyed by account index, so a second run against the same database would
  // rebuild the same identities and collide with the first run's live clusters — measuring the
  // conflict rule instead of load. The numbers are only meaningful on a database this run owns.
  const [existingUsers, existingDevices, existingLeases, existingSessions] = await Promise.all([
    real.users.countDocuments(),
    real.miningDevices.countDocuments(),
    real.miningDeviceLeases.countDocuments(),
    real.miningSessions.countDocuments(),
  ]);
  if (existingUsers + existingDevices + existingLeases + existingSessions > 0) {
    console.error(
      `BENCHMARK REFUSED: the database already holds ${existingUsers} user(s), ${existingDevices} device(s), ${existingLeases} lease(s) and ${existingSessions} session(s).` +
        " This benchmark keys its fixtures by account index, so it must run against a fresh throwaway database.",
    );
    await client.close();
    process.exit(2);
  }
  const app = await buildApp({
    config,
    collections: wrapCollections(real),
    mongoClient: wrapClient(client),
    redis: disabledRedis(),
    logger: false,
  });
  const run = randomUUID().slice(0, 8);

  // One anonymous CSRF token covers every register call; each account then carries the token its
  // own session was issued. Distinct peer addresses keep the per-route/per-IP limits out of the
  // way — every account gets its own address and uses it for all of its requests.
  const preauth = await app.inject({ method: "GET", url: "/api/v1/auth/csrf", remoteAddress: "10.255.255.1" });
  const preauthToken = (preauth.json() as { csrfToken?: string }).csrfToken ?? "";

  const call = async (options: {
    method: "GET" | "POST";
    url: string;
    ip: string;
    token?: string;
    csrf?: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    body?: unknown;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }): Promise<{ status: number; body: any }> => {
    const response = await app.inject({
      method: options.method,
      url: options.url,
      headers: {
        ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
        ...(options.method === "GET" ? {} : { "x-csrf-token": options.csrf ?? preauthToken }),
      },
      remoteAddress: options.ip,
      ...(options.body === undefined ? {} : { payload: options.body as Record<string, unknown> }),
    });
    const body = response.payload.length ? response.json() : {};
    return { status: response.statusCode, body };
  };

  /** Times one request and attributes the Mongo work it performed to it. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const timed = async (request: () => Promise<{ status: number; body: any }>): Promise<Sample> => {
    const counts = emptyCounts();
    const started = performance.now();
    const response = await opContext.run(counts, request);
    const ms = performance.now() - started;
    return {
      ms,
      status: response.status,
      code: (response.body?.error?.code as string | undefined) ?? null,
      body: response.body,
      reads: Object.values(counts.reads).reduce((sum, value) => sum + value, 0),
      writes: Object.values(counts.writes).reduce((sum, value) => sum + value, 0),
      docsScanned: counts.docsScanned,
      transactions: counts.transactions,
      readsByMethod: { ...counts.reads },
      writesByMethod: { ...counts.writes },
    };
  };

  const measureWave = async <T>(
    label: string,
    items: T[],
    concurrency: number,
    request: (item: T) => Promise<Sample>,
  ): Promise<Wave> => {
    const wallStart = performance.now();
    const samples = await mapPool(items, concurrency, request);
    return { label, samples, wallMs: performance.now() - wallStart };
  };

  // ------------------------------------------------------------------ setup: N accounts, one IP each
  const setupStart = performance.now();
  const setupFailures: string[] = [];
  const accounts = await mapPool(
    Array.from({ length: ACCOUNTS }, (_, index) => index),
    SETUP_CONCURRENCY,
    async (index): Promise<Account | null> => {
      const ip = ipForIndex(index);
      const keyPair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
      const jwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
      const evidence = machineEvidence(run, index, JSON.stringify(jwk));
      const registered = await call({
        method: "POST",
        url: "/api/v1/auth/register",
        ip,
        body: { email: `load.${run}.${index}.${Math.random().toString(36).slice(2)}@example.test`, password: PASSWORD, displayName: `Load ${index}` },
      });
      if (registered.status !== 201) {
        setupFailures.push(`register ${index}: ${registered.status}:${registered.body?.error?.code ?? "-"}`);
        return null;
      }
      const joined = await call({
        method: "POST",
        url: "/api/v1/mining/pools/join",
        ip,
        token: String(registered.body.accessToken),
        csrf: String(registered.body.csrfToken),
        // The deployment configures two mining rooms of 1000 members each (`MINING_POOL_*_MAX_MEMBERS`),
        // and a full room refuses joins. Alternating keeps a 2000-account population admissible.
        body: { poolId: index % 2 === 0 ? "low" : "medium" },
      });
      if (joined.status !== 200) {
        setupFailures.push(`join ${index}: ${joined.status}:${joined.body?.error?.code ?? "-"}`);
        return null;
      }
      return {
        index,
        ip,
        token: String(registered.body.accessToken),
        csrf: String(registered.body.csrfToken),
        userId: (registered.body?.user?.id as string | undefined) ?? null,
        evidence,
        jwk,
        privateKey: keyPair.privateKey,
      };
    },
  );
  const ready = accounts.filter((account): account is Account => account !== null);
  if (ready.length < Math.ceil(ACCOUNTS * 0.9)) {
    throw new Error(`setup produced only ${ready.length}/${ACCOUNTS} accounts; refusing to measure (${setupFailures.slice(0, 5).join("; ")})`);
  }

  // --------------------------------------------------------------------------- requests per phase
  const startRequest = (account: Account): Promise<Sample> =>
    timed(() => call({ method: "POST", url: "/api/v1/mining/start", ip: account.ip, token: account.token, csrf: account.csrf, body: { device: account.evidence } }));
  const stopRequest = (account: Account): Promise<Sample> =>
    timed(() => call({ method: "POST", url: "/api/v1/mining/stop", ip: account.ip, token: account.token, csrf: account.csrf }));
  // A stop releases the room, and a start without a live hold is refused before device admission —
  // so every stop-to-start wave rejoins the account's original room first. Without this the first
  // returning wave would empty the population and every later wave would measure the refusal path.
  const joinRequest = (account: Account): Promise<Sample> =>
    timed(() => call({ method: "POST", url: "/api/v1/mining/pools/join", ip: account.ip, token: account.token, csrf: account.csrf, body: { poolId: account.index % 2 === 0 ? "low" : "medium" } }));
  const statusRequest = (account: Account): Promise<Sample> =>
    timed(() => call({ method: "GET", url: "/api/v1/mining/device/status", ip: account.ip, token: account.token }));

  const phases: Record<string, unknown> = {};
  const record = async (wave: Wave): Promise<void> => {
    phases[wave.label] = summarise(wave);
  };

  /**
   * Answers the re-verification handshake for starts refused with `mining_device_challenge_required`,
   * at the same concurrency as the wave that produced them. Signing happens between the timed calls
   * (a browser signs before it sends), so challenge/prove latency is server time. Without this, a
   * level whose returning starts mostly get challenged would leave the next level an empty
   * population and silently turn the run into a measurement of the refusal path.
   */
  const completeChallenges = async (label: string, accounts: Account[], starts: Sample[], level: number): Promise<Account[]> => {
    const challenged = accounts.filter((_, index) => starts[index]!.code === "mining_device_challenge_required");
    if (challenged.length === 0) return [];
    const challengeWave = await measureWave(`${label}.challenge`, challenged, level, (account) =>
      timed(() => call({ method: "POST", url: "/api/v1/mining/device/challenge", ip: account.ip, token: account.token, csrf: account.csrf, body: { device: account.evidence } })),
    );
    await record(challengeWave);
    const signatures = await mapPool(challenged, level, async (account, index): Promise<string | null> => {
      const sample = challengeWave.samples[index]!;
      if (sample.status !== 200 || typeof sample.body?.payload !== "string") return null;
      return Buffer.from(
        await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, account.privateKey, new TextEncoder().encode(sample.body.payload)),
      ).toString("base64url");
    });
    const proveItems = challenged
      .map((account, index) => ({ account, challenge: challengeWave.samples[index]!, signature: signatures[index] ?? null }))
      .filter((item): item is { account: Account; challenge: Sample; signature: string } => item.challenge.status === 200 && item.signature !== null);
    const proveWave = await measureWave(`${label}.prove`, proveItems, level, ({ account, challenge, signature }) =>
      timed(() => call({ method: "POST", url: "/api/v1/mining/device/prove", ip: account.ip, token: account.token, csrf: account.csrf, body: { nonce: challenge.body.nonce, signature, publicKeyJwk: account.jwk, device: account.evidence } })),
    );
    await record(proveWave);
    const retryWave = await measureWave(`${label}.retry-start`, challenged, level, startRequest);
    await record(retryWave);
    return challenged.filter((_, index) => retryWave.samples[index]!.status === 200);
  };

  // Process-level load shape: event-loop delay and peak RSS over the measured waves only (setup is
  // excluded, so argon2 registration hashing does not show up as request-path load).
  const loopDelay = monitorEventLoopDelay({ resolution: 20 });
  loopDelay.enable();
  let rssPeakBytes = 0;
  const rssSampler = setInterval(() => {
    rssPeakBytes = Math.max(rssPeakBytes, process.memoryUsage().rss);
  }, 200);

  // ------------------------------------------------------- P1: N first starts, full enrollment path
  const freshWave = await measureWave(`fresh@C=${FRESH_CONCURRENCY}`, ready, FRESH_CONCURRENCY, startRequest);
  await record(freshWave);
  let running = ready.filter((_, index) => freshWave.samples[index]!.status === 200);
  if (freshWave.samples.some((sample) => sample.status === 200 && sample.reads + sample.writes === 0)) {
    console.error("WARNING: an allowed request reported zero Mongo operations — per-request attribution may be broken; treat op counts as unreliable.");
  }

  // ------------------------- P2: returning devices, once per concurrency level (stop, rejoin, start)
  for (const level of LEVELS) {
    const stopping = running;
    const stopWave = await measureWave(`known@C=${level}.stop`, stopping, level, stopRequest);
    await record(stopWave);
    const stopped = stopping.filter((_, index) => stopWave.samples[index]!.status === 200);
    const rejoinWave = await measureWave(`known@C=${level}.rejoin`, stopped, level, joinRequest);
    await record(rejoinWave);
    const rejoined = stopped.filter((_, index) => rejoinWave.samples[index]!.status === 200);
    const startWave = await measureWave(`known@C=${level}.start`, rejoined, level, startRequest);
    await record(startWave);
    const accepted = rejoined.filter((_, index) => startWave.samples[index]!.status === 200);
    const recovered = await completeChallenges(`known@C=${level}`, rejoined, startWave.samples, level);
    running = [...accepted, ...recovered];
  }

  // --------------------------------------------- P3: device/status for a sample of bound devices
  const statusTargets = running.slice(0, STATUS_SAMPLE);
  const statusWave = await measureWave(`status@C=${READ_CONCURRENCY}`, statusTargets, READ_CONCURRENCY, statusRequest);
  await record(statusWave);

  // ----------------------------- P4: stop a sample, then challenge -> prove -> retry on the device
  const verifyTargets = running.slice(0, VERIFY_SAMPLE);
  const verifyStop = await measureWave(`verify@C=${READ_CONCURRENCY}.stop`, verifyTargets, READ_CONCURRENCY, stopRequest);
  await record(verifyStop);
  const challengeWave = await measureWave(`verify@C=${READ_CONCURRENCY}.challenge`, verifyTargets, READ_CONCURRENCY, (account) =>
    timed(() => call({ method: "POST", url: "/api/v1/mining/device/challenge", ip: account.ip, token: account.token, csrf: account.csrf, body: { device: account.evidence } })),
  );
  await record(challengeWave);
  // Signing is client-side work: it is done before the timed call, so the prove latency is the
  // server call only, exactly like a browser that signs before it sends.
  const signatures = await mapPool(verifyTargets, READ_CONCURRENCY, async (account, index): Promise<string | null> => {
    const sample = challengeWave.samples[index]!;
    if (sample.status !== 200 || typeof sample.body?.payload !== "string") return null;
    return Buffer.from(
      await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, account.privateKey, new TextEncoder().encode(sample.body.payload)),
    ).toString("base64url");
  });
  const proveItems = verifyTargets
    .map((account, index) => ({ account, challenge: challengeWave.samples[index]!, signature: signatures[index] ?? null }))
    .filter((item): item is { account: Account; challenge: Sample; signature: string } => item.challenge.status === 200 && item.signature !== null);
  const proveWave = await measureWave(`verify@C=${READ_CONCURRENCY}.prove`, proveItems, READ_CONCURRENCY, ({ account, challenge, signature }) =>
    timed(() => call({ method: "POST", url: "/api/v1/mining/device/prove", ip: account.ip, token: account.token, csrf: account.csrf, body: { nonce: challenge.body.nonce, signature, publicKeyJwk: account.jwk, device: account.evidence } })),
  );
  await record(proveWave);
  const verifyStopped = verifyTargets.filter((_, index) => verifyStop.samples[index]!.status === 200);
  const verifyRejoin = await measureWave(`verify@C=${READ_CONCURRENCY}.rejoin`, verifyStopped, READ_CONCURRENCY, joinRequest);
  await record(verifyRejoin);
  const verifyRejoined = verifyStopped.filter((_, index) => verifyRejoin.samples[index]!.status === 200);
  const retryWave = await measureWave(`verify@C=${READ_CONCURRENCY}.retry-start`, verifyRejoined, READ_CONCURRENCY, startRequest);
  await record(retryWave);

  // The verify sample left the running set when it stopped; a successful retry puts it back.
  const stoppedOk = new Set(verifyStopped);
  running = running.filter((account) => !stoppedOk.has(account));
  for (const [index, account] of verifyRejoined.entries()) {
    if (retryWave.samples[index]!.status === 200) running.push(account);
  }

  clearInterval(rssSampler);
  loopDelay.disable();
  const nanosToMs = (value: number): number => round2(value / 1e6);
  const processLoad = {
    rssPeakMb: round2(rssPeakBytes / 1_048_576),
    eventLoopDelayMs: {
      p50: nanosToMs(loopDelay.percentile(50)),
      p95: nanosToMs(loopDelay.percentile(95)),
      p99: nanosToMs(loopDelay.percentile(99)),
      max: nanosToMs(loopDelay.max),
    },
    note: "sampled over the measured waves only, in the single benchmark process",
  };

  // ------------------------------------------------------------------- integrity of what load built
  const userIds = ready.map((account) => account.userId).filter((value): value is string => typeof value === "string" && value.length > 0);
  const runIpHashes = ready.map((account) => ipHash(config.encryptionKey, account.ip)).filter((value): value is string => value !== null);
  const [activeSessions, activeLeases, networkTokens, quotaRows, devicesEnrolled, observations] = await Promise.all([
    real.miningSessions.countDocuments({ ownerUserId: { $in: userIds }, status: "active" }),
    real.miningDeviceLeases.countDocuments({ ownerUserId: { $in: userIds }, status: "active", deviceClusterId: { $not: { $regex: /^net:/ } } }),
    real.miningDeviceLeases.countDocuments({ ownerUserId: { $in: userIds }, status: "active", deviceClusterId: { $regex: /^net:/ } }),
    real.miningDeviceQuotas.countDocuments({ $or: [{ scope: "account", subject: { $in: userIds } }, { scope: "network", subject: { $in: runIpHashes } }] }),
    real.miningDevices.countDocuments({ enrollmentUserId: { $in: userIds } }),
    real.miningDeviceObservations.countDocuments({ ownerUserId: { $in: userIds } }),
  ]);
  const sessionsPerOwner = await real.miningSessions
    .aggregate([{ $match: { ownerUserId: { $in: userIds }, status: "active" } }, { $group: { _id: "$ownerUserId", count: { $sum: 1 } } }, { $group: { _id: null, max: { $max: "$count" } } }])
    .toArray();
  // A running cycle does not hold a single lease row: it holds one row per equivalent lease key
  // (device public id, machine key hash, device key hash, aliases). The invariants are therefore
  // per cycle — every active session owns at least one active device-lease key — and per key — no
  // active key belongs to a session that is not running — which is what the partial unique index
  // and the transaction together enforce. Grouping by `deviceClusterId` would only rediscover that
  // each key appears once; grouping by session is the check that means something.
  const leaseKeysPerSession = await real.miningDeviceLeases
    .aggregate([
      { $match: { ownerUserId: { $in: userIds }, status: "active", deviceClusterId: { $not: { $regex: /^net:/ } } } },
      { $group: { _id: "$miningSessionId", count: { $sum: 1 } } },
      { $group: { _id: null, min: { $min: "$count" }, max: { $max: "$count" }, sessions: { $sum: 1 } } },
    ])
    .toArray();
  const sessionsWithLease = leaseKeysPerSession[0]?.["sessions"] ?? 0;
  const sessionsWithoutLease = Math.max(0, activeSessions - sessionsWithLease);
  const activeLeaseSessionIds = new Set(
    (await real.miningDeviceLeases.find({ ownerUserId: { $in: userIds }, status: "active" }, { projection: { miningSessionId: 1 } }).toArray()).map((lease) => lease.miningSessionId),
  );
  const activeSessionIds = new Set(
    (await real.miningSessions.find({ ownerUserId: { $in: userIds }, status: "active" }, { projection: { publicId: 1 } }).toArray()).map((session) => session.publicId),
  );
  const orphanLeases = [...activeLeaseSessionIds].filter((sessionId) => !activeSessionIds.has(sessionId)).length;
  const sessionsWithoutDevice = await real.miningSessions.countDocuments({ ownerUserId: { $in: userIds }, status: "active", deviceId: null });
  const negativeQuotaRefs = await real.miningDeviceQuotas.countDocuments({ $or: [{ scope: "account", subject: { $in: userIds } }, { scope: "network", subject: { $in: runIpHashes } }], refs: { $lt: 0 } });
  const integrityViolations = [
    activeSessions !== running.length ? `active sessions ${activeSessions} != ${running.length} running cycles expected` : null,
    (sessionsPerOwner[0]?.["max"] ?? 0) > 1 ? `an account holds ${sessionsPerOwner[0]!["max"]} active sessions` : null,
    sessionsWithoutLease > 0 ? `${sessionsWithoutLease} active cycle(s) hold no active device-lease key` : null,
    orphanLeases > 0 ? `${orphanLeases} active lease(s) reference no running session` : null,
    sessionsWithoutDevice > 0 ? `${sessionsWithoutDevice} active cycle(s) carry no device id` : null,
    negativeQuotaRefs > 0 ? `${negativeQuotaRefs} enrollment quota row(s) have negative refs` : null,
  ].filter((value): value is string => value !== null);

  const report = {
    generatedAt: new Date().toISOString(),
    run,
    database: process.env["MONGODB_DATABASE"] ?? null,
    host: { node: process.version, platform: process.platform, cpus: cpus().length },
    engine: {
      transport: "app.inject (in-process; HTTP/TLS/network excluded)",
      redis: "disabled handle — cache/rate-limit/lock fallbacks are MongoDB/in-process",
      mongo: "the configured deployment; one client process; majority writes, snapshot transactions",
    },
    input: {
      accounts: ACCOUNTS,
      accountsReady: ready.length,
      setupFailures: setupFailures.slice(0, 20),
      setupMs: round2(performance.now() - setupStart),
      freshConcurrency: FRESH_CONCURRENCY,
      levels: LEVELS,
      readConcurrency: READ_CONCURRENCY,
      statusSample: statusTargets.length,
      verifySample: verifyTargets.length,
    },
    lmdg: {
      enabled: config.lmdg.enabled,
      leaseEnabled: config.lmdg.leaseEnabled,
      riskMode: config.lmdg.riskMode,
      networkLeaseLock: config.lmdg.networkLeaseLock,
      browserKeyRequired: config.lmdg.browserKeyRequired,
      establishMinAdmissions: config.lmdg.establishMinAdmissions,
      highConfidenceThreshold: config.lmdg.highConfidenceThreshold,
      ambiguousThreshold: config.lmdg.ambiguousThreshold,
    },
    phases,
    processLoad,
    verify: {
      stopped: verifyStop.samples.filter((sample) => sample.status === 200).length,
      challenged: challengeWave.samples.filter((sample) => sample.status === 200).length,
      proved: proveWave.samples.filter((sample) => sample.status === 200).length,
      retried: retryWave.samples.filter((sample) => sample.status === 200).length,
    },
    stateAfter: {
      runningCycles: running.length,
      activeSessions,
      activeDeviceLeaseKeys: activeLeases,
      activeCyclesWithDeviceLease: sessionsWithLease,
      deviceLeaseKeysPerCycle: { min: leaseKeysPerSession[0]?.["min"] ?? 0, max: leaseKeysPerSession[0]?.["max"] ?? 0 },
      activeNetworkTokens: networkTokens,
      maxActiveSessionsPerAccount: sessionsPerOwner[0]?.["max"] ?? 0,
      sessionsWithoutActiveDeviceLease: sessionsWithoutLease,
      leasesWithoutRunningSession: orphanLeases,
      activeCyclesWithoutDevice: sessionsWithoutDevice,
      devicesEnrolled: devicesEnrolled,
      deviceObservations: observations,
      enrollmentQuotaRows: quotaRows,
      negativeQuotaRefs,
    },
    integrity: { violations: integrityViolations, passed: integrityViolations.length === 0 },
    notes: [
      "latency/op stats are over ALLOWED requests only; refusals are reported separately",
      "peer addresses are private 10.x test addresses: IP-intelligence providers are not consulted",
      "device evidence is synthetic and unique per account so every cycle owns one machine identity",
      "not a production capacity number: one local MongoDB, no Redis, in-process transport",
      "waves run in sequence on the same population, so later levels see matured trust state and a larger history",
      "returning starts refused with mining_device_challenge_required are answered with a real challenge/prove/retry at the same concurrency level",
    ],
  };

  console.log(JSON.stringify(report, null, 2));
  if (OUT) {
    writeFileSync(OUT, JSON.stringify(report, null, 2));
    console.log(`load benchmark written: ${OUT}`);
  }
  await client.close();
  await app.close();
  if (integrityViolations.length > 0) {
    console.error(`INTEGRITY FAILED: ${integrityViolations.join("; ")}`);
    process.exit(1);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("LOAD BENCHMARK FAILURE:", error);
    process.exit(1);
  });
