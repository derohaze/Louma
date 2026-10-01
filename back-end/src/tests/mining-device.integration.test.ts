import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { MongoClient } from "mongodb";
import { buildApp } from "../app.js";
import { loadConfig, type AppConfig } from "../config/env.js";
import { connectMongo } from "../infrastructure/mongodb/client.js";
import { ensureDatabaseIndexes } from "../infrastructure/mongodb/indexes.js";
import { getCollections, type Collections } from "../infrastructure/mongodb/collections.js";
import { ipHash } from "../modules/mining-device/identity.js";
import { ENROLLMENT_DAY_MS } from "../modules/mining-device/policy.js";

/**
 * Louma Mining Device Guard — concurrency and anti-abuse suite.
 *
 * Business rule under test: one mining-capable device identity owns at most one active mining
 * cycle platform-wide. Account access is never restricted — only mining starts.
 *
 * Run with `npm run test:integration:lmdg`. All documents created are removed afterwards and the
 * treasury is restored, mirroring mining.integration.test.ts.
 */

const PASSWORD = "SmokeTest1234";

/**
 * Namespace and start time for one run of this file.
 *
 * A lease lasts the whole 24-hour cycle, so without a per-run namespace a second run's devices would
 * resolve to the first run's (same salted evidence) and inherit its live lease — the suite would
 * fail on its own leftovers rather than on the rule under test. See `after` for the matching
 * cleanup, which is scoped to the rows this run created.
 */
const RUN = randomUUID().slice(0, 8);
const runStartedAt = new Date();

let app: FastifyInstance;
let client: MongoClient;
let config: AppConfig;
let collections: Collections;

const createdUserIds: string[] = [];
const createdSessionIds: string[] = [];
const createdTransactionIds: string[] = [];
const createdWalletAccountIds: string[] = [];
// Lease keys (device key hashes) this run took out, so they can be released afterwards.
const createdLeaseKeys: string[] = [];
let treasuryDeltaMinor = 0;

let preauthCsrfTokenValue = "";
const csrfByAccessToken = new Map<string, string>();

// Rotating IPs like mining.integration.test.ts: per-IP rate limits (register 5/min, global
// 120/min) would otherwise throttle the suite itself rather than the behavior under test.
let requestIp = 0;
// A fresh address per request. The third octet advances so the suite never reuses one: the guard
// now scopes *new-identity* admission to a network, so a recycled address would carry an earlier
// test's live lease into a later test and make it fail on the fixture rather than on the rule.
const nextIp = () => {
  const index = requestIp++;
  return `10.9.${Math.floor(index / 254) % 254}.${(index % 254) + 1}`;
};

interface Account {
  userId: string;
  email: string;
  accessToken: string;
  walletId: string;
  ledgerAccountId: string;
}

async function call(
  method: "GET" | "POST",
  url: string,
  options: { token?: string; cookie?: string; body?: unknown; ip?: string } = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const headers: Record<string, string> = {};
  if (options.token) headers["authorization"] = `Bearer ${options.token}`;
  if (options.cookie) headers["cookie"] = options.cookie;
  if (method !== "GET") {
    headers["x-csrf-token"] = (options.token ? csrfByAccessToken.get(options.token) : undefined) ?? preauthCsrfTokenValue;
  }
  const response = await app.inject({
    method,
    url,
    headers,
    remoteAddress: options.ip ?? nextIp(),
    ...(options.body === undefined ? {} : { payload: options.body as Record<string, unknown> }),
  });
  const body = response.payload.length ? (response.json() as Record<string, unknown>) : {};
  if (typeof body["accessToken"] === "string" && typeof body["csrfToken"] === "string") {
    csrfByAccessToken.set(body["accessToken"], body["csrfToken"]);
  }
  return { status: response.statusCode, body };
}

async function register(label: string): Promise<Account> {
  const email = `lmdg.${label}.${randomUUID()}@example.test`;
  const response = await call("POST", "/api/v1/auth/register", {
    body: { email, password: PASSWORD, displayName: `Lmdg ${label}`.slice(0, 32) },
  });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  const user = response.body["user"] as { id: string };
  const wallet = response.body["wallet"] as { id: string };
  createdUserIds.push(user.id);
  const account = await collections.ledgerAccounts.findOne({ walletId: wallet.id, accountType: "wallet" });
  assert.ok(account);
  createdWalletAccountIds.push(account.publicId);
  // Mining requires pool membership: every fixture account joins the Low pool on creation.
  const joined = await call("POST", "/api/v1/mining/pools/join", {
    token: response.body["accessToken"] as string,
    body: { poolId: "low" },
  });
  assert.equal(joined.status, 200, JSON.stringify(joined.body));
  return { userId: user.id, email, accessToken: response.body["accessToken"] as string, walletId: wallet.id, ledgerAccountId: account.publicId };
}

const WINDOWS_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const WINDOWS_FIREFOX_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0";
const MAC_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";
const MAC_FIREFOX_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:127.0) Gecko/20100101 Firefox/127.0";
const LINUX_UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const LINUX_FIREFOX_UA =
  "Mozilla/5.0 (X11; Linux x86_64; rv:127.0) Gecko/20100101 Firefox/127.0";

interface MachineShape {
  platform: string;
  userAgent: string;
  firefoxUserAgent: string;
  platformVersion: string;
  screenWidth: number;
  screenHeight: number;
  pixelRatio: number;
  timezone: string;
  timezoneOffsetMinutes: number;
  hardwareConcurrency: number;
  deviceMemory: number;
  maxTouchPoints: number;
  mediaAudioInputs: number;
  mediaVideoInputs: number;
  colorGamut: string;
  /**
   * The rest of the evidence — screen details, GPU identity and limits, audio
   * device. A real client always reports these, and the server builds the machine identity from the
   * machine traits among them, so the fixtures must carry them too: without them the simulated
   * machines would be far poorer than the real ones and the suite would test a weaker model than
   * production runs. Only `machineShape` fills them in, derived from the machine index.
   */
  screenAvailWidth?: number;
  screenAvailHeight?: number;
  screenColorDepth?: number;
  webglVendor?: string;
  webglRenderer?: string;
  webglLimitsHash?: string;
  webglExtensionsHash?: string;
  webgpuHash?: string;
  audioSampleRate?: number;
  audioChannels?: number;
  hdr?: boolean;
}

/**
 * Mutually distinct machines, one per test namespace.
 *
 * Two observations that agree on every generic trait and disagree only on the GPU correlate as
 * "ambiguous" — the correct answer for a real pair of near-identical laptops, and a wrong one for
 * two unrelated fixtures. So each namespace gets a machine that differs from the others in the OS,
 * screen, CPU class, memory, timezone and capture devices, not only in the rendering digests.
 *
 * Every fixture differs in the ENGINE-STABLE CORE the machine key hashes (core count, touch class,
 * audio device, gamut, HDR, panel depth) — and none of them collides on all six — while
 * `machineIndexBySalt` assignment keeps two namespaces apart even when one runs alone.
 */
