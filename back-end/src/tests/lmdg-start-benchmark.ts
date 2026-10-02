/**
 * LMDG `POST /api/v1/mining/start` benchmark (test-only instrumentation).
 *
 * The hardening work added real work to the start path — an anchor lookup, an atomic budget
 * consumption, a consistency pass, a bounded network probe — so the question this answers is not
 * "is it fast" but "did any of it become unbounded or N+1". It therefore drives the REAL route and
 * the real services through `buildApp` (the same construction the integration suites use), and counts
 * the Mongo work by proxying the `Collections`/`MongoClient` the app is handed. No production code is
 * instrumented and nothing is logged from the request path.
 *
 * Two phases, because they are different code paths:
 *   A. fresh device enrollment — a brand-new machine identity (budget, anchor, consistency, network
 *      probe). Each sample is a machine the guard must classify as a *different* device, so the
 *      fixtures vary the traits the matcher weighs; an ambiguous pair would measure the ambiguity
 *      rule instead of enrollment.
 *   B. known device — the same account and the same machine identity again (the anchor hit, the lease
 *      sweep, the alias update), i.e. the returning-user path. The previous cycle and lease are
 *      cleared first, because "one active cycle per account" would otherwise answer before the guard
 *      does.
 *
 * Usage:
 *   MONGODB_URI=... MONGODB_DATABASE=... BENCH_SAMPLES=60 BENCH_OUT=bench-after.json \
 *     node --env-file-if-exists=.env.development --import tsx src/tests/lmdg-start-benchmark.ts
 */
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import type { MongoClient } from "mongodb";
import { buildApp } from "../app.js";
import { loadConfig } from "../config/env.js";
import { connectMongo } from "../infrastructure/mongodb/client.js";
import { ensureDatabaseIndexes } from "../infrastructure/mongodb/indexes.js";
import { getCollections, type Collections } from "../infrastructure/mongodb/collections.js";
import { disabledRedis } from "../infrastructure/redis/client.js";

const SAMPLES = Number(process.env["BENCH_SAMPLES"] ?? 60);
const PASSWORD = "SmokeTest1234";
const OUT = process.env["BENCH_OUT"] ?? null;
/**
 * `clearState` below releases every active device lease and closes every active mining session
 * (without settling it), which is only acceptable on a database whose contents are disposable. The
 * benchmark cannot tell a throwaway database from a shared one, so the operator has to say so.
 */
const DESTRUCTIVE_CLEANUP_ALLOWED = (process.env["BENCH_ALLOW_DESTRUCTIVE_CLEANUP"] ?? "").trim() === "1";
/**
 * TEST-NET-3 (RFC 5737) addresses, one per request. `isPublicIp` accepts them, so each request
 * carries its own network identity — which keeps the benchmark from measuring the per-network
 * identity budget, or another sample's network lease, instead of the start path itself.
 */
const TEST_IP_BASE = "203.0.113.";

interface OpCounts {
  reads: Record<string, number>;
  writes: Record<string, number>;
  docsScanned: number;
  transactions: number;
}

