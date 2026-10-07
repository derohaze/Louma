/**
 * Temporary onboarding probe (not a suite): what can refuse a user who has NEVER mined?
 *
 * One scenario walks one fresh account (and, where the scenario needs an established miner, a
 * second/third one) through the real HTTP routes against a throwaway database. Each result records
 * the HTTP status, the error code, how many of the scenario's accounts ended with an active cycle,
 * and how many device clusters the two accounts resolved to.
 *
 * Scenario families:
 *   F1  clean first mining                       — brand-new account, device and network
 *   F2  same model, different physical machine   — identical engine-stable core slots, everything
 *                                                  else different (RAM class, capture devices,
 *                                                  rendering stack, screen, locale, network)
 *   F3  one network, two machines                — second machine behind the first's live cycle
 *   F4  network enrollment budget saturated      — first-ever start after the network's new-cluster
 *                                                  budget was spent by other accounts
 *   F5  masked graphics evidence                 — privacy-browser shape
 *   F6  identical evidence, sequential           — the control for "two accounts, one device"
 *   F7  identical evidence, concurrent           — the same, racing
 *
 * Usage:
 *   MONGODB_URI=... MONGODB_DATABASE=louma_first_mining_probe BENCH_ALLOW_DESTRUCTIVE_CLEANUP=1 \
 *     node --env-file-if-exists=.env.development --import tsx src/tests/lmdg-first-mining-probe.ts
 */
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { buildApp } from "../app.js";
import { loadConfig } from "../config/env.js";
import { connectMongo } from "../infrastructure/mongodb/client.js";
import { ensureDatabaseIndexes } from "../infrastructure/mongodb/indexes.js";
import { getCollections } from "../infrastructure/mongodb/collections.js";
import { disabledRedis } from "../infrastructure/redis/client.js";

const PASSWORD = "SmokeTest1234";
const OUT = process.env["PROBE_OUT"] ?? null;
const RUN = randomUUID().slice(0, 8);
if ((process.env["BENCH_ALLOW_DESTRUCTIVE_CLEANUP"] ?? "").trim() !== "1") {
  console.error("PROBE REFUSED: point it at a throwaway database and set BENCH_ALLOW_DESTRUCTIVE_CLEANUP=1.");
  process.exit(2);
}

const CHROME_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const FIREFOX_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0";

/**
 * The engine-stable core slots the guard hashes. Two *different physical* machines of one model
 * share every one of these, which is what F2 exists to measure.
 */
const MODEL_CORES = [
  { hardwareConcurrency: 8, maxTouchPoints: 0, audioSampleRate: 48000, audioChannels: 2, colorGamut: "srgb", hdr: false, screenColorDepth: 24 },
  { hardwareConcurrency: 4, maxTouchPoints: 5, audioSampleRate: 44100, audioChannels: 2, colorGamut: "p3", hdr: true, screenColorDepth: 32 },
  { hardwareConcurrency: 16, maxTouchPoints: 0, audioSampleRate: 48000, audioChannels: 2, colorGamut: "rec2020", hdr: true, screenColorDepth: 30 },
  { hardwareConcurrency: 2, maxTouchPoints: 10, audioSampleRate: 22050, audioChannels: 1, colorGamut: "srgb", hdr: false, screenColorDepth: 30 },
];

const SCREENS: [number, number, number][] = [
  [1366, 768, 1], [1920, 1080, 1], [1440, 900, 2], [2560, 1440, 1], [3440, 1440, 1.25], [2880, 1800, 2],
];
const ZONES: [string, number][] = [
  ["Africa/Cairo", -180], ["Europe/London", 0], ["America/New_York", 300], ["Asia/Tokyo", -540], ["Europe/Berlin", -120], ["America/Sao_Paulo", 180],
];

interface PhysicalSpec {
  /** Which MODEL_CORES entry the device's core slots come from. */
  model: number;
  /** A distinct physical machine index: every non-core field moves with it. */
  physical: number;
  ip: string;
  browser?: "chrome" | "firefox";
}