const MACHINES: Omit<MachineShape, "platform" | "userAgent" | "firefoxUserAgent" | "platformVersion">[] = [
  { screenWidth: 1366, screenHeight: 768, pixelRatio: 1, timezone: "Africa/Cairo", timezoneOffsetMinutes: -180, hardwareConcurrency: 2, deviceMemory: 4, maxTouchPoints: 0, mediaAudioInputs: 0, mediaVideoInputs: 0, colorGamut: "srgb" },
  { screenWidth: 1920, screenHeight: 1080, pixelRatio: 1, timezone: "Europe/London", timezoneOffsetMinutes: 0, hardwareConcurrency: 4, deviceMemory: 8, maxTouchPoints: 0, mediaAudioInputs: 1, mediaVideoInputs: 1, colorGamut: "srgb" },
  { screenWidth: 1440, screenHeight: 900, pixelRatio: 2, timezone: "America/New_York", timezoneOffsetMinutes: 300, hardwareConcurrency: 8, deviceMemory: 16, maxTouchPoints: 0, mediaAudioInputs: 2, mediaVideoInputs: 1, colorGamut: "p3" },
  { screenWidth: 1600, screenHeight: 900, pixelRatio: 1, timezone: "Asia/Dubai", timezoneOffsetMinutes: -240, hardwareConcurrency: 6, deviceMemory: 8, maxTouchPoints: 5, mediaAudioInputs: 1, mediaVideoInputs: 0, colorGamut: "srgb" },
  { screenWidth: 2560, screenHeight: 1440, pixelRatio: 1, timezone: "Europe/Berlin", timezoneOffsetMinutes: -120, hardwareConcurrency: 12, deviceMemory: 16, maxTouchPoints: 0, mediaAudioInputs: 3, mediaVideoInputs: 2, colorGamut: "rec2020" },
  { screenWidth: 2880, screenHeight: 1800, pixelRatio: 2, timezone: "Asia/Riyadh", timezoneOffsetMinutes: -180, hardwareConcurrency: 10, deviceMemory: 32, maxTouchPoints: 10, mediaAudioInputs: 2, mediaVideoInputs: 1, colorGamut: "p3" },
  { screenWidth: 3440, screenHeight: 1440, pixelRatio: 1, timezone: "Africa/Cairo", timezoneOffsetMinutes: 0, hardwareConcurrency: 16, deviceMemory: 32, maxTouchPoints: 0, mediaAudioInputs: 4, mediaVideoInputs: 2, colorGamut: "srgb" },
  { screenWidth: 3000, screenHeight: 2000, pixelRatio: 1.25, timezone: "Europe/London", timezoneOffsetMinutes: 300, hardwareConcurrency: 8, deviceMemory: 16, maxTouchPoints: 0, mediaAudioInputs: 0, mediaVideoInputs: 1, colorGamut: "p3" },
  { screenWidth: 1728, screenHeight: 1117, pixelRatio: 2, timezone: "America/New_York", timezoneOffsetMinutes: -120, hardwareConcurrency: 4, deviceMemory: 8, maxTouchPoints: 10, mediaAudioInputs: 1, mediaVideoInputs: 1, colorGamut: "p3" },
  { screenWidth: 3840, screenHeight: 2160, pixelRatio: 1.5, timezone: "Asia/Riyadh", timezoneOffsetMinutes: 0, hardwareConcurrency: 24, deviceMemory: 32, maxTouchPoints: 0, mediaAudioInputs: 2, mediaVideoInputs: 2, colorGamut: "rec2020" },
  { screenWidth: 1536, screenHeight: 864, pixelRatio: 1.25, timezone: "Europe/Berlin", timezoneOffsetMinutes: 300, hardwareConcurrency: 2, deviceMemory: 2, maxTouchPoints: 0, mediaAudioInputs: 0, mediaVideoInputs: 1, colorGamut: "srgb" },
  { screenWidth: 2048, screenHeight: 1536, pixelRatio: 2, timezone: "Asia/Dubai", timezoneOffsetMinutes: -120, hardwareConcurrency: 16, deviceMemory: 8, maxTouchPoints: 5, mediaAudioInputs: 3, mediaVideoInputs: 1, colorGamut: "rec2020" },
];

const SYSTEMS = [
  { platform: "Win32", userAgent: WINDOWS_UA, firefoxUserAgent: WINDOWS_FIREFOX_UA, version: (index: number) => `10.0.${19000 + index}` },
  { platform: "MacIntel", userAgent: MAC_UA, firefoxUserAgent: MAC_FIREFOX_UA, version: (index: number) => `14.${index}` },
  { platform: "Linux x86_64", userAgent: LINUX_UA, firefoxUserAgent: LINUX_FIREFOX_UA, version: (index: number) => `6.${index}` },
];

/**
 * One namespace (the per-test salt) is one machine, for the whole run.
 *
 * Assignment is by first use, so two namespaces can never share a machine however many tests the
 * file grows to — and a new test only has to pass a new salt. RUN still namespaces the visitor id,
 * keys and rendering digests, which keeps this run's machines apart from any earlier run's; see
 * `removeFixtureDevices` for the matching cleanup.
 */
const machineIndexBySalt = new Map<string, number>();

function machineShape(salt: string): MachineShape {
  let index = machineIndexBySalt.get(salt);
  if (index === undefined) {
    index = machineIndexBySalt.size;
    machineIndexBySalt.set(salt, index);
  }
  const system = SYSTEMS[index % SYSTEMS.length]!;
  const shape = MACHINES[index % MACHINES.length]!;
  // The machine key hashes the ENGINE-STABLE core (core count, touch class, audio device, gamut,
  // HDR, panel depth), so each fixture must differ from every other fixture in at least one core
  // slot — not only in the rendering digests. The audio device is varied deterministically per index
  // — and the capture-device pair and memory class with it, which the machine-trait comparison
  // scores — so no two fixtures land in the guard's ambiguous band however many tests run before
  // them, in any order.
  const audioInputs = (shape.mediaAudioInputs + index) % 5;
  const videoInputs = (shape.mediaVideoInputs + index) % 3;
  // The identity the guard compares is deliberately coarse — bucketed CPU class, panel colour
  // depth, HDR capability, negotiated audio device, display gamut, touch class — so a fixture built
  // from the *most common* desktop profile (24-bit sRGB panel, no HDR, a 48 kHz stereo output, no
  // touch points) is indistinguishable from a real customer's machine. The suite runs against a
  // shared development database that does hold real machines with live leases, and such a fixture
  // would inherit one (verified: it did). Every fixture therefore reports a panel and an audio
  // device no plain desktop reports — an HDR panel at a non-24-bit depth, and never 48 kHz — and the
  // index varies both, so no two fixtures collide with each other either.
  // Unique per index, deliberately: the audio device is one of the six engine-stable core slots
  // the machine key hashes, and the rest of the shape repeats every 12 entries (MACHINES length)
  // while the panel depth repeats every 2 — so a three-value rate cycled by index was not enough to
  // keep two namespaces apart. Indices 0 and 12 produced an identical machine core, and the later
  // test then resolved to the earlier test's cluster (and its live lease) instead of enrolling its
  // own machine. A unique rate makes every namespace a distinct machine by construction. The values
  // stay realistic: a plain audio device other than 48 kHz, which is what keeps a fixture from
  // colliding with a real customer's machine in a shared database.
  const sampleRate = 22050 + index * 750;
  return {
    ...shape,
    platform: system.platform,
    userAgent: system.userAgent,
    firefoxUserAgent: system.firefoxUserAgent,
    platformVersion: system.version(index),
    // One GPU identity per simulated machine, and one per run: the machine key is built from these,
    // so they must be as distinct as the screens and CPU classes are, and must not survive a run.
    audioSampleRate: sampleRate,
    mediaAudioInputs: audioInputs,
    mediaVideoInputs: videoInputs,
    screenAvailWidth: shape.screenWidth,
    screenAvailHeight: shape.screenHeight - 40,
    screenColorDepth: [30, 32][index % 2]!,
    webglVendor: `vendor-${index}-${RUN}`,
    webglRenderer: `renderer-${index}-${RUN}`,
    webglLimitsHash: `limits-${index}-${RUN}`,
    webglExtensionsHash: `extensions-${index}-${RUN}`,
    webgpuHash: `webgpu-${index}-${RUN}`,
    audioChannels: 2,
    hdr: true,
  };
}

