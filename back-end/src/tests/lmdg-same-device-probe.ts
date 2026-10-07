/**
 * Temporary attack probe (not a suite): can two accounts mine from one machine?
 *
 * One scenario = one unmistakably distinct simulated machine (physical traits, memory, capture
 * devices, display, timezone, rendering stack all move with the scenario index), two fresh accounts,
 * and two browser profiles *on that machine*:
 *   - "engine" profile  : a second browser/engine on the same computer (Firefox: no deviceMemory,
 *                         different media stack, fonts, codecs, GPU strings, rendering digests)
 *   - mutations         : the engine profile with one or two *core machine slots* changed
 *                         (gamut, audio device) — i.e. the machine lying about its own hardware
 *   - "identical"       : byte-identical evidence from the second account (control)
 *   - "presentation"    : platform/UA/timezone spoofed, core untouched
 *
 * Each scenario runs both sequential (B after A) and concurrent (both in flight), and primary
 * scenarios use distinct networks so the *device* rule is what answers; dedicated variants reuse
 * one network for A and B to see the network rule take over. Cycles are stopped between scenarios,
 * and the probe reports any scenario that ends with two active cycles as a BREACH.
 *
 * Usage:
 *   MONGODB_URI=... MONGODB_DATABASE=louma_same_device_probe BENCH_ALLOW_DESTRUCTIVE_CLEANUP=1 \
 *     node --env-file-if-exists=.env.development --import tsx src/tests/lmdg-same-device-probe.ts
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

const WINDOWS_CHROME_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const WINDOWS_FIREFOX_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0";
const MAC_CHROME_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const MAC_FIREFOX_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:127.0) Gecko/20100101 Firefox/127.0";
const LINUX_CHROME_UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const LINUX_FIREFOX_UA =
  "Mozilla/5.0 (X11; Linux x86_64; rv:127.0) Gecko/20100101 Firefox/127.0";

const PLATFORMS = [
  { platform: "Win32", chrome: WINDOWS_CHROME_UA, firefox: WINDOWS_FIREFOX_UA, version: (i: number) => `10.0.${19000 + i}` },
  { platform: "MacIntel", chrome: MAC_CHROME_UA, firefox: MAC_FIREFOX_UA, version: (i: number) => `14.${i}` },
  { platform: "Linux x86_64", chrome: LINUX_CHROME_UA, firefox: LINUX_FIREFOX_UA, version: (i: number) => `6.${i}` },
];
const SCREENS: [number, number, number][] = [
  [1366, 768, 1], [1920, 1080, 1], [1440, 900, 2], [1600, 900, 1],
  [2560, 1440, 1], [2880, 1800, 2], [3440, 1440, 1], [3000, 2000, 1.25],
  [1728, 1117, 2], [3840, 2160, 1.5], [1536, 864, 1.25], [2048, 1536, 2],
];
const CPU = [2, 4, 6, 8, 12, 16, 24, 10, 3, 20, 14, 5];
const MEMORY = [2, 4, 8, 16, 32, 8, 16, 4, 32, 2, 8, 16];
const TOUCH = [0, 0, 0, 5, 0, 10, 0, 0, 5, 0, 10, 0];
const MEDIA: [number, number][] = [[0, 0], [1, 1], [2, 1], [1, 0], [3, 2], [2, 1], [4, 2], [0, 1], [1, 1], [2, 2], [0, 0], [3, 1]];
const GAMUT = ["srgb", "srgb", "p3", "srgb", "rec2020", "p3", "srgb", "p3", "p3", "rec2020", "srgb", "rec2020"];
const HDR = [false, false, true, false, true, true, false, true, true, true, false, true];
const DEPTH = [24, 32, 30, 24, 30, 32, 24, 32, 30, 30, 24, 32];
const ZONES: [string, number][] = [
  ["Africa/Cairo", -180], ["Europe/London", 0], ["Asia/Dubai", -240], ["America/New_York", 300],
  ["Europe/Berlin", -120], ["Asia/Riyadh", -180], ["Asia/Tokyo", -540], ["Europe/Madrid", -120],
  ["America/Sao_Paulo", 180], ["Asia/Karachi", -300], ["Europe/Warsaw", -120], ["America/Chicago", 360],
];

/**
 * One distinct simulated computer per scenario index. The machine core the guard hashes (CPU class,
 * touch class, audio device, gamut, HDR, panel depth) moves with the index, and so do the
 * corroborating traits (memory, capture devices, fonts) and the engine-visible ones (screen, GPU,
 * rendering digests, timezone, platform) — so two scenarios can never correlate as one machine.
 */