/**
 * A core-slot combination unique per index, for scenarios that need several unmistakably *distinct*
 * machines (a shared network, so the network rules are the ones that can answer).
 */
function uniqueCore(index: number): Record<string, unknown> {
  return {
    hardwareConcurrency: [2, 4, 8, 16][index % 4]!,
    maxTouchPoints: [0, 5, 10][Math.floor(index / 4) % 3]!,
    audioSampleRate: 22050 + (Math.floor(index / 12) % 8) * 4000,
    audioChannels: (Math.floor(index / 96) % 2) + 1,
    colorGamut: ["srgb", "p3", "rec2020"][Math.floor(index / 192) % 3]!,
    hdr: Math.floor(index / 576) % 2 === 1,
    screenColorDepth: [24, 30, 32][Math.floor(index / 1152) % 3]!,
  };
}

/** One simulated physical computer: `model` fixes the identity slots, `physical` everything else. */
function device(spec: PhysicalSpec): Record<string, unknown> {
  const core = MODEL_CORES[spec.model % MODEL_CORES.length]!;
  const i = spec.physical;
  const [width, height, pixelRatio] = SCREENS[i % SCREENS.length]!;
  const [timezone, timezoneOffsetMinutes] = ZONES[i % ZONES.length]!;
  const browser = spec.browser ?? "chrome";
  const tag = `${RUN}-m${spec.model}-p${i}-${browser}`;
  return {
    ...core,
    platform: "Win32",
    userAgent: browser === "firefox" ? FIREFOX_UA : CHROME_UA,
    platformVersion: `10.0.${19000 + i}`,
    screenWidth: width,
    screenHeight: height,
    screenAvailWidth: width,
    screenAvailHeight: height - (i % 5) * 8,
    pixelRatio,
    // A machine-class trait, and NOT in the core: two machines of one model with different RAM
    // still hash to the same machine key.
    deviceMemory: [2, 4, 8, 16][i % 4]!,
    // Deliberately 0 for chrome (touch class is a core slot and must stay equal inside a model).
    mediaAudioInputs: browser === "firefox" ? null : i % 3,
    mediaVideoInputs: browser === "firefox" ? null : (i + 1) % 3,
    webglVendor: `vendor-${tag}`,
    webglRenderer: `renderer-${tag}`,
    webglLimitsHash: `limits-${tag}`,
    webglExtensionsHash: `extensions-${tag}`,
    webgpuHash: browser === "firefox" ? null : `webgpu-${tag}`,
    webglHash: `webgl-${tag}`,
    canvasHash: `canvas-${tag}`,
    audioHash: `audio-${tag}`,
    fontsHash: `fonts-${tag}`,
    speechVoicesHash: `voices-${tag}`,
    codecsHash: `codecs-${tag}`,
    mimeTypesHash: `mime-${tag}`,
    pluginsHash: `plugins-${tag}`,
    keyboardLayoutHash: `kbd-${tag}`,
    storageQuotaBytes: 1_000_000_000 + i * 1_000_000,
    pdfViewerEnabled: true,
    timezone,
    timezoneOffsetMinutes,
    locale: i % 2 === 0 ? "en-US" : "ar-EG",
    language: i % 2 === 0 ? "en-US" : "ar-EG",
    languages: i % 2 === 0 ? "en-US,en" : "ar-EG,ar",
    visitorId: `visitor-${tag}`,
    browserKeyPublicKey: `key-${tag}`,
    fingerprintConfidence: 0.95,
    fingerprintVersion: "v5",
    integrity: { webdriver: false, headlessHint: false, impossibleUaPlatform: false, missingCapabilities: false },
  };
}

/** The privacy-browser shape: graphics masked, so the evidence gate should refuse it. */
function maskedGraphics(spec: PhysicalSpec): Record<string, unknown> {
  return { ...device(spec), webglVendor: "Mozilla", webglRenderer: "Mozilla" };
}