function deviceEvidence(kind: "laptop-x" | "laptop-y" | "laptop-x-firefox" | "laptop-x-cleared" | "laptop-x-vpn" | "laptop-x-second-browser" | "laptop-x-firefox-engine", salt = ""): Record<string, unknown> {
  // The salt namespaces visitorId, browser keys, rendering hashes and the machine shape per test,
  // and RUN namespaces them per suite run: the device collection persists across tests and across
  // runs, and without this every test's "laptop-x" would correlate to another test's cluster and
  // inherit its lease. Within one test the salt is constant, so correlation between two browsers on
  // that one machine (shared machine traits: CPU and memory class, font set, codec set, display)
  // still holds.
  const base = {
    ...machineShape(salt),
    fingerprintConfidence: 0.95,
    fingerprintVersion: "v5",
    language: "en-US",
    webglHash: "webgl-laptop-x",
    canvasHash: "canvas-laptop-x",
    audioHash: "audio-laptop-x",
    fontsHash: "fonts-laptop-x",
    codecsHash: "codecs-laptop-x",
    mimeTypesHash: "mime-types-laptop-x",
    integrity: { webdriver: false, headlessHint: false, impossibleUaPlatform: false, missingCapabilities: false },
  };
  const tag = (name: string) => (salt ? `${name}-${salt}-${RUN}` : `${name}-${RUN}`);
  const withSalt = (evidence: Record<string, unknown>): Record<string, unknown> => ({
    ...evidence,
    visitorId: evidence["visitorId"] === null ? null : tag(String(evidence["visitorId"])),
    browserKeyPublicKey: evidence["browserKeyPublicKey"] === null ? null : tag(String(evidence["browserKeyPublicKey"])),
    webglHash: tag(String(evidence["webglHash"])),
    canvasHash: tag(String(evidence["canvasHash"])),
    audioHash: tag(String(evidence["audioHash"])),
    fontsHash: tag(String(evidence["fontsHash"])),
    codecsHash: tag(String(evidence["codecsHash"])),
    mimeTypesHash: tag(String(evidence["mimeTypesHash"])),
  });
  switch (kind) {
    case "laptop-x":
      return withSalt({ ...base, visitorId: "visitor-laptop-x-chrome", browserKeyPublicKey: "browser-key-laptop-x-chrome" });
    case "laptop-y":
      return withSalt({
        ...base, visitorId: "visitor-laptop-y", userAgent: `${MAC_UA} Chrome/126.0`,
        platform: "MacIntel", screenWidth: 4096, screenHeight: 2304, hardwareConcurrency: 24,
        pixelRatio: 3, platformVersion: "14.5", deviceMemory: 32, mediaAudioInputs: 4,
        timezone: "Asia/Tokyo", timezoneOffsetMinutes: -540, colorGamut: "rec2020",
        webglHash: "webgl-laptop-y", canvasHash: "canvas-laptop-y", audioHash: "audio-laptop-y",
        fontsHash: "fonts-laptop-y", browserKeyPublicKey: "browser-key-laptop-y",
      });
    case "laptop-x-firefox":
      // Same machine, different browser: new visitorId + key, same machine traits.
      return withSalt({ ...base, visitorId: "visitor-laptop-x-firefox", userAgent: base.firefoxUserAgent, browserKeyPublicKey: "browser-key-laptop-x-firefox" });
    case "laptop-x-second-browser":
      // The reported bypass: one computer, two browsers. Everything the *browser* owns differs —
      // a privacy browser reports its GPU as `brave`, randomizes the rendering digests, and the
      // second window sits on a second monitor — while everything the *computer* owns is the same:
      // CPU class, memory class, display scale, capture devices, audio device, display gamut and
      // colour depth, installed fonts, codec set.
      return withSalt({
        ...base,
        visitorId: "visitor-laptop-x-second-browser",
        browserKeyPublicKey: "browser-key-laptop-x-second-browser",
        userAgent: `${base.userAgent} Brave/126.0`,
        screenWidth: 1680,
        screenHeight: 1050,
        screenAvailWidth: 1680,
        screenAvailHeight: 1050,
        webglVendor: "brave",
        webglRenderer: "brave",
        webglLimitsHash: `limits-brave-${RUN}`,
        webglExtensionsHash: `extensions-brave-${RUN}`,
        webgpuHash: `webgpu-brave-${RUN}`,
        webglHash: "webgl-laptop-x-brave",
        canvasHash: "canvas-laptop-x-brave",
        audioHash: "audio-laptop-x-brave",
        speechVoicesHash: `voices-brave-${RUN}`,
        locale: "en-GB",
        languages: "en-GB,en",
        storageQuotaBytes: 2 ** 31,
        pluginsHash: `plugins-brave-${RUN}`,
        keyboardLayoutHash: `keyboard-brave-${RUN}`,
      });
    case "laptop-x-firefox-engine":
      // The reported REAL bypass: one computer, a genuinely different ENGINE. Firefox disagrees
      // with Chrome about everything the engine owns — it cannot report navigator.deviceMemory at
      // all, its font probe measures through a different text stack, its bundled media stack
      // decodes a different codec set, its GPU strings differ — while the engine-stable core (CPU
      // class, touch class, audio device, gamut, HDR, panel depth) is the same machine. Four
      // engines on one computer used to yield four mining cycles.
      //
      // Capture devices included: a real Firefox answers `enumerateDevices()` for none of them on a
      // first start, because the call is what starts its media stack and the collector's budget runs
      // out before it does. The fixture reports none for the same reason — that absence is what
      // forked the machine key in production and let a second account mine the same computer.
      return withSalt({
        ...base,
        visitorId: "visitor-laptop-x-ff-engine",
        browserKeyPublicKey: "browser-key-laptop-x-ff-engine",
        userAgent: base.firefoxUserAgent,
        deviceMemory: undefined,
        mediaAudioInputs: null,
        mediaVideoInputs: null,
        fontsHash: `fonts-firefox-${RUN}`,
        codecsHash: `codecs-firefox-${RUN}`,
        mimeTypesHash: `mime-firefox-${RUN}`,
        webglVendor: `vendor-ff-${RUN}`,
        webglRenderer: `renderer-ff-${RUN}`,
        webglLimitsHash: `limits-ff-${RUN}`,
        webglExtensionsHash: `ext-ff-${RUN}`,
        webgpuHash: null,
        webglHash: `webgl-firefox-${RUN}`,
        canvasHash: `canvas-firefox-${RUN}`,
        audioHash: `audio-firefox-${RUN}`,
        speechVoicesHash: `voices-firefox-${RUN}`,
        storageQuotaBytes: 2 ** 30,
        pluginsHash: `plugins-firefox-${RUN}`,
      });
    case "laptop-x-cleared":
      // Storage cleared: no key, no visitorId — the machine traits remain.
      return withSalt({ ...base, visitorId: null, browserKeyPublicKey: null });
    case "laptop-x-vpn":
      return withSalt({ ...base, visitorId: "visitor-laptop-x-vpn", browserKeyPublicKey: null });
  }
}

async function startWith(account: Account, kind: Parameters<typeof deviceEvidence>[0], ip?: string, salt?: string) {
  const response = await call("POST", "/api/v1/mining/start", {
    token: account.accessToken,
    body: { device: deviceEvidence(kind, salt) },
    ...(ip === undefined ? {} : { ip }),
  });
  if (response.status === 200) {
    const session = (response.body["session"] ?? null) as { id: string } | null;
    if (session && !createdSessionIds.includes(session.id)) createdSessionIds.push(session.id);
    const leases = await collections.miningDeviceLeases.find({ ownerUserId: account.userId }).toArray();
    for (const lease of leases) {
      if (!createdLeaseKeys.includes(lease.deviceClusterId)) createdLeaseKeys.push(lease.deviceClusterId);
    }
  }
  return response;
}

async function trackSettlements(): Promise<void> {
  for (const sessionId of createdSessionIds) {
    const settlements = await collections.miningSettlements.find({ sessionPublicId: sessionId }).toArray();
    for (const settlement of settlements) {
      if (!createdTransactionIds.includes(settlement.publicId)) {
        createdTransactionIds.push(settlement.publicId);
        treasuryDeltaMinor += settlement.amountMinor;
      }
    }
  }
}

/**
 * Fixture devices this suite (and mining.integration.test.ts) created in earlier runs.
 *
 * Every fixture's rendering digests are named after the simulated machine (`webgl-laptop-*`,
 * `webgl-machine-*`), and no real client can produce such a hash — a real one is a SHA-256 of the
 * GPU string — so this predicate can only ever match test rows. It exists because a lease lasts a
 * full 24 hours: leftovers from an interrupted run would keep correlating with the next run's
 * fixtures (as "ambiguous", which enforce mode denies) and the suite would fail on its own past.
 */
const FIXTURE_DEVICE_FILTER = { webglFingerprintHash: { $regex: /^webgl-(laptop|machine)/ } };

async function removeFixtureDevices(): Promise<void> {
  const devices = await collections.miningDevices
    // Only leftovers from earlier runs: rows created after this run started may belong to a suite
    // running concurrently against the same database and must never be touched here.
    .find({ ...FIXTURE_DEVICE_FILTER, firstSeenAt: { $lt: runStartedAt } }, { projection: { publicId: 1, deviceKeyHash: 1, machineKeyHash: 1 } })
    .toArray();
  if (devices.length === 0) return;
  // A lease is keyed by a device identity: the machine key, the browser key, or (from earlier
  // builds) the record id — every one of them has to be cleaned up with the record.
  const leaseKeys = [
    ...new Set(
      devices.flatMap((device) => [device.publicId, device.deviceKeyHash, device.machineKeyHash]),
    ),
  ].filter((key): key is string => key !== null);
  await collections.miningDeviceLeases.deleteMany({ deviceClusterId: { $in: leaseKeys } });
  await collections.miningDevices.deleteMany({ publicId: { $in: devices.map((device) => device.publicId) } });
}

before(async () => {
  config = loadConfig();
  const connection = await connectMongo(config, { serverSelectionTimeoutMS: 30_000, connectTimeoutMS: 20_000 });
  client = connection.client;
  collections = getCollections(connection.db);
  await ensureDatabaseIndexes(connection.db);
  await removeFixtureDevices();
  app = await buildApp({ config, collections, mongoClient: client, logger: false });
  const csrf = await call("GET", "/api/v1/auth/csrf");
  assert.equal(csrf.status, 200);
  preauthCsrfTokenValue = csrf.body["csrfToken"] as string;
});