function machineFor(index: number, browser: "chrome" | "firefox"): Record<string, unknown> {
  const system = PLATFORMS[index % PLATFORMS.length]!;
  const [width, height, pixelRatio] = SCREENS[index % SCREENS.length]!;
  const [timezone, timezoneOffsetMinutes] = ZONES[index % ZONES.length]!;
  const [mediaAudioInputs, mediaVideoInputs] = MEDIA[index % MEDIA.length]!;
  const firefox = browser === "firefox";
  return {
    platform: system.platform,
    userAgent: firefox ? system.firefox : system.chrome,
    platformVersion: system.version(index),
    screenWidth: width,
    screenHeight: height,
    screenAvailWidth: width,
    screenAvailHeight: height - (index % 5) * 8,
    screenColorDepth: DEPTH[index % DEPTH.length],
    pixelRatio,
    hardwareConcurrency: CPU[index % CPU.length],
    // Firefox cannot report navigator.deviceMemory at all; a null is absent, never a value.
    deviceMemory: firefox ? null : MEMORY[index % MEMORY.length],
    maxTouchPoints: TOUCH[index % TOUCH.length],
    // Real Firefox answers enumerateDevices() only once its media stack started; the engine fixture
    // answers for none, the media variant reports the same devices Chrome saw.
    mediaAudioInputs: firefox ? null : mediaAudioInputs,
    mediaVideoInputs: firefox ? null : mediaVideoInputs,
    colorGamut: GAMUT[index % GAMUT.length],
    hdr: HDR[index % HDR.length],
    audioSampleRate: 22050 + index * 750,
    audioChannels: (index % 2) + 1,
    webglVendor: `vendor-${browser}-${RUN}-${index}`,
    webglRenderer: `renderer-${browser}-${RUN}-${index}`,
    webglLimitsHash: `limits-${browser}-${RUN}-${index}`,
    webglExtensionsHash: `extensions-${browser}-${RUN}-${index}`,
    webgpuHash: firefox ? null : `webgpu-chrome-${RUN}-${index}`,
    webglHash: `webgl-${browser}-${RUN}-${index}`,
    canvasHash: `canvas-${browser}-${RUN}-${index}`,
    audioHash: `audio-${browser}-${RUN}-${index}`,
    fontsHash: `fonts-${browser}-${RUN}-${index}`,
    codecsHash: `codecs-${browser}-${RUN}-${index}`,
    mimeTypesHash: `mime-${browser}-${RUN}-${index}`,
    speechVoicesHash: `voices-${browser}-${RUN}-${index}`,
    timezone,
    timezoneOffsetMinutes,
    language: "en-US",
    languages: "en-US,en",
    locale: "en-US",
    fingerprintConfidence: 0.95,
    fingerprintVersion: "v5",
    integrity: { webdriver: false, headlessHint: false, impossibleUaPlatform: false, missingCapabilities: false },
  };
}

/**
 * The Firefox media variant: the engine answered `enumerateDevices()` and reports the same devices
 * Chrome saw. One scenario mutates a core slot on top of this.
 */
function firefoxWithMedia(index: number): Record<string, unknown> {
  const [audio, video] = MEDIA[index % MEDIA.length]!;
  return { ...machineFor(index, "firefox"), mediaAudioInputs: audio, mediaVideoInputs: video };
}

interface Scenario {
  name: string;
  /** Evidence for account B on the same machine. */
  b: (index: number) => Record<string, unknown>;
  /** Both starts in flight together instead of B after A. */
  concurrent: boolean;
  /** A and B share one peer address (the network rule answers); default is distinct addresses. */
  sameNetwork: boolean;
}