async function main(): Promise<void> {
  const config = loadConfig();
  const connection = await connectMongo(config, { serverSelectionTimeoutMS: 30_000, connectTimeoutMS: 20_000 });
  const client = connection.client;
  const collections = getCollections(connection.db);
  await ensureDatabaseIndexes(connection.db);
  const app = await buildApp({ config, collections, mongoClient: client, redis: disabledRedis(), logger: false });

  let ipIndex = 0;
  const nextIp = (): string => {
    const index = ipIndex++;
    return `10.211.${Math.floor(index / 254) % 254}.${(index % 254) + 1}`;
  };
  const csrfByToken = new Map<string, string>();
  const preauth = await app.inject({ method: "GET", url: "/api/v1/auth/csrf", remoteAddress: nextIp() });
  const preauthToken = (preauth.json() as { csrfToken?: string }).csrfToken ?? "";

  const call = async (
    method: "GET" | "POST",
    url: string,
    options: { token?: string; body?: unknown; ip?: string } = {},
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ): Promise<{ status: number; body: any }> => {
    const response = await app.inject({
      method,
      url,
      headers: {
        ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
        ...(method === "GET" ? {} : { "x-csrf-token": (options.token ? csrfByToken.get(options.token) : undefined) ?? preauthToken }),
      },
      remoteAddress: options.ip ?? nextIp(),
      ...(options.body === undefined ? {} : { payload: options.body as Record<string, unknown> }),
    });
    const body = response.payload.length ? response.json() : {};
    if (typeof body.accessToken === "string" && typeof body.csrfToken === "string") csrfByToken.set(body.accessToken, body.csrfToken);
    return { status: response.statusCode, body };
  };

  const register = async (label: string): Promise<{ token: string; userId: string }> => {
    const slug = label.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 24);
    const response = await call("POST", "/api/v1/auth/register", {
      body: { email: `probe.${RUN}.${slug}.${Math.random().toString(36).slice(2)}@example.test`, password: PASSWORD, displayName: `Probe ${slug}`.slice(0, 32) },
    });
    if (response.status !== 201) throw new Error(`register failed: ${response.status} ${JSON.stringify(response.body)}`);
    return { token: String(response.body.accessToken), userId: String(response.body.user?.id ?? "") };
  };

  const joinPool = async (token: string): Promise<void> => {
    const joined = await call("POST", "/api/v1/mining/pools/join", { token, body: { poolId: "low" } });
    if (joined.status !== 200) throw new Error(`join failed: ${joined.status} ${JSON.stringify(joined.body)}`);
  };

  /** A brand-new account, already a pool member: what the customer's first Start does. */
  const freshMiner = async (label: string): Promise<{ token: string; userId: string }> => {
    const account = await register(label);
    await joinPool(account.token);
    return account;
  };

  const start = async (token: string, evidence: Record<string, unknown>, ip: string): Promise<{ status: number; body: unknown }> =>
    call("POST", "/api/v1/mining/start", { token, body: { device: evidence }, ip });

  const stop = async (token: string): Promise<void> => {
    await call("POST", "/api/v1/mining/stop", { token });
  };

  const codeOf = (result: { status: number; body: unknown }): string =>
    (result.body as { error?: { code?: string } }).error?.code ?? "-";

  interface Result {
    name: string;
    expectation: string;
    statuses: number[];
    codes: string[];
    activeSessions: number;
    devices: number;
    machineKeys: number;
    note: string;
  }
  const results: Result[] = [];
  const record = async (input: {
    name: string;
    expectation: string;
    first: { status: number; body: unknown };
    second: { status: number; body: unknown };
    accounts: { token: string; userId: string }[];
    note?: string;
  }): Promise<Result> => {
    const active = await collections.miningSessions.countDocuments({ ownerUserId: { $in: input.accounts.map((a) => a.userId) }, status: "active" });
    const devices = await collections.miningDevices
      .find({ enrollmentUserId: { $in: input.accounts.map((a) => a.userId) } }, { projection: { machineKeyHash: 1 } })
      .toArray();
    const machineKeys = new Set(devices.map((d) => d.machineKeyHash).filter((v): v is string => typeof v === "string")).size;
    const row: Result = {
      name: input.name,
      expectation: input.expectation,
      statuses: [input.first.status, input.second.status],
      codes: [codeOf(input.first), codeOf(input.second)],
      activeSessions: active,
      devices: devices.length,
      machineKeys,
      note: input.note ?? "",
    };
    results.push(row);
    console.log(`${row.name}: statuses=${row.statuses.join(",")} codes=${row.codes.join(",")} activeSessions=${active} devices=${devices.length} machineKeys=${machineKeys}  [expected ${row.expectation}]`);
    return row;
  };

  // ---------------------------------------------------------------- F1
  {
    const ip = nextIp();
    const a = await freshMiner("F1-a");
    const first = await start(a.token, device({ model: 0, physical: 0, ip }), ip);
    const second = { status: 0, body: {} };
    await record({ name: "F1 clean first mining", expectation: "200 allow", first, second, accounts: [a], note: "brand-new account, device and network" });
    await stop(a.token);
  }

  // ---------------------------------------------------------------- F2
  {
    const ipA = nextIp();
    const ipB = nextIp();
    const a = await freshMiner("F2-a");
    const b = await freshMiner("F2-b");
    const first = await start(a.token, device({ model: 0, physical: 10, ip: ipA }), ipA);
    // Same model -> identical core slots; different RAM class, capture devices, rendering stack,
    // screen, locale and network -> a different physical machine.
    const second = await start(b.token, device({ model: 0, physical: 11, browser: "firefox", ip: ipB }), ipB);
    await record({
      name: "F2 same model, other physical machine",
      expectation: "200 allow (a different computer)",
      first,
      second,
      accounts: [a, b],
      note: "identical identity slots, everything else different",
    });
    await stop(a.token);
  }

  // ---------------------------------------------------------------- F3
  {
    const ip = nextIp();
    const a = await freshMiner("F3-a");
    const b = await freshMiner("F3-b");
    const first = await start(a.token, device({ model: 1, physical: 20, ip }), ip);
    const second = await start(b.token, device({ model: 2, physical: 21, ip }), ip);
    await record({
      name: "F3 one network, two machines",
      expectation: "409 mining_device_network_in_use (documented)",
      first,
      second,
      accounts: [a, b],
      note: "second brand-new machine behind the first's live cycle",
    });
    await stop(a.token);
  }

  // ---------------------------------------------------------------- F4
  {
    const ip = nextIp();
    // Other accounts spend this network's new-cluster budget: each attempted start still enrolled a
    // first-seen identity, which is what the per-network budget counts. Every "other" machine is
    // unmistakably distinct (unique core slots), so no class correlation can shadow the measurement.
    let lastOther: { status: number; body: unknown } | null = null;
    for (let i = 0; i < 9; i += 1) {
      const other = await freshMiner(`F4-other-${i}`);
      lastOther = await start(other.token, { ...device({ model: 3, physical: 30 + i, ip }), ...uniqueCore(i) }, ip);
    }
    const fresh = await freshMiner("F4-fresh");
    const first = await start(fresh.token, { ...device({ model: 3, physical: 60, ip }), ...uniqueCore(40) }, ip);
    await record({
      name: "F4 network budget spent",
      // Before the shared-address sizing fix this was `403 mining_device_enrollment_limited`: the
      // tenth brand-new user was refused for other accounts' enrollments. Now the enrollment is
      // admitted and only the lease-bounded network rule can refuse it (409 while the first
      // machine's cycle runs), which is the same answer any fresh machine on that network gets.
      expectation: "200 allow, else 409 mining_device_network_in_use (never 403 enrollment_limited)",
      first,
      second: lastOther ?? { status: 0, body: {} },
      accounts: [fresh],
      note: "first-ever start from a network whose budget other accounts spent",
    });
  }

  // ---------------------------------------------------------------- F8
  {
    // The same-model refusal is bounded by the live cycle: once the other machine stops, the
    // newcomer is free to enroll and mine its own cycle.
    const ipA = nextIp();
    const ipB = nextIp();
    const a = await freshMiner("F8-a");
    const b = await freshMiner("F8-b");
    const first = await start(a.token, device({ model: 1, physical: 100, ip: ipA }), ipA);
    await stop(a.token);
    const second = await start(b.token, device({ model: 1, physical: 101, browser: "firefox", ip: ipB }), ipB);
    await record({
      name: "F8 same model after the other stops",
      expectation: "200 allow (the block is bounded by the live lease)",
      first,
      second,
      accounts: [a, b],
      note: "first machine stops, then the second of the same model starts",
    });
    await stop(b.token);
  }

  // ---------------------------------------------------------------- F9
  {
    // A third account on the same device while the first mines: refused too, and no second lease.
    const ip = nextIp();
    const a = await freshMiner("F9-a");
    const b = await freshMiner("F9-b");
    const c = await freshMiner("F9-c");
    const ipB = nextIp();
    const ipC = nextIp();
    const evidence = { ...device({ model: 0, physical: 110, ip }), visitorId: `visitor-three-${RUN}`, browserKeyPublicKey: `key-three-${RUN}` };
    const first = await start(a.token, evidence, ip);
    // Distinct peer addresses: the device rule is the one answering, not the network rule.
    const [second, third] = await Promise.all([start(b.token, evidence, ipB), start(c.token, evidence, ipC)]);
    await record({
      name: "F9 third account, one device",
      expectation: "one 200 + 409 + 409",
      first,
      second,
      accounts: [a, b, c],
      note: `third=${third.status}/${codeOf(third)}`,
    });
    await stop(a.token);
  }

  // ---------------------------------------------------------------- F5
  {
    const ip = nextIp();
    const a = await freshMiner("F5-a");
    const first = await start(a.token, maskedGraphics({ model: 0, physical: 70, ip }), ip);
    await record({
      name: "F5 masked graphics",
      expectation: "400 mining_device_evidence_required (documented)",
      first,
      second: { status: 0, body: {} },
      accounts: [a],
      note: "privacy-browser shape",
    });
  }

  // ---------------------------------------------------------------- F6 / F7
  for (const concurrent of [false, true]) {
    const ipA = nextIp();
    const ipB = nextIp();
    const a = await freshMiner(concurrent ? "F7-a" : "F6-a");
    const b = await freshMiner(concurrent ? "F7-b" : "F6-b");
    const evidenceA = { ...device({ model: 2, physical: 80, ip: ipA }), visitorId: `visitor-identical-${RUN}`, browserKeyPublicKey: `key-identical-${RUN}` };
    const evidenceB = { ...evidenceA };
    let first: { status: number; body: unknown };
    let second: { status: number; body: unknown };
    if (concurrent) {
      [first, second] = await Promise.all([start(a.token, evidenceA, ipA), start(b.token, evidenceB, ipB)]);
    } else {
      first = await start(a.token, evidenceA, ipA);
      second = await start(b.token, evidenceB, ipB);
    }
    await record({
      name: concurrent ? "F7 identical evidence, concurrent" : "F6 identical evidence, sequential",
      expectation: "one 200 + one 409 device_already_in_use",
      first,
      second,
      accounts: [a, b],
      note: "two accounts, one device",
    });
    await stop(a.token);
    await stop(b.token);
  }

  const report = { generatedAt: new Date().toISOString(), run: RUN, database: process.env["MONGODB_DATABASE"] ?? null, results };
  console.log(JSON.stringify(report, null, 2));
  if (OUT) writeFileSync(OUT, JSON.stringify(report, null, 2));
  await app.close();
  await client.close();
  process.exit(0);
}

main().catch((error) => {
  console.error("PROBE FAILURE:", error);
  process.exit(1);
});