after(async () => {
  if (!collections) return;
  await trackSettlements();
  // Captured before the per-account cleanup below deletes this run's observations: querying after
  // the delete always yields an empty set, leaving denied fixture devices (no lease, no RUN
  // namespaced WebGL hash — including the Firefox-engine fixture) behind in the shared database.
  const observedDeviceIds = (
    (await collections.miningDeviceObservations.distinct("deviceId", { ownerUserId: { $in: createdUserIds } }).catch(() => [] as unknown[])) as unknown[]
  ).filter((value): value is string => typeof value === "string");
  for (const userId of createdUserIds) {
    await collections.miningSessions.deleteMany({ ownerUserId: userId });
    await collections.miningSettlements.deleteMany({ ownerUserId: userId });
    await collections.miningPoolMembers.deleteMany({ ownerUserId: userId });
    await collections.miningDeviceLeases.deleteMany({ ownerUserId: userId });
    await collections.miningDeviceObservations.deleteMany({ ownerUserId: userId });
    await collections.miningDeviceNonces.deleteMany({ ownerUserId: userId });
    await collections.securityEvents.deleteMany({ ownerUserId: userId });
    await collections.sessions.deleteMany({ ownerUserId: userId });
    await collections.wallets.deleteMany({ ownerUserId: userId });
    await collections.users.deleteMany({ publicId: userId });
  }
  await collections.ledgerEntries.deleteMany({ transactionId: { $in: createdTransactionIds } });
  await collections.transactions.deleteMany({ publicId: { $in: createdTransactionIds } });
  await collections.ledgerEntries.deleteMany({ ledgerAccountId: { $in: createdWalletAccountIds } });
  await collections.ledgerAccounts.deleteMany({ publicId: { $in: createdWalletAccountIds } });
  await collections.miningDeviceLeases.deleteMany({ deviceClusterId: { $in: createdLeaseKeys } });
  // Rejected starts also register a device record (that is how correlation learns a machine), and
  // a record with no lease is invisible to the id set above. Device records deliberately carry no
  // owner, so the rows this run created are identified by what links to this run only: observations
  // and leases of the accounts this file registered, plus this run's fixture namespace (`RUN`) for
  // records a denial left without either. A denied start still records an observation, so the
  // observed set alone is not proof this run created the device — the creation-time bound is what
  // excludes a pre-existing device a fixture merely resolved to. A bare creation-time window is
  // never used alone — it would also match devices another suite or user created mid-run against
  // the same database.
  // (`observedDeviceIds` was captured before the per-account observation cleanup above.)
  const runDevices = await collections.miningDevices
    .find(
      {
        $or: [
          { publicId: { $in: observedDeviceIds }, firstSeenAt: { $gte: runStartedAt } },
          { deviceKeyHash: { $in: createdLeaseKeys } },
          { machineKeyHash: { $in: createdLeaseKeys } },
          {
            webglFingerprintHash: { $regex: new RegExp(`^webgl-(laptop|machine).*${RUN}`) },
            firstSeenAt: { $gte: runStartedAt },
          },
        ],
      },
      { projection: { publicId: 1, deviceKeyHash: 1, machineKeyHash: 1 } },
    )
    .toArray();
  const runDeviceIds = runDevices.map((device) => device.publicId);
  if (runDeviceIds.length > 0) {
    const runLeaseKeys = [
      ...new Set(
        runDevices.flatMap((device) => [device.publicId, device.deviceKeyHash, device.machineKeyHash]),
      ),
    ].filter((key): key is string => key !== null);
    await collections.miningDeviceLeases.deleteMany({
      $or: [{ deviceClusterId: { $in: runLeaseKeys } }, { deviceId: { $in: runDeviceIds } }],
    });
    await collections.miningDevices.deleteMany({ publicId: { $in: runDeviceIds } });
  }
  if (treasuryDeltaMinor !== 0) {
    await collections.ledgerAccounts.updateOne({ accountType: "system_treasury", currency: "LMA" }, { $inc: { balanceMinor: -treasuryDeltaMinor } });
  }
  await app?.close();
  await client?.close();
});

test("A: two accounts racing on the same device — exactly one mines", async () => {
  const accountA = await register("race-a");
  const accountB = await register("race-b");
  const [first, second] = await Promise.all([startWith(accountA, "laptop-x", undefined, "race"), startWith(accountB, "laptop-x", undefined, "race")]);
  const codes = [first, second].map((r) => r.status);
  assert.ok(codes.includes(200), `one start must succeed: ${JSON.stringify(codes)}`);
  assert.ok(codes.includes(409), `one start must be rejected: ${JSON.stringify(codes)}`);
  const rejected = first.status === 409 ? first : second;
  assert.equal((rejected.body["error"] as { code: string }).code, "mining_device_already_in_use");
  // No identity leakage in the rejection.
  assert.ok(!JSON.stringify(rejected.body).includes(accountA.userId));
  assert.ok(!JSON.stringify(rejected.body).includes(accountA.email));
});

test("B: same account, two concurrent starts — one cycle only", async () => {
  const account = await register("self-race");
  const [first, second] = await Promise.all([startWith(account, "laptop-x", undefined, "self"), startWith(account, "laptop-x", undefined, "self")]);
  assert.ok([first.status, second.status].every((s) => s === 200), "both converge on the one cycle");
  const cycles = await collections.miningSessions.countDocuments({ ownerUserId: account.userId, status: "active" });
  assert.equal(cycles, 1);
});

test("K: a different browser on the same machine is the same device cluster", async () => {
  const accountA = await register("browser-a");
  const accountB = await register("browser-b");
  const first = await startWith(accountA, "laptop-x", undefined, "xbro");
  assert.equal(first.status, 200, JSON.stringify(first.body));
  const second = await startWith(accountB, "laptop-x-firefox", undefined, "xbro");
  assert.equal(second.status, 409, `same-machine second browser must be rejected: ${JSON.stringify(second.body)}`);
  assert.equal((second.body["error"] as { code: string }).code, "mining_device_already_in_use");
});

test("N: a second browser on one computer cannot mine (the reported bypass)", async () => {
  // What was reported: two accounts, one computer, one browser each, both mining. The second browser
  // reports a different rendering stack, a garbled GPU identity and a window on a second monitor, so
  // the model that read the GPU strings and the window geometry as machine identity classified it as
  // a different machine. The identity is now built from what two browsers on one computer agree
  // about by construction.
  const accountA = await register("second-browser-a");
  const accountB = await register("second-browser-b");
  const salt = "secondbrowser";
  const first = await startWith(accountA, "laptop-x", undefined, salt);
  assert.equal(first.status, 200, JSON.stringify(first.body));
  const second = await startWith(accountB, "laptop-x-second-browser", undefined, salt);
  assert.equal(second.status, 409, `a second browser on one computer must be rejected: ${JSON.stringify(second.body)}`);
  assert.equal((second.body["error"] as { code: string }).code, "mining_device_already_in_use");

  // Both browsers resolved to one device record, and the denial is recorded on it: this is the
  // cross-account evidence the guard accumulates, and it stayed empty while one computer was two
  // device records.
  const observations = await collections.miningDeviceObservations
    .find({ ownerUserId: { $in: [accountA.userId, accountB.userId] } })
    .toArray();
  assert.equal(observations.length, 2, "both accounts are on the record");
  assert.equal(new Set(observations.map((observation) => observation.deviceId)).size, 1, "one device, two accounts");
  assert.deepEqual(
    [...new Set(observations.map((observation) => observation.ownerUserId))].sort(),
    [accountA.userId, accountB.userId].sort(),
  );
  // The rejected attempt is on the record as well: the accumulated history is what makes a repeat
  // attempt riskier than the first, and it stayed empty while one computer was two records.
  const denied = observations.find((observation) => observation.ownerUserId === accountB.userId);
  assert.equal(denied?.decision, "deny");
  assert.equal(denied?.riskScore, 70);
});

