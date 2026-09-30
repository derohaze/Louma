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
const nextIp = () => `10.9.0.${(requestIp++ % 250) + 1}`;

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
  const sampleRate = [44100, 96000, 192000][index % 3]!;
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
  for (const userId of createdUserIds) {
    await collections.miningSessions.deleteMany({ ownerUserId: userId });
    await collections.miningSettlements.deleteMany({ ownerUserId: userId });
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
  // records a denial left without either. A bare creation-time window is never used — it would also
  // match devices another suite or user created mid-run against the same database.
  const observedDeviceIds = (
    (await collections.miningDeviceObservations.distinct("deviceId", { ownerUserId: { $in: createdUserIds } }).catch(() => [] as unknown[])) as unknown[]
  ).filter((value): value is string => typeof value === "string");
  const runDevices = await collections.miningDevices
    .find(
      {
        $or: [
          { publicId: { $in: observedDeviceIds } },
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
    await collections.miningDeviceLeases.deleteMany({ deviceClusterId: { $in: runLeaseKeys } });
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

test("D+L: two different machines on the same home IP may both mine", async () => {
  const accountA = await register("home-a");
  const accountB = await register("home-b");
  const first = await startWith(accountA, "laptop-x", "203.0.113.44", "home-x");
  assert.equal(first.status, 200, JSON.stringify(first.body));
  const second = await startWith(accountB, "laptop-y", "203.0.113.44", "home-y");
  assert.equal(second.status, 200, `shared Wi-Fi must not block a different machine: ${JSON.stringify(second.body)}`);
});

test("E: VPN-like network change does not free the device", async () => {
  const accountA = await register("vpn-a");
  const accountB = await register("vpn-b");
  const first = await startWith(accountA, "laptop-x", "203.0.113.44", "vpn");
  assert.equal(first.status, 200, JSON.stringify(first.body));
  const second = await startWith(accountB, "laptop-x-vpn", "198.51.100.7", "vpn");
  assert.equal(second.status, 409, `network change must not re-identify the machine: ${JSON.stringify(second.body)}`);
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

test("account B keeps full non-mining access while its mining start is rejected", async () => {
  const accountA = await register("access-a");
  const accountB = await register("access-b");
  assert.equal((await startWith(accountA, "laptop-x", undefined, "access")).status, 200);
  assert.equal((await startWith(accountB, "laptop-x", undefined, "access")).status, 409);
  // Wallet + state reads are unaffected by the device lease.
  assert.equal((await call("GET", "/api/v1/wallet", { token: accountB.accessToken })).status, 200);
  assert.equal((await call("GET", "/api/v1/mining/state", { token: accountB.accessToken })).status, 200);
  assert.equal((await call("GET", "/api/v1/mining/device/status", { token: accountB.accessToken })).status, 200);
});