const SCENARIOS: Scenario[] = [
  { name: "S1 firefox-engine", b: (i) => machineFor(i, "firefox"), concurrent: false, sameNetwork: false },
  { name: "S2 race firefox-engine", b: (i) => machineFor(i, "firefox"), concurrent: true, sameNetwork: false },
  { name: "S3 firefox-with-media", b: firefoxWithMedia, concurrent: false, sameNetwork: false },
  { name: "S4 race firefox-with-media", b: firefoxWithMedia, concurrent: true, sameNetwork: false },
  { name: "S5 one-core-change (gamut)", b: (i) => ({ ...firefoxWithMedia(i), colorGamut: GAMUT[(i + 1) % GAMUT.length] }), concurrent: false, sameNetwork: false },
  { name: "S6 race one-core-change (gamut)", b: (i) => ({ ...firefoxWithMedia(i), colorGamut: GAMUT[(i + 1) % GAMUT.length] }), concurrent: true, sameNetwork: false },
  { name: "S7 two-core-change (gamut+audio)", b: (i) => ({ ...firefoxWithMedia(i), colorGamut: GAMUT[(i + 1) % GAMUT.length], audioSampleRate: 48000 }), concurrent: false, sameNetwork: false },
  { name: "S8 race two-core-change (gamut+audio)", b: (i) => ({ ...firefoxWithMedia(i), colorGamut: GAMUT[(i + 1) % GAMUT.length], audioSampleRate: 48000 }), concurrent: true, sameNetwork: false },
  { name: "S9 identical evidence", b: (i) => machineFor(i, "chrome"), concurrent: false, sameNetwork: false },
  { name: "S10 race identical evidence", b: (i) => machineFor(i, "chrome"), concurrent: true, sameNetwork: false },
  { name: "S11 presentation spoof", b: (i) => ({ ...machineFor(i, "chrome"), platform: "MacIntel", userAgent: MAC_CHROME_UA, platformVersion: "14.5", timezone: "Asia/Tokyo", timezoneOffsetMinutes: -540, language: "ja-JP", languages: "ja-JP,ja", locale: "ja-JP" }), concurrent: false, sameNetwork: false },
  { name: "S12 race presentation spoof", b: (i) => ({ ...machineFor(i, "chrome"), platform: "MacIntel", userAgent: MAC_CHROME_UA, platformVersion: "14.5", timezone: "Asia/Tokyo", timezoneOffsetMinutes: -540, language: "ja-JP", languages: "ja-JP,ja", locale: "ja-JP" }), concurrent: true, sameNetwork: false },
  { name: "S13 firefox-engine on one network", b: (i) => machineFor(i, "firefox"), concurrent: false, sameNetwork: true },
  { name: "S14 race firefox-engine on one network", b: (i) => machineFor(i, "firefox"), concurrent: true, sameNetwork: true },
  { name: "S15 two-core-change on one network", b: (i) => ({ ...firefoxWithMedia(i), colorGamut: GAMUT[(i + 1) % GAMUT.length], audioSampleRate: 48000 }), concurrent: false, sameNetwork: true },
];

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
    return `10.201.${Math.floor(index / 254) % 254}.${(index % 254) + 1}`;
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

  const register = async (label: string): Promise<{ token: string; csrf: string; userId: string }> => {
    const slug = label.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 24);
    const response = await call("POST", "/api/v1/auth/register", {
      body: { email: `probe.${RUN}.${slug}.${Math.random().toString(36).slice(2)}@example.test`, password: PASSWORD, displayName: `Probe ${slug}`.slice(0, 32) },
    });
    if (response.status !== 201) throw new Error(`register failed: ${response.status} ${JSON.stringify(response.body)}`);
    const token = String(response.body.accessToken);
    const joined = await call("POST", "/api/v1/mining/pools/join", { token, body: { poolId: "low" } });
    if (joined.status !== 200) throw new Error(`join failed: ${joined.status} ${JSON.stringify(joined.body)}`);
    return { token, csrf: String(response.body.csrfToken), userId: String(response.body.user?.id ?? "") };
  };

  const start = async (token: string, evidence: Record<string, unknown>, ip: string): Promise<{ status: number; body: unknown }> =>
    call("POST", "/api/v1/mining/start", { token, body: { device: evidence }, ip });

  interface Result {
    name: string;
    statuses: number[];
    codes: string[];
    devices: number;
    machineKeys: number;
    activeSessions: number;
    breach: boolean;
    note: string;
  }
  const results: Result[] = [];

  for (const [scenarioIndex, scenario] of SCENARIOS.entries()) {
    const accountA = await register(`${scenario.name.replace(/[^a-z0-9]+/gi, "-")}-a`);
    const accountB = await register(`${scenario.name.replace(/[^a-z0-9]+/gi, "-")}-b`);
    // Distinct peer addresses isolate the device rule; the sameNetwork variants share one address so
    // the network rule is the one that can answer.
    const ipA = scenario.sameNetwork ? `10.202.${scenarioIndex}.1` : nextIp();
    const ipB = scenario.sameNetwork ? ipA : nextIp();
    const evidenceA = { ...machineFor(scenarioIndex, "chrome"), visitorId: `visitor-a-${RUN}-${scenarioIndex}`, browserKeyPublicKey: `key-a-${RUN}-${scenarioIndex}` };
    const evidenceB = { ...scenario.b(scenarioIndex), visitorId: `visitor-b-${RUN}-${scenarioIndex}`, browserKeyPublicKey: `key-b-${RUN}-${scenarioIndex}` };
    let first: { status: number; body: unknown };
    let second: { status: number; body: unknown };
    if (scenario.concurrent) {
      [first, second] = await Promise.all([start(accountA.token, evidenceA, ipA), start(accountB.token, evidenceB, ipB)]);
    } else {
      first = await start(accountA.token, evidenceA, ipA);
      second = await start(accountB.token, evidenceB, ipB);
    }
    const active = await collections.miningSessions.countDocuments({
      ownerUserId: { $in: [accountA.userId, accountB.userId] },
      status: "active",
    });
    const statuses = [first.status, second.status];
    const codes = [first, second].map((r) => ((r.body as { error?: { code?: string } }).error?.code ?? "-"));
    const devices = await collections.miningDevices
      .find({ enrollmentUserId: { $in: [accountA.userId, accountB.userId] } }, { projection: { machineKeyHash: 1 } })
      .toArray();
    const machineKeys = new Set(devices.map((device) => device.machineKeyHash).filter((value): value is string => typeof value === "string")).size;
    results.push({
      name: scenario.name,
      statuses,
      codes,
      devices: devices.length,
      machineKeys,
      activeSessions: active,
      breach: active > 1,
      note: `${scenario.concurrent ? "both in flight" : "B after A"}${scenario.sameNetwork ? ", one network" : ", distinct networks"}`,
    });
    console.log(`${scenario.name}: statuses=${statuses.join(",")} codes=${codes.join(",")} devices=${devices.length} machineKeys=${machineKeys} activeSessions=${active}${active > 1 ? "  <-- BREACH" : ""}`);
    // Stop whatever is running so the next scenario starts from a clean machine population; stopping
    // is also what a user does, so the probe stays inside the product's lifecycle.
    for (const account of [accountA, accountB]) {
      await call("POST", "/api/v1/mining/stop", { token: account.token });
    }
  }

  const breaches = results.filter((result) => result.breach);
  const report = { generatedAt: new Date().toISOString(), run: RUN, database: process.env["MONGODB_DATABASE"] ?? null, results, breaches: breaches.map((b) => b.name) };
  console.log(JSON.stringify(report, null, 2));
  if (OUT) writeFileSync(OUT, JSON.stringify(report, null, 2));
  await app.close();
  await client.close();
  process.exit(breaches.length > 0 ? 3 : 0);
}

main().catch((error) => {
  console.error("PROBE FAILURE:", error);
  process.exit(1);
});