test("D+L: a second new machine behind an occupied network is refused, not silently allowed", async () => {
  const accountA = await register("home-a");
  const accountB = await register("home-b");
  const first = await startWith(accountA, "laptop-x", "203.0.113.44", "home-x");
  assert.equal(first.status, 200, JSON.stringify(first.body));
  // Same network, a brand-new identity: because a fresh browser key can be generated by anyone, a
  // proof of possession must not clear this rule — it is refused outright. A household's second
  // machine waits for the cycle to end; that is the honest cost of the rule (see ENROLL-C for the
  // exempt path an already-established cluster takes).
  const second = await startWith(accountB, "laptop-y", "203.0.113.44", "home-y");
  assert.equal(second.status, 409, `a first-sight identity behind an occupied network is refused: ${JSON.stringify(second.body)}`);
  assert.equal((second.body["error"] as { code: string }).code, "mining_device_network_in_use");
  // And the refusal really was a refusal: no cycle, no session, and no active lease for that
  // identity. A 4xx that still left a lease behind would be a bypass wearing a status code.
  const deniedDevice = await collections.miningDevices.findOne({ webglFingerprintHash: `webgl-laptop-y-home-y-${RUN}` });
  if (deniedDevice) {
    const leases = await collections.miningDeviceLeases.countDocuments({ deviceId: deniedDevice.publicId, status: "active" });
    assert.equal(leases, 0, "a refused start must not leave an active lease behind");
  }
  assert.equal(await collections.miningSessions.countDocuments({ ownerUserId: accountB.userId, status: "active" }), 0);
  // The same machine on a different network is untouched by the network rule.
  const otherNetwork = await startWith(accountB, "laptop-y", "198.51.100.9", "home-y");
  assert.equal(otherNetwork.status, 200, `a different network admits the same machine: ${JSON.stringify(otherNetwork.body)}`);
});

test("E: VPN-like network change does not free the device", async () => {
  const accountA = await register("vpn-a");
  const accountB = await register("vpn-b");
  // Distinct networks for this scenario: an address another test is already mining from would make
  // the *network* rule (not the VPN scenario) the reason this start is refused.
  const first = await startWith(accountA, "laptop-x", "203.0.113.71", "vpn");
  assert.equal(first.status, 200, JSON.stringify(first.body));
  const second = await startWith(accountB, "laptop-x-vpn", "198.51.100.77", "vpn");
  assert.equal(second.status, 409, `network change must not re-identify the machine: ${JSON.stringify(second.body)}`);
  assert.equal((second.body["error"] as { code: string }).code, "mining_device_already_in_use");
});

test("F: clearing browser storage does not free the device", async () => {
  const accountA = await register("cleared-a");
  const accountB = await register("cleared-b");
  const first = await startWith(accountA, "laptop-x", undefined, "cleared");
  assert.equal(first.status, 200, JSON.stringify(first.body));
  const second = await startWith(accountB, "laptop-x-cleared", undefined, "cleared");
  assert.equal(second.status, 409, `server-side binding must survive cleared storage: ${JSON.stringify(second.body)}`);
});

test("G+H: a browser-key proof cannot be replayed, nor can its nonce", async () => {
  const account = await register("replay");
  const challenge = await call("POST", "/api/v1/mining/device/challenge", { token: account.accessToken, body: {} });
  assert.equal(challenge.status, 200, JSON.stringify(challenge.body));
  const nonce = challenge.body["nonce"] as string;
  const payload = challenge.body["payload"] as string;
  assert.ok(nonce && payload, "the challenge carries the canonical bound payload to sign");

  const keyPair = await globalThis.crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const jwk = (await globalThis.crypto.subtle.exportKey("jwk", keyPair.publicKey)) as Record<string, unknown>;
  const raw = Buffer.from(
    await globalThis.crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, keyPair.privateKey, Buffer.from(payload, "utf8")),
  );
  const signature = raw.toString("base64url");

  const first = await call("POST", "/api/v1/mining/device/prove", {
    token: account.accessToken,
    body: { nonce, signature, publicKeyJwk: jwk },
  });
  assert.equal(first.status, 200, JSON.stringify(first.body));

  const replayProof = await call("POST", "/api/v1/mining/device/prove", {
    token: account.accessToken,
    body: { nonce, signature, publicKeyJwk: jwk },
  });
  assert.equal(replayProof.status, 401, `replayed proof must be rejected: ${JSON.stringify(replayProof.body)}`);

  const replayNonce = await call("POST", "/api/v1/mining/device/prove", {
    token: account.accessToken,
    body: { nonce, signature, publicKeyJwk: jwk },
  });
  assert.equal(replayNonce.status, 401);
});

test("I+J: tampered fingerprints and UA-only changes do not create a new device", async () => {
  const accountA = await register("tamper-a");
  const accountB = await register("tamper-b");
  const first = await startWith(accountA, "laptop-x", undefined, "tamper");
  assert.equal(first.status, 200, JSON.stringify(first.body));
  const tampered = await call("POST", "/api/v1/mining/start", {
    token: accountB.accessToken,
    body: {
      device: {
        ...deviceEvidence("laptop-x-firefox", "tamper"),
        visitorId: "attacker-forged-visitor",
        fingerprintConfidence: 1,
        webglHash: "webgl-laptop-x-tamper",
      },
    },
  });
  assert.equal(tampered.status, 409, `forged evidence must not bypass correlation: ${JSON.stringify(tampered.body)}`);
});

test("M: switching the user agent on one machine does not free it (the reported bypass)", async () => {
  // The attack that was reported: a browser extension rewrote the user agent, the weighted
  // correlation fell below the matching threshold, the observation was classified as a different
  // machine and a second account mined on the same computer. The machine identity is built from
  // machine traits only, so the switch moves the presentation — and nothing else.
  const accountA = await register("uaswitch-a");
  const accountB = await register("uaswitch-b");
  const salt = "uaswitch";
  assert.equal((await startWith(accountA, "laptop-x", undefined, salt)).status, 200);
  const switched = await call("POST", "/api/v1/mining/start", {
    token: accountB.accessToken,
    body: {
      device: {
        // Same machine, different browser, switched user agent: new visitor id and key, moved
        // platform/osFamily/browserFamily/platformVersion — identical hardware.
        ...deviceEvidence("laptop-x-firefox", salt),
        visitorId: `attacker-visitor-${RUN}`,
        browserKeyPublicKey: `attacker-key-${RUN}`,
        platform: "MacIntel",
        userAgent:
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0 Safari/537.36",
        platformVersion: "14.6.0",
        timezone: "Asia/Tokyo",
        timezoneOffsetMinutes: -540,
        webglHash: `webgl-attacker-${RUN}`,
        canvasHash: `canvas-attacker-${RUN}`,
        audioHash: `audio-attacker-${RUN}`,
        fontsHash: `fonts-attacker-${RUN}`,
      },
    },
  });
  assert.equal(
    switched.status,
    409,
    `a switched user agent must not free the machine: ${JSON.stringify(switched.body)}`,
  );
  assert.equal((switched.body["error"] as { code: string }).code, "mining_device_already_in_use");
});

test("REAL-WORLD REPORT: four engines on one computer yield exactly one mining cycle", async () => {
  // The verified real-world bypass: the same physical machine running Chrome, Edge, Firefox and
  // Brave held one mining cycle per browser. This test reproduces the engine disagreement itself
  // (Firefox literally cannot report navigator.deviceMemory; fonts/codecs/GPU/canvas/audio all
  // measure differently per engine) and asserts the guard still converges every engine on ONE
  // machine identity — so engines 2..4 are all denied against engine 1's live lease.
  const chrome = await register("engine-chrome");
  const edge = await register("engine-edge");
  const firefox = await register("engine-firefox");
  const brave = await register("engine-brave");
  const salt = "engines";
  const first = await startWith(chrome, "laptop-x", undefined, salt);
  assert.equal(first.status, 200, JSON.stringify(first.body));
  const edgeStart = await startWith(edge, "laptop-x-second-browser", undefined, salt);
  assert.equal(edgeStart.status, 409, `Edge must resolve to the same machine: ${JSON.stringify(edgeStart.body)}`);
  const firefoxStart = await startWith(firefox, "laptop-x-firefox-engine", undefined, salt);
  assert.equal(firefoxStart.status, 409, `Firefox must resolve to the same machine: ${JSON.stringify(firefoxStart.body)}`);
  const braveStart = await startWith(brave, "laptop-x-second-browser", undefined, salt);
  assert.equal(braveStart.status, 409, `Brave must resolve to the same machine: ${JSON.stringify(braveStart.body)}`);
  // Every denial names the device rule — no account, IP, or fingerprint detail leaks.
  for (const denied of [edgeStart, firefoxStart, braveStart]) {
    assert.equal((denied.body["error"] as { code: string }).code, "mining_device_already_in_use");
  }
  const activeLeases = await collections.miningDeviceLeases.countDocuments({ ownerUserId: { $in: [chrome.userId, edge.userId, firefox.userId, brave.userId] }, status: "active" });
  assert.ok(activeLeases <= 4, "each lease row belongs to the one winner, never a second cycle");
  const activeSessions = await collections.miningSessions.countDocuments({ ownerUserId: { $in: [chrome.userId, edge.userId, firefox.userId, brave.userId] }, status: "active" });
  assert.equal(activeSessions, 1, "one computer, four browsers, exactly one mining cycle");
});