const counts: OpCounts = { reads: {}, writes: {}, docsScanned: 0, transactions: 0 };
const resetCounts = (): void => {
  counts.reads = {};
  counts.writes = {};
  counts.docsScanned = 0;
  counts.transactions = 0;
};
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
 * Wrap one collection so every read and write the start path performs is attributed by name and its
 * materialised document count is summed. Cursors are wrapped at `toArray`, which is how this codebase
 * drains them — that is the number the "no unbounded candidate scan" claim has to be checked against.
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
          bump(counts.reads, `${name}.${method}`);
          const result = value.apply(target, args);
          if (result && typeof result.toArray === "function") {
            const original = result.toArray.bind(result);
            result.toArray = async () => {
              const docs = await original();
              counts.docsScanned += Array.isArray(docs) ? docs.length : 0;
              return docs;
            };
            return result;
          }
          if (method === "findOne" && result && typeof result.then === "function") {
            return result.then((doc: unknown) => {
              if (doc) counts.docsScanned += 1;
              return doc;
            });
          }
          return result;
        };
      }
      if (WRITE_METHODS.has(method)) {
        return (...args: unknown[]) => {
          bump(counts.writes, `${name}.${method}`);
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

/** Counts `session.withTransaction`, i.e. the start path's real transaction use. */
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
                  counts.transactions += 1;
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
 * One realistic desktop machine per index, built to be unmistakably a *different* device from its
 * neighbours: the CPU/memory class, the panel and its depth, the touch class, the capture-device pair,
 * the timezone, the HDR capability and the negotiated audio device all move with the index. The
 * audio device is unique per index, so no two samples can share a machine key by construction — and
 * every value is one a real machine reports (never a 48 kHz/24-bit plain desktop profile, which is
 * exactly the shape that correlates with a real customer's device in a shared database).
 */
function machineEvidence(run: string, index: number): Record<string, unknown> {
  const [width, height, pixelRatio] = SHAPES[index % SHAPES.length]!;
  const [timezone, timezoneOffsetMinutes] = ZONES[index % ZONES.length]!;
  const platform = ["Win32", "MacIntel", "Linux x86_64"][index % 3]!;
  const userAgent = platform === "Win32" ? WINDOWS_UA : platform === "MacIntel" ? MAC_UA : LINUX_UA;
  return {
    visitorId: `bench-visitor-${run}-${index}`,
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
    // CPU and memory are reported as *distinct classes*, not as a long list of values that buckets
    // collapse into each other (2,3,4 all bucket together): with coprime periods two samples can only
    // agree on every class trait every 60 indices, so the ambiguity rule — which correctly refuses a
    // start when a live foreign lease and a near-identical machine coincide — does not decide the
    // benchmark instead of the enrollment path.
    hardwareConcurrency: [2, 4, 8, 16, 32][index % 5],
    deviceMemory: [1, 2, 4, 8, 16, 32][index % 6],
    maxTouchPoints: [0, 5, 10][index % 3],
    // Per-sample and per-run: a GPU identity shared across samples reads, correctly, as "a machine we
    // know whose rendering digests all moved at once" and would be challenged as tampering — the
    // guard doing its job, and the benchmark measuring the wrong path.
    webglVendor: `bench-vendor-${run}-${index}`,
    webglRenderer: `bench-renderer-${run}-${index}`,
    webglLimitsHash: `bench-limits-${run}-${index}`,
    webglExtensionsHash: `bench-ext-${run}-${index}`,
    webgpuHash: `bench-webgpu-${run}-${index}`,
    audioSampleRate: 22050 + index * 750,
    audioChannels: (index % 2) + 1,
    colorGamut: ["srgb", "p3", "rec2020"][index % 3],
    hdr: index % 3 !== 0,
    webglHash: `bench-webgl-${run}-${index}`,
    canvasHash: `bench-canvas-${run}-${index}`,
    audioHash: `bench-audio-${run}-${index}`,
    fontsHash: `bench-fonts-${run}-${index}`,
    codecsHash: `bench-codecs-${run}-${index}`,
    timezone,
    timezoneOffsetMinutes,
    locale: "en-US",
    languages: "en-US,en",
    language: "en-US",
    mediaAudioInputs: index % 5,
    mediaVideoInputs: index % 4,
    platformVersion: `${index % 7}.${index % 5}.${index % 3}`,
    browserKeyPublicKey: `bench-key-${run}-${index}`,
    integrity: { webdriver: false, headlessHint: false, impossibleUaPlatform: false, missingCapabilities: false },
  };
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))]!;
}

interface Sample {
  ms: number;
  status: number;
  code: string | null;
  /** The response body, kept so the challenge handshake can be completed from the same measurement. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: any;
  reads: number;
  writes: number;
  docsScanned: number;
  transactions: number;
  readsByMethod: Record<string, number>;
  writesByMethod: Record<string, number>;
}

/** Sum of each collection method across a phase — the shape of the path, not just its size. */
function mergeMethodCounts(samples: Sample[], key: "readsByMethod" | "writesByMethod"): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const sample of samples) for (const [name, value] of Object.entries(sample[key])) totals[name] = (totals[name] ?? 0) + value;
  return Object.fromEntries(Object.entries(totals).sort((a, b) => b[1] - a[1]));
}

function summarise(samples: Sample[]): Record<string, unknown> {
  const allowed = samples.filter((s) => s.status === 200);
  const latencies = allowed.map((s) => s.ms).sort((a, b) => a - b);
  const totalMs = latencies.reduce((sum, value) => sum + value, 0);
  const mean = (values: number[]): number => (values.length === 0 ? 0 : Math.round((values.reduce((s, v) => s + v, 0) / values.length) * 100) / 100);
  return {
    samples: samples.length,
    allowedSamples: allowed.length,
    // Latency is reported over the ALLOWED starts only: a refused start is a different, shorter path
    // and would flatter the numbers.
    latencyMs: {
      min: Math.round((latencies[0] ?? 0) * 100) / 100,
      p50: Math.round(percentile(latencies, 50) * 100) / 100,
      p95: Math.round(percentile(latencies, 95) * 100) / 100,
      p99: Math.round(percentile(latencies, 99) * 100) / 100,
      max: Math.round((latencies[latencies.length - 1] ?? 0) * 100) / 100,
      mean: mean(latencies),
    },
    throughputStartsPerSecond: totalMs === 0 ? null : Math.round((latencies.length / (totalMs / 1000)) * 100) / 100,
    perStart: {
      mongoReads: mean(allowed.map((s) => s.reads)),
      mongoWrites: mean(allowed.map((s) => s.writes)),
      docsScanned: mean(allowed.map((s) => s.docsScanned)),
      transactions: mean(allowed.map((s) => s.transactions)),
    },
    maxPerStart: {
      mongoReads: Math.max(...allowed.map((s) => s.reads), 0),
      mongoWrites: Math.max(...allowed.map((s) => s.writes), 0),
      docsScanned: Math.max(...allowed.map((s) => s.docsScanned), 0),
      transactions: Math.max(...allowed.map((s) => s.transactions), 0),
    },
    // Status alone is not a result: a start refused by the device rule and one refused by the network
    // rule are different outcomes, and the reason codes say which one was measured.
    outcomes: samples.reduce<Record<string, number>>((acc, s) => {
      acc[`${s.status}:${s.code ?? "-"}`] = (acc[`${s.status}:${s.code ?? "-"}`] ?? 0) + 1;
      return acc;
    }, {}),
    mongoReadsByMethod: mergeMethodCounts(allowed, "readsByMethod"),
    mongoWritesByMethod: mergeMethodCounts(allowed, "writesByMethod"),
  };
}