/**
 * ENROLL-A: identity creation is an enrollment, not a consequence of a valid payload.
 *
 * The first observation of a machine must be admitted (a real new device has to work) but it may not
 * be *trusted*: the record is `provisional` until independent evidence accumulates. And the number of
 * new identities one account can create is a hard, atomically consumed budget.
 */
test("ENROLL-A: a fresh machine is a provisional enrollment and the account budget caps new identities", async () => {
  const account = await register("enroll-a");
  const first = await startWith(account, "laptop-x", undefined, "enroll-a1");
  assert.equal(first.status, 200, JSON.stringify(first.body));
  const device = await collections.miningDevices.findOne({ webglFingerprintHash: `webgl-laptop-x-enroll-a1-${RUN}` });
  assert.ok(device, "the admitted machine is enrolled");
  assert.equal(device.trustState, "provisional", "a first-sight identity is never born established");
  assert.match(device.anchorHash ?? "", /^[0-9a-f]{64}$/, "the enrollment anchor is a server-derived digest");
  assert.equal(device.enrollmentUserId, account.userId);
  assert.equal(device.admissionCount, 1);
  assert.deepEqual(device.aliasHashes ?? [], [], "a first observation is the anchor, not an alias");

  // The default budget is three new identities per account per day. Two more real machines are
  // admitted; the fourth is refused *before* any record exists — the refusal mints nothing.
  // Identity creation is budgeted at its source. A mining start is refused while a cycle runs
  // (`mining_cycle_active`), so the budget is exercised through the same resolution the route uses.
  //
  // The observations carry no machine core trait (nothing from CORE_MACHINE_FEATURES), so no machine
  // key and no anchor match can exist, and the unique visitorId keeps the candidate sweep empty. The
  // one non-core trait that *is* varied is the canvas digest: without it every thin observation
  // normalizes to the same signature, the signature lookup resolves the second call to the first
  // call's record, and the later calls never reach the enrollment gate at all — the budget would look
  // unbounded while only ever being charged once.
  const guard = await import("../modules/mining-device/service.js");
  const intel = { asn: null, country: null, vpn: false, proxy: false, tor: false, hosting: false, anonymous: false, providerRisk: null };
  const thinEvidence = (label: string) => ({
    browserKeyPublicKey: `browser-key-${label}-${RUN}`,
    visitorId: `visitor-${label}-${RUN}`,
    canvasHash: `canvas-${label}-${RUN}`,
    fingerprintConfidence: 0.9,
    fingerprintVersion: "v5",
    integrity: { webdriver: false, headlessHint: false, impossibleUaPlatform: false, missingCapabilities: false },
  });
  const resolve = (label: string, ip: string) =>
    guard.resolveOrCreateDevice({
      collections,
      config,
      evidenceRaw: thinEvidence(label),
      ip,
      intel,
      ownerUserId: account.userId,
      correlationId: `enroll-a-${label}`,
    });
  const second = await resolve("enroll-a2", "10.6.6.2");
  assert.equal(second.trustState, "provisional", "a resolved identity is provisional too");
  await resolve("enroll-a3", "10.6.6.3");
  await assert.rejects(
    resolve("enroll-a4", "10.6.6.4"),
    (error: unknown) => (error as { code?: string }).code === "mining_device_enrollment_limited",
    "the fourth new identity of the day must be refused",
  );
  const held = await collections.miningDevices.countDocuments({ enrollmentUserId: account.userId });
  assert.equal(held, 3, "the account holds exactly its budget of identities, and no more");
});

/**
 * ENROLL-B: a rejected start cannot rewrite trusted identity state.
 *
 * The second account presents the same machine with a moved core trait (a different audio device),
 * a new browser key and rewritten rendering — a plausible poisoning attempt against a device that is
 * already mining. Another account's live lease refuses it, and every trusted field of the record must
 * be byte-identical afterwards: anchor, aliases, snapshot, counters.
 */
test("ENROLL-B: a rejected request leaves the trusted identity untouched", async () => {
  const accountA = await register("mutate-a");
  const accountB = await register("mutate-b");
  const salt = "mutate";
  assert.equal((await startWith(accountA, "laptop-x", undefined, salt)).status, 200);
  const before = await collections.miningDevices.findOne({ webglFingerprintHash: `webgl-laptop-x-${salt}-${RUN}` });
  assert.ok(before);

  const rejected = await call("POST", "/api/v1/mining/start", {
    token: accountB.accessToken,
    body: {
      device: {
        ...deviceEvidence("laptop-x", salt),
        visitorId: `visitor-rewrite-${RUN}`,
        browserKeyPublicKey: `browser-key-rewrite-${RUN}`,
        audioSampleRate: 44100,
        webglHash: `webgl-laptop-x-${salt}-${RUN}`,
      },
    },
  });
  assert.ok(rejected.status >= 400, `the rewrite attempt must not start: ${JSON.stringify(rejected.body)}`);

  const after = await collections.miningDevices.findOne({ _id: before._id });
  assert.ok(after);
  assert.equal(after.anchorHash, before.anchorHash, "the anchor is immutable");
  assert.deepEqual(after.aliasHashes ?? [], before.aliasHashes ?? [], "a rejected request appends no alias");
  assert.equal(after.machineKeyHash, before.machineKeyHash, "the latest-key field is only written on an allowed admission");
  assert.equal(JSON.stringify(after.featureSnapshot ?? {}), JSON.stringify(before.featureSnapshot ?? {}));
  assert.equal(after.admissionCount, before.admissionCount);
  assert.equal(after.findingCount, before.findingCount);
});

/**
 * ENROLL-C: a proof of possession cannot clear the network lock.
 *
 * This is the regression for the measured bypass: the attacker forges a new machine, generates a
 * browser key of its own, answers the challenge, and retried — and the retry was admitted because
 * the proof was accepted as if it proved something about the machine. It proves continuity of a
 * storage context, and anyone can create one, so it must not convert this rule. The exemption is the
 * cluster's own server-owned trust state, which is what the second half of this test asserts.
 */
test("ENROLL-C: a proof of possession cannot clear the network lock, and only trust can", async () => {
  const ip = "10.7.7.7";
  const accountA = await register("net-a");
  assert.equal((await startWith(accountA, "laptop-x", ip, "net-a")).status, 200);

  const accountB = await register("net-b");
  // 1. Keyless first-sight identity: nothing to prove, refused.
  const keyless = await call("POST", "/api/v1/mining/start", {
    token: accountB.accessToken,
    body: { device: deviceEvidence("laptop-x-cleared", "net-b1") },
    ip,
  });
  assert.equal(keyless.status, 409, `a keyless first-sight identity behind an occupied network must be refused: ${JSON.stringify(keyless.body)}`);
  assert.equal((keyless.body["error"] as { code: string }).code, "mining_device_network_in_use");

  // 2. The bypass attempt: a key THIS caller generated, a real handshake, then a retry.
  const keyPair = await globalThis.crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const jwk = (await globalThis.crypto.subtle.exportKey("jwk", keyPair.publicKey)) as Record<string, unknown>;
  const evidence = { ...deviceEvidence("laptop-y", "net-b2"), browserKeyPublicKey: JSON.stringify(jwk) };
  const first = await call("POST", "/api/v1/mining/start", { token: accountB.accessToken, body: { device: evidence }, ip });
  assert.equal(first.status, 409, `a forged identity behind an occupied network is refused: ${JSON.stringify(first.body)}`);
  assert.equal((first.body["error"] as { code: string }).code, "mining_device_network_in_use");

  // The handshake still succeeds — it proves the key, which is all it ever proved.
  const challenge = await call("POST", "/api/v1/mining/device/challenge", { token: accountB.accessToken, body: { device: evidence }, ip });
  assert.equal(challenge.status, 200, JSON.stringify(challenge.body));
  const signature = Buffer.from(
    await globalThis.crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, keyPair.privateKey, Buffer.from(challenge.body["payload"] as string, "utf8")),
  ).toString("base64url");
  const proof = await call("POST", "/api/v1/mining/device/prove", { token: accountB.accessToken, body: { nonce: challenge.body["nonce"], signature, publicKeyJwk: jwk, device: evidence }, ip });
  assert.equal(proof.status, 200, JSON.stringify(proof.body));

  // ...and it must NOT convert the refusal. This is the assertion the bypass broke.
  const retried = await call("POST", "/api/v1/mining/start", { token: accountB.accessToken, body: { device: evidence }, ip });
  assert.equal(retried.status, 409, `a proven attacker key must not clear the network rule: ${JSON.stringify(retried.body)}`);
  assert.equal((retried.body["error"] as { code: string }).code, "mining_device_network_in_use");

  // 3. The refusal left nothing behind: no session, and no active lease on the forged identity.
  assert.equal(await collections.miningSessions.countDocuments({ ownerUserId: accountB.userId, status: "active" }), 0, "the forged identity obtained no mining cycle");
  const forged = await collections.miningDevices.findOne({ webglFingerprintHash: `webgl-laptop-y-net-b2-${RUN}` });
  assert.ok(forged, "the refused observation was still recorded (as an untrusted enrollment, never as a trusted one)");
  assert.equal(forged.trustState, "provisional", "a proof does not promote an identity to established");
  assert.equal(await collections.miningDeviceLeases.countDocuments({ deviceId: forged.publicId, status: "active" }), 0, "the forged identity holds no active lease");

  // 4. The exemption is server-owned trust *on this network, recently* — not a global flag. Each
  // half is scaffolded on its own and asserted to matter: the honest second device is not locked out
  // forever, it just has to have mined *here* (and not too long ago).
  const networkHash = ipHash(config.encryptionKey, ip) ?? "";
  const networkTrust = (lastAtMs: number) => ({
    ipHash: networkHash,
    admissions: config.lmdg.establishMinAdmissions,
    proofs: 0,
    firstAt: new Date(lastAtMs - 60_000),
    lastAt: new Date(lastAtMs),
  });
  // 4a. Globally established, but no credit on this network: still refused. This is the second
  // measured bypass — trust earned (or inherited) anywhere must not surface next to a live cycle
  // here.
  await collections.miningDevices.updateOne(
    { _id: forged._id },
    { $set: { trustState: "established", establishedAt: new Date(), admissionCount: config.lmdg.establishMinAdmissions } },
  );
  const globalOnly = await call("POST", "/api/v1/mining/start", { token: accountB.accessToken, body: { device: evidence }, ip });
  assert.equal(globalOnly.status, 409, `global trust does not exempt a network the cluster never mined on: ${JSON.stringify(globalOnly.body)}`);
  assert.equal((globalOnly.body["error"] as { code: string }).code, "mining_device_network_in_use");

  // 4b. Credited on this network, but older than the freshness window: a visitor again.
  await collections.miningDevices.updateOne(
    { _id: forged._id },
    { $set: { networkTrusts: [networkTrust(Date.now() - (config.lmdg.networkTrustFreshnessSeconds + 3600) * 1000)] } },
  );
  const stale = await call("POST", "/api/v1/mining/start", { token: accountB.accessToken, body: { device: evidence }, ip });
  assert.equal(stale.status, 409, `an expired network residency is not an exemption: ${JSON.stringify(stale.body)}`);

  // 4c. Credited here, fresh: exempt — the honest second device that has mined here is not locked out.
  await collections.miningDevices.updateOne({ _id: forged._id }, { $set: { networkTrusts: [networkTrust(Date.now())] } });
  const established = await call("POST", "/api/v1/mining/start", { token: accountB.accessToken, body: { device: evidence }, ip });
  assert.equal(established.status, 200, `a fresh network residency is exempt on its own network: ${JSON.stringify(established.body)}`);
});

/**
 * ENROLL-F: an admission is a *committed* cycle on a network, not a request.
 *
 * The bypass measured before this rule was "assess three concurrent starts, credit three admissions,
 * then use the identity next to another account's live cycle". An allowed start credits nothing on
 * its own: the credit is written after the session and lease transaction commits, which only one
 * racing request can win — so a burst credits one admission, and the credit is recorded against the
 * network the cycle actually ran on.
 */
test("ENROLL-F: only a committed cycle credits an admission, on the network it ran on", async () => {
  const account = await register("credit");
  const ip = "10.11.11.11";
  const evidence = deviceEvidence("laptop-x", "credit-1");
  const first = await call("POST", "/api/v1/mining/start", { token: account.accessToken, body: { device: evidence }, ip });
  assert.equal(first.status, 200, JSON.stringify(first.body));
  const device = await collections.miningDevices.findOne({ webglFingerprintHash: `webgl-laptop-x-credit-1-${RUN}` });
  assert.ok(device, "the admitted machine is enrolled");
  assert.equal(device.admissionCount, 1, "one committed cycle is one admission");
  const networkHash = ipHash(config.encryptionKey, ip) ?? "";
  assert.deepEqual(
    (device.networkTrusts ?? []).map((entry) => [entry.ipHash, entry.admissions]),
    [[networkHash, 1]],
    "the credit is recorded against the network the cycle ran on",
  );
  assert.equal(device.trustState, "provisional", "one cycle does not establish trust");

  // Isolate the race: the first cycle is over (its lease released, its session closed the way the
  // server closes an expired one), so every request below reaches admission control and the lease
  // insert is the only thing that can commit.
  await collections.miningDeviceLeases.updateMany(
    { deviceId: device.publicId, status: "active" },
    { $set: { status: "released", updatedAt: new Date() } },
  );
  await collections.miningSessions.updateMany(
    { ownerUserId: account.userId, status: "active" },
    { $set: { status: "settled", updatedAt: new Date() } },
  );
  const burst = await Promise.all(
    Array.from({ length: 5 }, () => call("POST", "/api/v1/mining/start", { token: account.accessToken, body: { device: evidence }, ip })),
  );
  assert.ok(
    burst.every((response) => response.status === 200 || response.status === 409),
    `every burst request converges or is refused: ${JSON.stringify(burst.map((response) => [response.status, (response.body["error"] as { code?: string } | undefined)?.code]))}`,
  );
  const after = await collections.miningDevices.findOne({ _id: device._id });
  assert.equal(after?.admissionCount, 2, `one extra committed cycle, never one per request: got ${after?.admissionCount}`);
  // One cycle leases every identity the machine is known by, so the assertion is on the *session*:
  // all live rows for this device belong to one cycle.
  const activeCycles = await collections.miningDeviceLeases.distinct("miningSessionId", { deviceId: device.publicId, status: "active" });
  assert.equal(activeCycles.length, 1, `one device, one active cycle: got ${activeCycles.length}`);
});

/**
 * ENROLL-G: two credits landing together are both recorded.
 *
 * "Mined here, recently" is the only statement the network lock accepts, so a credit that another
 * credit overwrites is a device losing its exemption on a network it actually mined on. The writes
 * increment the entry where it lives (and prepend a new one atomically); rebuilding the whole
 * `networkTrusts` array from one request's earlier read would let the later write erase the earlier
 * credit.
 */
test("ENROLL-G: concurrent credits on different networks are both kept", async () => {
  const account = await register("nettrust");
  const evidence = deviceEvidence("laptop-x", "nettrust-1");
  const started = await call("POST", "/api/v1/mining/start", { token: account.accessToken, body: { device: evidence }, ip: "10.12.12.12" });
  assert.equal(started.status, 200, JSON.stringify(started.body));
  const device = await collections.miningDevices.findOne({ webglFingerprintHash: `webgl-laptop-x-nettrust-1-${RUN}` });
  assert.ok(device, "the admitted machine is enrolled");
  const guard = await import("../modules/mining-device/service.js");
  await Promise.all([
    guard.creditGrantedStart({ collections, config, devicePublicId: device.publicId, ip: "10.12.12.13" }),
    guard.creditGrantedStart({ collections, config, devicePublicId: device.publicId, ip: "10.12.12.14" }),
  ]);
  const after = await collections.miningDevices.findOne({ _id: device._id });
  const admissionsByNetwork = new Map((after?.networkTrusts ?? []).map((entry) => [entry.ipHash, entry.admissions]));
  for (const network of ["10.12.12.12", "10.12.12.13", "10.12.12.14"]) {
    const hash = ipHash(config.encryptionKey, network) ?? "";
    assert.equal(admissionsByNetwork.get(hash) ?? 0, 1, `the credit for ${network} survives the concurrent write`);
  }
  assert.equal(after?.admissionCount, 3, "three committed credits, none lost");
});

/**
 * TRANSITION: rows written by the previous release are converted before the new rules read them.
 *
 * Two shapes changed with the network-bound rule, and neither is readable by the new queries: a live
 * lease taken before leases carried their network (invisible to the network lock for the rest of its
 * cycle, so a second identity could start on an occupied network) and a fixed-window quota counter
 * (invisible to the rolling-window count, so an account at its limit would get the whole limit again
 * inside the same window). Startup converts both, bounded and idempotently.
 */