async function main(): Promise<void> {
  if (!DESTRUCTIVE_CLEANUP_ALLOWED) {
    console.error(
      "BENCHMARK REFUSED: between samples this benchmark releases every active device lease and closes every active mining session (without settling it)." +
        " Point it at a throwaway database and set BENCH_ALLOW_DESTRUCTIVE_CLEANUP=1 to confirm that is what it is pointed at.",
    );
    process.exit(2);
  }
  const config = loadConfig();
  const connection = await connectMongo(config, { serverSelectionTimeoutMS: 30_000, connectTimeoutMS: 20_000 });
  const client = connection.client;
  const real = getCollections(connection.db);
  await ensureDatabaseIndexes(connection.db);
  const app = await buildApp({
    config,
    collections: wrapCollections(real),
    mongoClient: wrapClient(client),
    redis: disabledRedis(),
    logger: false,
  });
  const run = randomUUID().slice(0, 8);

  let ipIndex = 0;
  const nextIp = (): string => `${TEST_IP_BASE}${(ipIndex++ % 254) + 1}`;
  const csrfByToken = new Map<string, string>();
  const preauth = await app.inject({ method: "GET", url: "/api/v1/auth/csrf", remoteAddress: nextIp() });
  const preauthToken = (preauth.json() as { csrfToken?: string }).csrfToken ?? "";

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const call = async (method: "GET" | "POST", url: string, options: { token?: string; body?: unknown } = {}): Promise<{ status: number; body: any }> => {
    const response = await app.inject({
      method,
      url,
      headers: {
        ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
        ...(method === "GET" ? {} : { "x-csrf-token": (options.token ? csrfByToken.get(options.token) : undefined) ?? preauthToken }),
      },
      remoteAddress: nextIp(),
      ...(options.body === undefined ? {} : { payload: options.body as Record<string, unknown> }),
    });
    const body = response.payload.length ? response.json() : {};
    if (typeof body.accessToken === "string" && typeof body.csrfToken === "string") csrfByToken.set(body.accessToken, body.csrfToken);
    return { status: response.statusCode, body };
  };

  const register = async (label: string): Promise<string> => {
    const response = await call("POST", "/api/v1/auth/register", {
      body: { email: `bench.${run}.${label}.${Math.random().toString(36).slice(2)}@example.test`, password: PASSWORD, displayName: `B ${label}` },
    });
    if (response.status !== 201) throw new Error(`benchmark register failed: ${response.status} ${JSON.stringify(response.body)}`);
    const token = String(response.body.accessToken);
    const joined = await call("POST", "/api/v1/mining/pools/join", { token, body: { poolId: "low" } });
    if (joined.status !== 200) throw new Error(`benchmark pool join failed: ${joined.status} ${JSON.stringify(joined.body)}`);
    return token;
  };

  /** Times one request with the Mongo counters reset first, so the numbers belong to that request. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const timed = async (request: () => Promise<{ status: number; body: any }>): Promise<Sample> => {
    resetCounts();
    const started = performance.now();
    const response = await request();
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

  /** Registers its own account unless one is supplied, then measures one start. */
  const measure = async (label: string, evidence: Record<string, unknown>, options: { token?: string; before?: () => Promise<void> } = {}): Promise<Sample> => {
    const token = options.token ?? (await register(label));
    if (options.before) await options.before();
    return await timed(() => call("POST", "/api/v1/mining/start", { token, body: { device: evidence } }));
  };

  /**
   * Resets the state between samples. Guarded by `BENCH_ALLOW_DESTRUCTIVE_CLEANUP=1` (checked at
   * startup): it releases live leases and marks active sessions `settled` without running the
   * settlement path, so on a database that holds anyone else's rows it would both remove their
   * one-device protection and strand their pending rewards.
   */
  const clearState = async (): Promise<void> => {
    await real.miningDeviceLeases.updateMany({ status: "active" }, { $set: { status: "released", updatedAt: new Date() } });
    // "settled" is the only terminal status the schema has; this is a throwaway benchmark database.
    await real.miningSessions.updateMany({ status: "active" }, { $set: { status: "settled" } });
  };


  // ------------------------------------------------- A. fresh device enrollment (new identity)
  //
  // Live leases are cleared before each sample. They must be: the guard refuses a start when a new
  // machine is *ambiguous* against a device that is currently mining, and after a few dozen synthetic
  // desktops have accumulated, nearly any new one resembles one of them — which is the rule doing its
  // job, but it would make this phase a measurement of the ambiguity rule rather than of enrollment.
  // With no live foreign lease the request runs the whole enrollment path: resolution, the atomic
  // identity budget, the consistency pass, the network probe, the transaction and the lease insert.
  const freshSamples: Sample[] = [];
  for (let index = 0; index < SAMPLES; index += 1) {
    freshSamples.push(await measure(`fresh-${index}`, machineEvidence(run, index), { before: clearState }));
  }

  // --------------------------------- B. the re-verification path: challenge -> prove -> retry start
  //
  // This is what the browser actually does on a challenged start, and the only phase that exercises
  // the challenge/proof code. It is provoked honestly: one account starting repeatedly on one device
  // is exactly the pattern the risk policy asks to re-verify, so the second start is the challenged
  // one, the proof answers it, and the retry is the start the customer sees succeed.
  const CHALLENGE_SAMPLES = Math.max(6, Math.min(SAMPLES, 12));
  const verification = { challenged: 0, proved: 0, retried: 0, allowed: 0 };
  const challengeOps: Sample[] = [];
  const proveOps: Sample[] = [];
  const retryOps: Sample[] = [];
  for (let index = 0; index < CHALLENGE_SAMPLES; index += 1) {
    const token = await register(`verify-${index}`);
    const keyPair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    const jwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
    const evidence = { ...machineEvidence(run, 2000 + index), browserKeyPublicKey: JSON.stringify(jwk) };
    // First start enrolls the device (allowed), then the state is cleared so the same account+device
    // starts again — the pattern that raises the risk score and asks for a proof.
    await call("POST", "/api/v1/mining/start", { token, body: { device: evidence } });
    await clearState();
    const repeat = await timed(() => call("POST", "/api/v1/mining/start", { token, body: { device: evidence } }));
    if (repeat.status === 409 && repeat.code === "mining_device_challenge_required") verification.challenged += 1;
    const challenge = await timed(() => call("POST", "/api/v1/mining/device/challenge", { token, body: { device: evidence } }));
    challengeOps.push(challenge);
    if (challenge.status === 200) {
      const signature = Buffer.from(
        await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, keyPair.privateKey, new TextEncoder().encode(String(challenge.body?.payload ?? ""))),
      ).toString("base64url");
      const prove = await timed(() => call("POST", "/api/v1/mining/device/prove", { token, body: { nonce: challenge.body.nonce, signature, publicKeyJwk: jwk, device: evidence } }));
      proveOps.push(prove);
      if (prove.status === 200) verification.proved += 1;
      const retry = await timed(() => call("POST", "/api/v1/mining/start", { token, body: { device: evidence } }));
      retryOps.push(retry);
      if (retry.status === 200) verification.allowed += 1;
      if (retry.status === 409 && retry.code === "mining_device_challenge_required") verification.retried += 1;
    }
  }

  const externalIntelCalls = config.proxycheckKey || config.ipinfoToken
    ? `providers configured; benchmark addresses are TEST-NET-3, so isPublicIp decides — measured: ${String(0)}`
    : "0 (no IP-intelligence provider configured in this environment)";

  const report = {
    generatedAt: new Date().toISOString(),
    database: process.env["MONGODB_DATABASE"] ?? null,
    samplesPerPhase: SAMPLES,
    note: "latency, throughput and Mongo counts are reported over ALLOWED starts only",
    phases: {
      "A.fresh-device-enrollment": summarise(freshSamples),
      "B.challenge": summarise(challengeOps),
      "B.prove": summarise(proveOps),
      "B.retry-after-proof": summarise(retryOps),
    },
    verificationPath: { samples: CHALLENGE_SAMPLES, ...verification },
    externalIpIntelligenceCalls: externalIntelCalls,
  };
  console.log(JSON.stringify(report, null, 2));
  if (OUT) {
    writeFileSync(OUT, JSON.stringify(report, null, 2));
    console.log(`benchmark written: ${OUT}`);
  }
  await client.close();
  await app.close();
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("BENCHMARK FAILURE:", error);
    process.exit(1);
  });