test("TRANSITION: legacy leases and quota counters are converted by the startup migration", async () => {
  const account = await register("transition");
  const now = new Date();
  const devicePublicId = `transition-device-${RUN}`;
  const leasePublicId = `transition-lease-${RUN}`;
  const network = "10.20.20.20";
  const networkHash = ipHash(config.encryptionKey, network) ?? "";
  const legacyQuotaId = `account:${ENROLLMENT_DAY_MS}:${Math.floor(now.getTime() / ENROLLMENT_DAY_MS)}:${account.userId}`;
  await collections.miningDevices.insertOne({
    publicId: devicePublicId, deviceKeyHash: `transition-key-${RUN}`,
    firstSeenAt: now, lastSeenAt: now, status: "active",
    lastIpHash: networkHash,
    createdAt: now, updatedAt: now,
  } as never);
  // The lease is the previous release's shape: it has no `ipHash` field at all.
  await collections.miningDeviceLeases.insertOne({
    publicId: leasePublicId, deviceClusterId: `transition-key-${RUN}`, deviceId: devicePublicId,
    ownerUserId: account.userId, miningSessionId: `transition-session-${RUN}`,
    leasedAt: now, leaseEndsAt: new Date(now.getTime() + 60 * 60 * 1000), status: "active",
    createdAt: now, updatedAt: now,
  } as never);
  // The counter is the previous release's shape too. Validation is bypassed because that is the only
  // way a row lacking the new required fields can exist — the exact state the migration must handle.
  await collections.miningDeviceQuotas.insertOne(
    { _id: legacyQuotaId, scope: "account", windowMs: ENROLLMENT_DAY_MS, bucketStart: now, count: 2, expiresAt: new Date(now.getTime() + 2 * ENROLLMENT_DAY_MS) } as never,
    { bypassDocumentValidation: true },
  );

  await ensureDatabaseIndexes(client.db(config.mongoDatabase));

  const lease = await collections.miningDeviceLeases.findOne({ publicId: leasePublicId });
  assert.equal(lease?.ipHash, networkHash, "the legacy lease now occupies the network it was taken from");
  assert.equal(await collections.miningDeviceQuotas.findOne({ _id: legacyQuotaId }), null, "the converted counter is gone, so it cannot count twice");
  const converted = await collections.miningDeviceQuotas.countDocuments({
    scope: "account", subject: account.userId, windowMs: ENROLLMENT_DAY_MS, refs: { $gt: 0 }, at: { $gt: new Date(Date.now() - ENROLLMENT_DAY_MS) },
  });
  assert.equal(converted, 2, "the two enrollments the counter stood for still count");

  await collections.miningDeviceLeases.deleteOne({ publicId: leasePublicId });
  await collections.miningDevices.deleteOne({ publicId: devicePublicId });
  await collections.miningDeviceQuotas.deleteMany({ subject: account.userId });
});

/**
 * ENROLL-D: a concurrent enrollment burst cannot outrun the identity budget, and refusals are
 * refunded.
 *
 * Five simultaneous first-time enrollments from one account against a rolling budget of three. The
 * guarantee under concurrency is *at most* the limit: each request inserts its own slot, counts the
 * window including it, and releases its reference when the count is over — so a burst can admit
 * fewer (the race resolves conservatively) but never more, and each refusal gives the account its
 * slot back instead of spending it on an enrollment that did not happen. Releasing a reference (not
 * deleting the row) is what keeps a concurrent enrollment of the same machine counted.
 */
test("ENROLL-D: a concurrent enrollment burst cannot outrun the identity budget, and refusals are refunded", async () => {
  const account = await register("enroll-d");
  const guard = await import("../modules/mining-device/service.js");
  const intel = { asn: null, country: null, vpn: false, proxy: false, tor: false, hosting: false, anonymous: false, providerRisk: null };
  const labels = ["enroll-d1", "enroll-d2", "enroll-d3", "enroll-d4", "enroll-d5"];
  const results = await Promise.all(
    labels.map((label, index) =>
      guard
        .resolveOrCreateDevice({
          collections,
          config,
          // Browser-key-only evidence: it cannot match an existing cluster, so all five calls race
          // the enrollment gate itself.
          evidenceRaw: {
            browserKeyPublicKey: `browser-key-${label}-${RUN}`,
            visitorId: `visitor-${label}-${RUN}`,
            integrity: { webdriver: false, headlessHint: false, impossibleUaPlatform: false, missingCapabilities: false },
          },
          ip: `10.8.8.${10 + index}`,
          intel,
          ownerUserId: account.userId,
          correlationId: `enroll-d-${label}`,
        })
        .then(() => "created" as const)
        .catch((error: unknown) => (error as { code?: string }).code ?? "error"),
    ),
  );
  const admitted = results.filter((r) => r === "created").length;
  const refused = results.filter((r) => r === "mining_device_enrollment_limited").length;
  assert.ok(admitted <= 3, `the budget is never exceeded under a burst: ${JSON.stringify(results)}`);
  assert.equal(admitted + refused, 5, `every other burst request is refused by the budget: ${JSON.stringify(results)}`);
  const created = await collections.miningDevices.countDocuments({ enrollmentUserId: account.userId });
  assert.equal(created, admitted, `only admitted enrollments became records: got ${created}`);
  // Every refusal was refunded, so the slots the burst did not use are still spendable — this is the
  // assertion issue 4 broke: a refused request must not cost the account one of its three.
  let refunded = 0;
  for (let index = 0; index < 3 - admitted; index += 1) {
    const spent = await guard
      .resolveOrCreateDevice({
        collections,
        config,
        evidenceRaw: {
          browserKeyPublicKey: `browser-key-refund-${index}-${RUN}`,
          visitorId: `visitor-refund-${index}-${RUN}`,
          integrity: { webdriver: false, headlessHint: false, impossibleUaPlatform: false, missingCapabilities: false },
        },
        ip: `10.8.9.${index + 1}`,
        intel,
        ownerUserId: account.userId,
        correlationId: `enroll-d-refund-${index}`,
      })
      .then(() => true)
      .catch(() => false);
    if (spent) refunded += 1;
  }
  assert.equal(refunded, 3 - admitted, `the slots refused under the race are still spendable afterwards: got ${refunded}`);
});

/**
 * ENROLL-E: a proof is bound to the enrollment it was issued for.
 *
 * The challenge commits to the server-resolved anchor of the evidence it was requested with. A
 * signature minted under that challenge but presented with *different* device evidence recomputes a
 * different payload, so it verifies nowhere — the same request with the original evidence does.
 */
test("ENROLL-E: a proof minted for one enrollment cannot be spent on another", async () => {
  const account = await register("bind");
  const evidenceA = { ...deviceEvidence("laptop-x", "bind-a") };
  const evidenceB = { ...deviceEvidence("laptop-y", "bind-b") };
  const keyPair = await globalThis.crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const jwk = (await globalThis.crypto.subtle.exportKey("jwk", keyPair.publicKey)) as Record<string, unknown>;
  const request = await call("POST", "/api/v1/mining/device/challenge", {
    token: account.accessToken,
    body: { device: { ...evidenceA, browserKeyPublicKey: JSON.stringify(jwk) } },
  });
  assert.equal(request.status, 200, JSON.stringify(request.body));
  const signature = Buffer.from(
    await globalThis.crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, keyPair.privateKey, Buffer.from(request.body["payload"] as string, "utf8")),
  ).toString("base64url");
  const mismatched = await call("POST", "/api/v1/mining/device/prove", {
    token: account.accessToken,
    body: {
      nonce: request.body["nonce"],
      signature,
      publicKeyJwk: jwk,
      device: { ...evidenceB, browserKeyPublicKey: JSON.stringify(jwk) },
    },
  });
  assert.equal(mismatched.status, 401, `a proof presented for another enrollment must fail: ${JSON.stringify(mismatched.body)}`);
});

test("account B keeps full non-mining access while its mining start is rejected", async () => {
  const accountA = await register("access-a");
  const accountB = await register("access-b");
  const ownStart = await startWith(accountA, "laptop-x", undefined, "access");
  assert.equal(ownStart.status, 200, `account A's own fresh machine starts: ${JSON.stringify(ownStart.body)}`);
  assert.equal((await startWith(accountB, "laptop-x", undefined, "access")).status, 409);
  // Wallet + state reads are unaffected by the device lease.
  assert.equal((await call("GET", "/api/v1/wallet", { token: accountB.accessToken })).status, 200);
  assert.equal((await call("GET", "/api/v1/mining/state", { token: accountB.accessToken })).status, 200);
  assert.equal((await call("GET", "/api/v1/mining/device/status", { token: accountB.accessToken })).status, 200);
});
