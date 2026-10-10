import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { ClientSession, MongoClient } from "mongodb";
import { buildApp } from "../app.js";
import { loadConfig, type AppConfig } from "../config/env.js";
import { connectMongo } from "../infrastructure/mongodb/client.js";
import { ensureDatabaseIndexes } from "../infrastructure/mongodb/indexes.js";
import { getCollections, type Collections } from "../infrastructure/mongodb/collections.js";
import { disabledRedis } from "../infrastructure/redis/client.js";
import {
  buildFeatureMap,
  CORE_MACHINE_FEATURE_SET,
  decideClusterMatch,
  digestFeatureMap,
  ipHash,
  isMachineIdentityMatch,
  isNearCloneMatch,
  learnFeatureProfile,
  matchDeviceFeatures,
  MIN_CORE_IDENTITY_AGREEMENTS,
  MIN_CORE_IDENTITY_MOVES,
} from "../modules/mining-device/identity.js";
import { consumeEnrollmentBudget } from "../modules/mining-device/enrollment.js";
import { normalizeSignals, sanitizeEvidence } from "../modules/mining-device/signals.js";
import { MINING_DAILY_QUOTA_SECONDS } from "../modules/mining/quota.js";
import { ENROLLMENT_DAY_MS, NETWORK_LOCK_KEY_PATTERN } from "../modules/mining-device/policy.js";

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
// Every address this suite observes, so the `after` cleanup can release the per-network enrollment
// slots it spent: those rows are keyed by network hash, not by account, and reused probe addresses
// accumulate against the per-network budget across runs until a fresh device is refused for the wrong
// reason.
const usedIps = new Set<string>();
const nextIp = () => {
  const index = requestIp++;
  const address = `10.9.${Math.floor(index / 254) % 254}.${(index % 254) + 1}`;
  usedIps.add(address);
  return address;
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
  const remoteAddress = options.ip ?? nextIp();
  usedIps.add(remoteAddress);
  const response = await app.inject({
    method,
    url,
    headers,
    remoteAddress,
    ...(options.body === undefined ? {} : { payload: options.body as Record<string, unknown> }),
  });
  const body = response.payload.length ? (response.json() as Record<string, unknown>) : {};
  if (typeof body["accessToken"] === "string" && typeof body["csrfToken"] === "string") {
    csrfByAccessToken.set(body["accessToken"], body["csrfToken"]);
  }
  return { status: response.statusCode, body };
}

async function register(label: string, poolId: "low" | "medium" = "low"): Promise<Account> {
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
  // Mining requires a held room: the fixture takes Low up front, and `startWith` re-takes it for
  // every start, because a stop or a finished window releases it.
  const joined = await call("POST", "/api/v1/mining/pools/join", {
    token: response.body["accessToken"] as string,
    body: { poolId },
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
 * The engine-stable identity slots (core count, touch class, audio device, gamut, HDR, panel depth)
 * are assigned by the small code in `machineShape`, not by this table: the table supplies the
 * display, timezone and browser variety that keeps two fixtures apart in the score bands, while the
 * code keeps them out of the near-clone band (see the comment there). `machineIndexBySalt`
 * assignment keeps two namespaces apart even when one runs alone.
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
  return machineShapeAtIndex(index);
}

/** The shape of fixture index `index`, independent of the salt assignment. */
function machineShapeAtIndex(index: number): MachineShape {
  const system = SYSTEMS[index % SYSTEMS.length]!;
  const shape = MACHINES[index % MACHINES.length]!;
  /**
   * The fixture core is a small error-detecting code, not the shape table: any two distinct indices
   * must differ in at least three of the six engine-stable identity slots (see
   * `CORE_MACHINE_FEATURE_SET`). One moved slot sits exactly on the "same machine" path — measured
   * at `machineScore` 78, the high threshold, for a `laptop-x-firefox-engine` fixture, which by
   * design reports neither `deviceMemory` nor the capture devices and so agreed with a neighbour on
   * every machine trait it could report — and two moved slots are the guard's near-clone band (see
   * `MIN_CORE_IDENTITY_MOVES`). Either way a later test inherits an earlier test's live lease
   * instead of exercising its own rule: the measured failure was the ATTACK network race, refused
   * with `already_in_use` because STALE's `laptop-y` was still mining.
   *
   * Four data slots carry a mixed-radix index — CPU class (5), touch class (3), display gamut (3),
   * HDR (2) — and the panel colour depth is their certificate: its digit is a weighted sum of the
   * four, nonzero for every possible change of any one of them, so no two indices differ in exactly
   * one slot. Minimum distance two, plus the per-index audio device (the sixth slot, and the key's
   * guarantee of uniqueness against real machines on a shared database), gives three moved slots
   * for every cross-index pair, whatever corroborators an engine reports. Capacity is the product
   * of the four alphabets, 90 machines; the FIXTURE ISOLATION test asserts the suite stays inside
   * it rather than silently wrapping and reusing an index.
   */
  const hardwareDigit = index % 5;
  const touchDigit = Math.floor(index / 5) % 3;
  const gamutDigit = Math.floor(index / 15) % 3;
  const hdrDigit = Math.floor(index / 45) % 2;
  const depthDigit = (hardwareDigit + 3 * touchDigit + 5 * gamutDigit + 7 * hdrDigit) % 8;
  // The identity the guard compares is deliberately coarse — bucketed CPU class, panel colour
  // depth, HDR capability, negotiated audio device, display gamut, touch class — so a fixture built
  // from the *most common* desktop profile (24-bit sRGB panel, no HDR, a 48 kHz stereo output, no
  // touch points) is indistinguishable from a real customer's machine. The suite runs against a
  // shared development database that does hold real machines with live leases, and such a fixture
  // would inherit one (verified: it did). Every fixture therefore reports a panel and an audio
  // device no plain desktop reports — an HDR panel at a non-24-bit depth, and never 48 kHz — and the
  // index varies both, so no two fixtures collide with each other either.
  // The audio device is unique per index, deliberately: it is the sixth core slot the machine key
  // hashes, and a rate cycled from a short list was not enough to keep two namespaces apart — an
  // early version reused one and a later test resolved to the earlier test's cluster (and its live
  // lease) instead of enrolling its own machine. The values stay realistic: a plain audio device
  // other than 48 kHz, which is what keeps a fixture from colliding with a real customer's machine
  // in a shared database.
  const sampleRate = 22050 + index * 750;
  return {
    ...shape,
    platform: system.platform,
    userAgent: system.userAgent,
    firefoxUserAgent: system.firefoxUserAgent,
    platformVersion: system.version(index),
    // One GPU identity per simulated machine, and one per run: the machine key is built from these,
    // so they must be as distinct as the screens and CPU classes are, and must not survive a run.
    // Identity slots, from the certificate code above; the machine key hashes exactly these six.
    hardwareConcurrency: [2, 4, 8, 16, 32][hardwareDigit]!,
    maxTouchPoints: [0, 5, 10][touchDigit]!,
    colorGamut: ["srgb", "p3", "rec2020"][gamutDigit]!,
    hdr: hdrDigit === 1,
    screenColorDepth: [24, 30, 32, 36, 40, 48, 56, 64][depthDigit]!,
    audioSampleRate: sampleRate,
    // Corroborators: free to vary with the index for realism, at finer granularity than the code.
    // The isolation guarantee does not depend on them — that is the point, since an engine may
    // report none of them.
    deviceMemory: [2, 4, 8, 16][index % 4]!,
    mediaAudioInputs: [0, 1, 2, 3][Math.floor(index / 4) % 4]!,
    mediaVideoInputs: 1,
    screenAvailWidth: shape.screenWidth,
    screenAvailHeight: shape.screenHeight - 40,
    webglVendor: `vendor-${index}-${RUN}`,
    webglRenderer: `renderer-${index}-${RUN}`,
    webglLimitsHash: `limits-${index}-${RUN}`,
    webglExtensionsHash: `extensions-${index}-${RUN}`,
    webgpuHash: `webgpu-${index}-${RUN}`,
    audioChannels: 2,
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
  // Every rendering digest and browser-scoped key is namespaced by the salt as well as by the run:
  // these are the browser's own values, not the machine's, so two fixtures of one kind from two
  // salts must not agree on them. Pinned `brave`-browser digests once kept unrelated variants above
  // the ambiguity score on corroborators alone (measured by the FIXTURE ISOLATION sweep). The
  // machine slots are deliberately not tagged — they come from the shared index code.
  const withSalt = (evidence: Record<string, unknown>): Record<string, unknown> => {
    const tagged: Record<string, unknown> = { ...evidence };
    for (const [key, value] of Object.entries(tagged)) {
      if (key === "visitorId" || key === "browserKeyPublicKey" || key.endsWith("Hash")) {
        tagged[key] = value === null ? null : tag(String(value));
      }
    }
    return tagged;
  };
  switch (kind) {
    case "laptop-x":
      return withSalt({ ...base, visitorId: "visitor-laptop-x-chrome", browserKeyPublicKey: "browser-key-laptop-x-chrome" });
    case "laptop-y":
      // A second, Mac-flavoured machine — and, like every other fixture, it must stay a *distinct*
      // machine from every other salt. An earlier version pinned the compared slots here (CPU class,
      // gamut, memory class, capture devices, display, timezone), and that defeated the fixture
      // code: two `laptop-y` fixtures then agreed on four of the six core slots and differed only in
      // the touch class, the audio device and whichever code bit the pin erased — exactly the
      // near-clone band. The second one was refused `mining_device_already_in_use` while the first
      // held a live lease (measured: the ATTACK network race once the near-clone guard existed,
      // because STALE leaves its `laptop-y` cycle running). Only the machine's *description* is
      // pinned (user agent, platform, version); every compared slot and corroborator stays
      // index-driven like the pristine shapes.
      return withSalt({
        ...base, visitorId: "visitor-laptop-y", userAgent: `${MAC_UA} Chrome/126.0`,
        platform: "MacIntel", platformVersion: "14.5",
        screenWidth: base.screenWidth + 1024, screenHeight: base.screenHeight + 512,
        screenAvailWidth: base.screenWidth + 1024, screenAvailHeight: base.screenHeight + 472,
        pixelRatio: base.pixelRatio + 1,
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
        // The second window sits on a second monitor: its geometry differs from the same salt's
        // `laptop-x`, while still moving with the index like every other corroborator.
        screenWidth: base.screenWidth - 240,
        screenHeight: base.screenHeight - 180,
        screenAvailWidth: base.screenWidth - 240,
        screenAvailHeight: base.screenHeight - 180,
        webglVendor: "brave",
        webglRenderer: "brave",
        webglLimitsHash: `limits-brave-${RUN}`,
        webglExtensionsHash: `extensions-brave-${RUN}`,
        webgpuHash: `webgpu-brave-${RUN}`,
        webglHash: "webgl-laptop-x-brave",
        canvasHash: "canvas-laptop-x-brave",
        audioHash: "audio-laptop-x-brave",
        speechVoicesHash: `voices-brave-${RUN}`,
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

async function startWith(account: Account, kind: Parameters<typeof deviceEvidence>[0], ip?: string, salt?: string, platform?: string) {
  // A cycle only opens from inside a room, and both a stop and a finished window release it, so
  // every start takes its room first. Re-joining a held room is an idempotent no-op, and the room
  // is the same one in every scenario here, so the churn throttle never applies to it.
  const joined = await call("POST", "/api/v1/mining/pools/join", { token: account.accessToken, body: { poolId: "low" } });
  assert.equal(joined.status, 200, JSON.stringify(joined.body));
  const response = await call("POST", "/api/v1/mining/start", {
    token: account.accessToken,
    body: { device: { ...deviceEvidence(kind, salt), ...(platform === undefined ? {} : { platform }) } },
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
    // The journal header is the settlement record (see ADR-003): one header per reward.
    const settlements = await collections.transactions.find({ type: "mining", miningSessionId: sessionId }).toArray();
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
  app = await buildApp({ config, collections, mongoClient: client, redis: disabledRedis(), logger: false });
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
  // Devices and enrollment slots this run's accounts created. A thin identity record (minted by a
  // direct `resolveOrCreateDevice` probe, with no lease and no observation) is linked to the run only
  // by `enrollmentUserId`; leaving it behind lets a later run's fresh observations absorb into it as
  // "the same machine", which silently skips the enrollment budget (measured: ENROLL-D failed on the
  // second run of the same database until this cleanup existed).
  await collections.miningDevices.deleteMany({ enrollmentUserId: { $in: createdUserIds } });
  await collections.miningDeviceQuotas.deleteMany({ subject: { $in: createdUserIds } });
  // Network-scope enrollment slots are keyed by network hash, not by account, so the delete above
  // cannot reach them. Every address this run observed is released by its own hash: the suite's fixed
  // probe addresses are reused across runs, and the un-owned rows accumulate against the per-network
  // budget until a later run's fresh device is refused for the wrong reason (measured: the ATTACK
  // network race turned into `enrollment_limited` on a heavily reused database).
  const usedNetworkHashes = [...usedIps]
    .map((address) => ipHash(config.encryptionKey, address))
    .filter((hash): hash is string => hash !== null);
  if (usedNetworkHashes.length > 0) {
    await collections.miningDeviceQuotas.deleteMany({ scope: "network", subject: { $in: usedNetworkHashes } });
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

test("PRIVACY: thin evidence is refused, but masked graphics with machine evidence can mine", async () => {
  const account = await register("privacy");
  const salt = "privacy";
  const baseline = deviceEvidence("laptop-x", salt);
  const initialDevices = await collections.miningDevices.countDocuments({});
  for (const device of [
    { browserKeyPublicKey: `key-only-${RUN}`, fingerprintConfidence: 1 },
    { ...baseline, hardwareConcurrency: null, maxTouchPoints: null, audioSampleRate: null, colorGamut: null, hdr: null, screenColorDepth: null },
  ]) {
    const result = await call("POST", "/api/v1/mining/start", { token: account.accessToken, body: { device } });
    assert.equal(result.status, 400, JSON.stringify(result.body));
    const error = result.body["error"] as { code: string; message: string };
    assert.equal(error.code, "mining_device_evidence_required");
    assert.ok(!error.message.includes("active mining cycle"), "no false occupied-device claim");
  }
  assert.equal(await collections.miningDevices.countDocuments({}), initialDevices, "no junk device registered");
  assert.equal(await collections.miningSessions.countDocuments({ ownerUserId: account.userId }), 0);
  assert.equal(await collections.miningDeviceLeases.countDocuments({ ownerUserId: account.userId }), 0);
  assert.equal(await collections.miningDeviceQuotas.countDocuments({ subject: account.userId }), 0);
  assert.equal((await call("GET", "/api/v1/mining/state", { token: account.accessToken })).status, 200, "account remains accessible");
  const started = await call("POST", "/api/v1/mining/start", { token: account.accessToken, body: { device: { ...baseline, webglVendor: "Mozilla", webglRenderer: "Mozilla" } } });
  assert.equal(started.status, 200, JSON.stringify(started.body));
  assert.equal((await call("POST", "/api/v1/mining/stop", { token: account.accessToken })).status, 200);
});

test("STALE: future-dated leftover leases cannot block mining without a running session", async () => {
  const former = await register("stale-former");
  const next = await register("stale-next");
  const salt = "stale";
  const formerIp = "10.22.22.22";
  const result = await startWith(former, "laptop-x", formerIp, salt);
  assert.equal(result.status, 200, JSON.stringify(result.body));
  const sessionId = (result.body["session"] as { id: string }).id;
  // While the cycle runs, the account's device status reflects the binding it holds.
  const bound = await call("GET", "/api/v1/mining/device/status", { token: former.accessToken });
  assert.equal(bound.status, 200);
  assert.equal(bound.body["bound"], true, "a running cycle keeps the device bound");
  assert.equal(typeof bound.body["deviceId"], "string");
  // Simulate a legacy stop which closed the cycle but forgot to release its future-dated leases.
  await collections.miningSessions.updateOne({ publicId: sessionId }, { $set: { status: "settled", endsAt: new Date(Date.now() - 1000) } });
  // The *running session* is what the status reports: the still-active lease row of a closed cycle
  // must not keep claiming a device the account no longer holds.
  const unbound = await call("GET", "/api/v1/mining/device/status", { token: former.accessToken });
  assert.equal(unbound.body["bound"], false, "a settled session does not keep the device bound");
  assert.equal(unbound.body["deviceId"], null);
  assert.equal(unbound.body["leaseEndsAt"], null);
  const started = await startWith(next, "laptop-x-firefox", undefined, salt);
  assert.equal(started.status, 200, JSON.stringify(started.body));
  // The machine's stale device leases are cleared by the next start on the same identities; the
  // per-network admission token is a different identity (a lease with no device behind it) and is not
  // this machine's row.
  assert.equal(
    await collections.miningDeviceLeases.countDocuments({ ownerUserId: former.userId, status: "active", deviceClusterId: { $not: { $regex: NETWORK_LOCK_KEY_PATTERN } } }),
    0,
  );
  assert.equal(await collections.miningSessions.countDocuments({ ownerUserId: next.userId, status: "active" }), 1);
  // A token left active by a cycle that is no longer running is not live: a later start on that same
  // network is admitted, and releases the leftover row as part of its own transaction.
  const successor = await register("stale-successor");
  const reopened = await startWith(successor, "laptop-y", formerIp, "stale-2");
  assert.equal(reopened.status, 200, JSON.stringify(reopened.body));
  assert.equal(await collections.miningDeviceLeases.countDocuments({ ownerUserId: former.userId, status: "active" }), 0, "the stale network token is released");
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

test("ATTACK: distinct new identities racing on one network cannot both mine", async () => {
  const a = await register("net-race-a");
  const b = await register("net-race-b");
  const ip = "10.21.21.21";
  const results = await Promise.all([
    startWith(a, "laptop-x", ip, "net-race-a"),
    startWith(b, "laptop-y", ip, "net-race-b"),
  ]);
  assert.equal(results.filter((result) => result.status === 200).length, 1, JSON.stringify(results));
  assert.equal(results.filter((result) => result.status === 409).length, 1, JSON.stringify(results));
  assert.equal(await collections.miningSessions.countDocuments({ ownerUserId: { $in: [a.userId, b.userId] }, status: "active" }), 1);
  const rejected = results.find((result) => result.status === 409);
  assert.ok(rejected, "the race must produce exactly one refusal");
  assert.equal((rejected.body["error"] as { code: string }).code, "mining_device_network_in_use", JSON.stringify(rejected.body));
  // The refusal really is a refusal: the loser's transaction aborted, so it holds no lease of its own.
  const loser = results[0] === rejected ? a : b;
  assert.equal(
    await collections.miningDeviceLeases.countDocuments({ ownerUserId: loser.userId, status: "active" }),
    0,
    "the refused racer keeps no active lease",
  );
});

test("ATTACK: an anchored challenge cannot be proven with a different signing key", async () => {
  const account = await register("proof-key-swap");
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const other = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const jwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  const otherJwk = await crypto.subtle.exportKey("jwk", other.publicKey);
  const device = { ...deviceEvidence("laptop-x", "proof-key-swap"), browserKeyPublicKey: JSON.stringify(jwk) };
  const challenge = await call("POST", "/api/v1/mining/device/challenge", { token: account.accessToken, body: { device } });
  assert.equal(challenge.status, 200, JSON.stringify(challenge.body));
  const signature = Buffer.from(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, other.privateKey, Buffer.from(challenge.body["payload"] as string))).toString("base64url");
  const proof = await call("POST", "/api/v1/mining/device/prove", { token: account.accessToken, body: { nonce: challenge.body["nonce"], signature, publicKeyJwk: otherJwk, device } });
  assert.equal(proof.status, 401, JSON.stringify(proof.body));
  const nonce = await collections.miningDeviceNonces.findOne({ nonce: challenge.body["nonce"] as string });
  assert.equal(nonce?.consumedAt, null, "a key mismatch cannot consume the challenge");

  // The challenge is still usable by the key it was issued to: a mismatched attempt must not poison
  // it, and the legitimate signer must not be refused.
  const boundSignature = Buffer.from(
    await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, pair.privateKey, Buffer.from(challenge.body["payload"] as string)),
  ).toString("base64url");
  const verified = await call("POST", "/api/v1/mining/device/prove", {
    token: account.accessToken,
    body: { nonce: challenge.body["nonce"], signature: boundSignature, publicKeyJwk: jwk, device },
  });
  assert.equal(verified.status, 200, JSON.stringify(verified.body));
  const consumed = await collections.miningDeviceNonces.findOne({ nonce: challenge.body["nonce"] as string });
  assert.ok(consumed?.consumedAt, "the bound key consumes the challenge");
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
  assert.equal(second.status, 409, `the same machine must remain occupied: ${JSON.stringify(second.body)}`);
  assert.equal((second.body["error"] as { code: string }).code, "mining_device_already_in_use");

  // Both browsers resolve to the occupied machine despite different graphics evidence.
  const observations = await collections.miningDeviceObservations
    .find({ ownerUserId: { $in: [accountA.userId, accountB.userId] } })
    .toArray();
  assert.equal(observations.length, 2, "both browsers reach device observation");
  assert.equal(new Set(observations.map((observation) => observation.deviceId)).size, 1);
  assert.deepEqual(
    [...new Set(observations.map((observation) => observation.ownerUserId))].sort(),
    [accountA.userId, accountB.userId].sort(),
  );
  assert.equal(await collections.miningSessions.countDocuments({ ownerUserId: accountB.userId }), 0);
  assert.equal(await collections.miningDeviceLeases.countDocuments({ ownerUserId: accountB.userId }), 0);
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
  for (const denied of [edgeStart, braveStart]) {
    assert.equal((denied.body["error"] as { code: string }).code, "mining_device_already_in_use");
  }
  assert.equal((firefoxStart.body["error"] as { code: string }).code, "mining_device_already_in_use");
  const activeLeases = await collections.miningDeviceLeases.countDocuments({ ownerUserId: { $in: [chrome.userId, edge.userId, firefox.userId, brave.userId] }, status: "active" });
  assert.ok(activeLeases <= 4, "each lease row belongs to the one winner, never a second cycle");
  const activeSessions = await collections.miningSessions.countDocuments({ ownerUserId: { $in: [chrome.userId, edge.userId, firefox.userId, brave.userId] }, status: "active" });
  assert.equal(activeSessions, 1, "one computer, four browsers, exactly one mining cycle");
});

test("NEAR-CLONE: editing two identity slots does not open a second cycle on one machine", async () => {
  // The attack the near-clone band answers: account B presents the same computer as account A but
  // edits two of the six engine-stable identity slots — the display gamut and the audio device —
  // while CPU class, touch class, panel depth and HDR still agree, and the engine-owned corroborators
  // (fonts, capture devices, memory class) have moved because B is a different browser. Measured
  // before the band existed: this scored below the ambiguity threshold and B mined beside A on a
  // second network. It is now the conservative middle: refused while A's cycle is live, and never
  // merged into A's record.
  const accountA = await register("nearclone-a");
  const accountB = await register("nearclone-b");
  const salt = "nearclone";
  const first = await startWith(accountA, "laptop-x", undefined, salt);
  assert.equal(first.status, 200, JSON.stringify(first.body));
  const base = deviceEvidence("laptop-x-firefox-engine", salt);
  const cloned = await call("POST", "/api/v1/mining/start", {
    token: accountB.accessToken,
    body: {
      device: {
        ...base,
        colorGamut: base["colorGamut"] === "p3" ? "srgb" : "p3",
        audioSampleRate: 48000,
        visitorId: `visitor-nearclone-b-${RUN}`,
        browserKeyPublicKey: `key-nearclone-b-${RUN}`,
      },
    },
  });
  assert.equal(cloned.status, 409, `a near-clone must not mine beside the machine it copies: ${JSON.stringify(cloned.body)}`);
  assert.equal((cloned.body["error"] as { code: string }).code, "mining_device_already_in_use");
  assert.equal(
    await collections.miningSessions.countDocuments({ ownerUserId: { $in: [accountA.userId, accountB.userId] }, status: "active" }),
    1,
  );
});

test("NEAR-CLONE RACE: two accounts editing identity slots cannot both mine one machine", async () => {
  const accountA = await register("nearclone-race-a");
  const accountB = await register("nearclone-race-b");
  const salt = "nearclone-race";
  const evidenceA = { ...deviceEvidence("laptop-x", salt), visitorId: `visitor-nearclone-race-a-${RUN}`, browserKeyPublicKey: `key-nearclone-race-a-${RUN}` };
  const base = deviceEvidence("laptop-x-firefox-engine", salt);
  const evidenceB = {
    ...base,
    colorGamut: base["colorGamut"] === "p3" ? "srgb" : "p3",
    audioSampleRate: 48000,
    visitorId: `visitor-nearclone-race-b-${RUN}`,
    browserKeyPublicKey: `key-nearclone-race-b-${RUN}`,
  };
  const [first, second] = await Promise.all([
    call("POST", "/api/v1/mining/start", { token: accountA.accessToken, body: { device: evidenceA } }),
    call("POST", "/api/v1/mining/start", { token: accountB.accessToken, body: { device: evidenceB } }),
  ]);
  const active = await collections.miningSessions.countDocuments({ ownerUserId: { $in: [accountA.userId, accountB.userId] }, status: "active" });
  assert.ok(active <= 1, `no two cycles on one machine: ${JSON.stringify({ first: first.status, second: second.status })}`);
  if (active === 1) {
    assert.equal([first, second].filter((result) => result.status === 200).length, 1, "the one cycle belongs to exactly one accepted start");
  }
});

test("EXISTING PROFILE RACE: ambiguous browser identities cannot both pass before either cycle commits", async (t) => {
  const { resolveOrCreateDevice } = await import("../modules/mining-device/resolution.js");
  const { toCandidate, observedFeatures } = await import("../modules/mining-device/resolution.js");
  const a = await register("existing-race-a");
  const b = await register("existing-race-b");
  // This test deliberately edits the fixture code's CPU slot, which can move it onto an earlier
  // test's machine. Pick two CPU classes that remain unrelated to the existing test population;
  // the two profiles below must still be ambiguous with each other (asserted after enrollment).
  const prototype = deviceEvidence("laptop-x", "existing-profile-race");
  const previousDevices = await collections.miningDevices.find({}).toArray();
  const isolatedCpus = [2, 4, 8, 16, 32].filter(hardwareConcurrency => {
    const observed = observedFeatures(config.encryptionKey, normalizeSignals(sanitizeEvidence({ ...prototype, hardwareConcurrency })));
    return previousDevices.every(previous => decideClusterMatch(
      matchDeviceFeatures(toCandidate(previous), observed, config.encryptionKey),
      config.lmdg.highConfidenceThreshold, config.lmdg.ambiguousThreshold,
    ) === "different");
  });
  assert.ok(isolatedCpus.length >= 2, "two class-edited fixtures must be isolated from earlier test devices");
  const evidenceA = { ...prototype, hardwareConcurrency: isolatedCpus[0]! };
  const evidenceB = {
    ...evidenceA,
    hardwareConcurrency: isolatedCpus[1]!,
    visitorId: `existing-profile-b-${RUN}`,
    browserKeyPublicKey: `existing-profile-b-${RUN}`,
  };
  const intel = { asn: null, country: null, vpn: false, proxy: false, tor: false, hosting: false, anonymous: false, providerRisk: null };
  const resolve = (account: Account, evidenceRaw: unknown) => resolveOrCreateDevice({
    collections, config, evidenceRaw, ip: null, intel,
    ownerUserId: account.userId, correlationId: randomUUID(),
  });
  const firstDevice = await resolve(a, evidenceA);
  const secondDevice = await resolve(b, evidenceB);
  assert.notEqual(firstDevice.device.publicId, secondDevice.device.publicId);
  const match = matchDeviceFeatures(toCandidate(firstDevice.device), observedFeatures(config.encryptionKey, normalizeSignals(sanitizeEvidence(evidenceB))), config.encryptionKey);
  assert.equal(decideClusterMatch(match, config.lmdg.highConfidenceThreshold, config.lmdg.ambiguousThreshold), "ambiguous");
  // Both profiles have mined here before, as in the report. Network residency must not turn
  // the device rule into a read-before-write check with no transactional conflict.
  const ip = "10.18.18.18";
  const now = new Date();
  await collections.miningDevices.updateMany(
    { publicId: { $in: [firstDevice.device.publicId, secondDevice.device.publicId] } },
    { $set: {
      trustState: "established", establishedAt: now, admissionCount: config.lmdg.establishMinAdmissions,
      networkTrusts: [{ ipHash: ipHash(config.encryptionKey, ip)!, admissions: config.lmdg.establishMinAdmissions, proofs: 0, firstAt: now, lastAt: now }],
    } },
  );

  // Both requests finish assessment before either transaction starts. A barrier after the
  // transaction's fence would deadlock the winner waiting for the intentionally blocked loser.
  const startSession = client.startSession.bind(client);
  let arrivals = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolveGate) => { release = resolveGate; });
  const timeout = setTimeout(release, 10_000);
  const startSessionMock = t.mock.method(client, "startSession", (...args: Parameters<typeof startSession>) => {
    const session = startSession(...args);
    const transaction = session.withTransaction.bind(session);
    t.mock.method(session, "withTransaction", async (fn: (s: ClientSession) => Promise<unknown>, options: Parameters<typeof transaction>[1]) => {
      if (++arrivals === 2) release();
      await gate;
      return transaction(fn, options);
    });
    return session;
  });
  let results;
  try {
    results = await Promise.all([a, b].map((account, index) => call("POST", "/api/v1/mining/start", {
      token: account.accessToken, body: { device: index === 0 ? evidenceA : evidenceB }, ip,
    })));
  } finally {
    clearTimeout(timeout);
    startSessionMock.mock.restore();
  }
  t.diagnostic(`pre-transaction arrivals=${arrivals}; responses=${JSON.stringify(results.map(result => ({ status: result.status, error: result.body["error"] })))}`);
  assert.equal(arrivals, 2, "both starts finished assessment before either transaction began");
  const statuses = results.map((result) => result.status).sort();
  const activeSessions = await collections.miningSessions.countDocuments({ ownerUserId: { $in: [a.userId, b.userId] }, status: "active" });
  t.diagnostic(`simultaneous start results: ${JSON.stringify(statuses)}; active sessions: ${activeSessions}`);
  assert.deepEqual(statuses, [200, 409], `simultaneous start results: ${JSON.stringify(statuses)}`);
  assert.equal((results.find((result) => result.status === 409)!.body["error"] as { code: string }).code, "mining_device_already_in_use");
  assert.equal(activeSessions, 1);
  const winner = results[0]!.status === 200 ? a : b;
  const loser = winner === a ? b : a;
  assert.equal(await collections.miningDeviceLeases.countDocuments({ ownerUserId: loser.userId, status: "active" }), 0);
  const retried = await call("POST", "/api/v1/mining/start", {
    token: loser.accessToken, body: { device: loser === a ? evidenceA : evidenceB }, ip,
  });
  assert.equal(retried.status, 409, "the losing browser is also refused after the winner commits");
  assert.equal((await call("POST", "/api/v1/mining/stop", { token: winner.accessToken })).status, 200);
});

/**
 * The two tests below start a *deliberately edited* fixture, and an edited shape is not covered by the
 * fixture code's three-slot minimum distance: it can land within a slot or two of an unrelated test's
 * machine. That is not theoretical — while these tests were written, an earlier test's still-running
 * cycle answered the edited start with `mining_device_already_in_use` before the quota was ever
 * consulted (measured twice, and only in a full-suite run). Two things keep the correlation sweep
 * inside these tests' own machines: a platform label no other test uses, and a private address per
 * call, which resolves to no network identity at all — so no unrelated record can enter the sweep by
 * country or ASN. One address per call (not one shared) because the per-address rate limit applies to
 * whatever address a call arrives on.
 */
const SLOT_EDIT_PLATFORM = "Win32; LoumaSlots";
let slotEditIpSequence = 10;
const nextSlotEditIp = (): string => `172.31.32.${(slotEditIpSequence++ % 200) + 10}`;
const slotEditEvidence = (kind: Parameters<typeof deviceEvidence>[0], salt: string): Record<string, unknown> => ({
  ...deviceEvidence(kind, salt),
  platform: SLOT_EDIT_PLATFORM,
});

test("NEAR-CLONE QUOTA: an edited identity slot cannot buy a second allowance on one machine", async () => {
  // The band keeps a slot-edited fingerprint out of the machine while the matched cycle is live.
  // Once that cycle stops there is no live lease left to refuse on, so the *other* half of the
  // answer has to hold: the allowance itself. This is the sequential account-switching path — A mines
  // and stops, then B presents the same computer with two identity slots edited — and it must land on
  // the machine's spent 10h window, never on a fresh one keyed by the edited hardware. Measured
  // before the fix: 200, with a fresh device window beside A's spent one.
  const owner = await register("clone-quota-owner");
  const borrower = await register("clone-quota-borrower");
  const stranger = await register("clone-quota-stranger");
  const salt = "clone-quota";
  const first = await startWith(owner, "laptop-x", nextSlotEditIp(), salt, SLOT_EDIT_PLATFORM);
  assert.equal(first.status, 200, JSON.stringify(first.body));
  const sessionId = (first.body["session"] as { id: string }).id;
  // The window A opened stays open (its anchors are exactly where the start wrote them) and its
  // allowance is spent inside it: the segment is backdated to fill all ten hours and then stopped
  // through the API, so the cycle is closed and its leases are released.
  await collections.miningSessions.updateOne(
    { publicId: sessionId },
    { $set: { startedAt: new Date(Date.now() - 11 * 60 * 60 * 1000), endsAt: new Date(Date.now() - 60 * 60 * 1000) } },
  );
  const stopped = await call("POST", "/api/v1/mining/stop", { token: owner.accessToken });
  assert.equal(stopped.status, 200, JSON.stringify(stopped.body));
  // Keep corroborators stable here: this test measures quota inheritance, while cross-engine
  // omission is covered separately. Omitted corroborators can match another test's live fixture.
  const base = slotEditEvidence("laptop-x", salt);
  const edited = await call("POST", "/api/v1/mining/start", {
    token: borrower.accessToken,
    ip: nextSlotEditIp(),
    body: {
      device: {
        ...base,
        colorGamut: base["colorGamut"] === "p3" ? "srgb" : "p3",
        audioSampleRate: 48000,
        visitorId: `visitor-clone-quota-b-${RUN}`,
        browserKeyPublicKey: `key-clone-quota-b-${RUN}`,
      },
    },
  });
  assert.equal(edited.status, 409, `the machine's spent window must bind the edited slot: ${JSON.stringify(edited.body)}`);
  assert.equal((edited.body["error"] as { code: string }).code, "mining_quota_exhausted");
  assert.match((edited.body["error"] as { message: string }).message, /device/);
  assert.equal(await collections.miningSessions.countDocuments({ ownerUserId: borrower.userId, status: "active" }), 0);
  // C is close to B but outside A's near-clone band; it must receive its own allowance.
  const successor = await register("clone-quota-successor");
  const chained = await call("POST", "/api/v1/mining/start", {
    token: successor.accessToken,
    ip: nextSlotEditIp(),
    body: { device: {
      ...base,
      colorGamut: base["colorGamut"] === "p3" ? "srgb" : "p3",
      audioSampleRate: 48000,
      hdr: !base["hdr"],
      screenColorDepth: base["screenColorDepth"] === 24 ? 30 : 24,
      visitorId: `visitor-clone-quota-c-${RUN}`,
      browserKeyPublicKey: `key-clone-quota-c-${RUN}`,
    } },
  });
  assert.equal(chained.status, 200, JSON.stringify(chained.body));
  assert.equal((chained.body["session"] as { durationSeconds: number }).durationSeconds, MINING_DAILY_QUOTA_SECONDS);
  const clone = await collections.miningDevices.findOne({ browserKeyPublicKey: `key-clone-quota-c-${RUN}` });
  assert.ok(clone);
  assert.equal(clone.quotaAnchorHash ?? null, null, "C must not inherit A's quota by matching B alone");
  assert.equal((await call("POST", "/api/v1/mining/stop", { token: successor.accessToken })).status, 200);
  const cpuEdited = await register("clone-quota-cpu");
  const changedClass = await call("POST", "/api/v1/mining/start", {
    token: cpuEdited.accessToken,
    ip: nextSlotEditIp(),
    body: { device: {
      ...base,
      hardwareConcurrency: base["hardwareConcurrency"] === 32 ? 2 : 32,
      colorGamut: base["colorGamut"] === "p3" ? "srgb" : "p3",
      visitorId: `visitor-clone-quota-cpu-${RUN}`,
      browserKeyPublicKey: `key-clone-quota-cpu-${RUN}`,
    } },
  });
  assert.equal(changedClass.status, 200, JSON.stringify(changedClass.body));
  assert.equal((changedClass.body["session"] as { durationSeconds: number }).durationSeconds, MINING_DAILY_QUOTA_SECONDS);
  assert.equal((await call("POST", "/api/v1/mining/stop", { token: cpuEdited.accessToken })).status, 200);
  // A genuinely different machine keeps its own allowance: the limit follows the machine the
  // observation matched, never the caller's account or network.
  const other = await startWith(stranger, "laptop-y", nextSlotEditIp(), "clone-quota-other", SLOT_EDIT_PLATFORM);
  assert.equal(other.status, 200, JSON.stringify(other.body));
  // Stopped again: a scenario that mined leaves a live lease on this test's own machine namespace, and
  // the next scenario of it would be refused by that lease instead of being measured.
  assert.equal((await call("POST", "/api/v1/mining/stop", { token: stranger.accessToken })).status, 200);
});

/**
 * SLOT-EDIT BOUNDARY — where an edited fingerprint stops being the machine it copies, measured and
 * pinned so the boundary is a decision rather than a drift.
 *
 * `NEAR-CLONE QUOTA` above pins the plumbing end to end: an observation that moved two identity slots
 * is refused the machine's spent window with `mining_quota_exhausted`. This test pins the decision
 * underneath it, with the real matching functions and no HTTP — how far an edited observation has to
 * move, and what closing the rest of the gap would cost. Measured, `k` = engine-stable identity slots
 * edited out of six, on a `laptop-x-firefox-engine` observation against the `laptop-x` fixture it was
 * copied from (the score columns are that run's `score`/`machineScore`):
 *
 *   k=0  same       score 49  machine 100  6 agree / 0 moved  -> the machine: merged, one allowance
 *   k=1  same       score 47  machine  89  5 agree / 1 moved  -> the machine: merged, one allowance
 *   k=2  ambiguous  score 44  machine  67  4 agree / 2 moved  -> the near clone: allowance shared
 *   k=3  different  score 42  machine  56  3 agree / 3 moved  -> its own full 10h window
 *   k=4  different  score 32  machine  44  2 agree / 4 moved  -> its own full 10h window
 *   k=5  different  score 27  machine  11  1 agree / 5 moved  -> its own full 10h window
 *   k=6  different  score 25  machine   0  0 agree / 6 moved  -> its own full 10h window
 *
 * Three slots is not a missed threshold. It is the fixture code's own minimum distance between two
 * machines, so an unrelated machine of the same class differs from this fixture in exactly the same
 * three slots and scores the same; `FIXTURE ISOLATION` below counts how many pairs of *distinct*
 * simulated machines a rule that caught a three-slot edit would bind to one allowance. A machine that
 * edits three or more slots is therefore not closable by any similarity rule at all — what is bounded
 * instead is how many fresh allowances one network can mint, which `ENROLL BOUND` measures end to end.
 */
test("SLOT-EDIT BOUNDARY: the allowance follows the machine while its identity slots still agree", () => {
  const secret = config.encryptionKey;
  const salt = `slot-boundary-${RUN}`;
  const ownerRaw = buildFeatureMap(normalizeSignals(sanitizeEvidence({ ...deviceEvidence("laptop-x", salt), platform: SLOT_EDIT_PLATFORM })));
  const profile = learnFeatureProfile(null, digestFeatureMap(secret, ownerRaw));
  const ownerSnapshot = digestFeatureMap(secret, ownerRaw);
  // Every edit moves one of the six engine-stable identity slots: display gamut, capture-device count,
  // HDR support, panel depth, CPU class, touch class.
  const edits: ((base: Record<string, unknown>) => Record<string, unknown>)[] = [
    (base) => ({ colorGamut: base["colorGamut"] === "p3" ? "srgb" : "p3" }),
    (base) => ({ audioSampleRate: base["audioSampleRate"] === 48000 ? 96000 : 48000 }),
    (base) => ({ hdr: !base["hdr"] }),
    (base) => ({ screenColorDepth: base["screenColorDepth"] === 24 ? 40 : 24 }),
    (base) => ({ hardwareConcurrency: base["hardwareConcurrency"] === 2 ? 32 : 2 }),
    (base) => ({ maxTouchPoints: base["maxTouchPoints"] === 0 ? 10 : 0 }),
  ];
  // The pinned measurement. The shared device allowance follows a machine in exactly two ways: a
  // positive verdict merges the observation into the record, so it lands on that record's window, and
  // the machine-identity bands (the near clone, and the cross-engine pair whose identity slots agree)
  // leave the record enrolled beside the machine while it keeps the machine's allowance. Below four agreeing identity slots the guard has nothing left that says "one computer",
  // and the observation opens its own window — the residual `ENROLL BOUND` bounds.
  const expected = [
    { edited: 0, verdict: "same", shared: true },
    { edited: 1, verdict: "same", shared: true },
    { edited: 2, verdict: "ambiguous", shared: true },
    { edited: 3, verdict: "different", shared: false },
    { edited: 4, verdict: "different", shared: false },
    { edited: 5, verdict: "different", shared: false },
    { edited: 6, verdict: "different", shared: false },
  ] as const;
  const measured: string[] = [];
  for (const row of expected) {
    const base = slotEditEvidence("laptop-x-firefox-engine", salt);
    const evidence = { ...base, ...Object.assign({}, ...edits.slice(0, row.edited).map((edit) => edit(base))) };
    const raw = buildFeatureMap(normalizeSignals(sanitizeEvidence(evidence)));
    const match = matchDeviceFeatures(
      { featureProfile: profile, featureSnapshot: ownerSnapshot, browserKeyPublicKey: null, fingerprintVisitorIdHash: null },
      { digests: digestFeatureMap(secret, raw), raw, machine: {} },
      secret,
    );
    const verdict = decideClusterMatch(match, config.lmdg.highConfidenceThreshold, config.lmdg.ambiguousThreshold);
    const agreements = match.matchedMachine.filter((key) => CORE_MACHINE_FEATURE_SET.has(key)).length;
    const moves = match.drifted.filter((key) => CORE_MACHINE_FEATURE_SET.has(key)).length;
    // Mirroring the code, not a re-derivation of it: sharing the allowance is what the guard takes it
    // on (`isMachineIdentityMatch`), which is the near-clone band plus the cross-engine band whose
    // identity slots agree while only one engine's own corroborators do not.
    const shared = verdict === "same" || isMachineIdentityMatch(match, config.lmdg.ambiguousThreshold);
    measured.push(`${row.edited}:${verdict}/${match.score}/${match.machineScore}/${agreements}agree/${moves}moved/${shared ? "shared" : "fresh"}`);
    // The edit is what it claims to be: every edit moved one identity slot and left the rest agreeing.
    assert.equal(moves, row.edited, `the fixture edit moved the intended identity slots (${measured.join(" ")})`);
    assert.equal(agreements, 6 - row.edited, `the remaining identity slots still agree (${measured.join(" ")})`);
    assert.equal(verdict, row.verdict, `measured verdict at ${row.edited} edited slots (${measured.join(" ")})`);
    assert.equal(shared, row.shared, `measured allowance at ${row.edited} edited slots (${measured.join(" ")})`);
  }
  // The band, stated as the model states it: the near clone needs a majority of the identity slots
  // (four of six) and at least two of them moved. Both edges are load-bearing — the floor is why three
  // edited slots are outside it, and the move count is why an unedited machine is not inside it.
  assert.equal(MIN_CORE_IDENTITY_AGREEMENTS, 4);
  assert.equal(MIN_CORE_IDENTITY_MOVES, 2);
});

/**
 * ENROLL BOUND — the close for the residual `SLOT-EDIT BOUNDARY` measures.
 *
 * A fresh device allowance always costs a new machine identity: an existing machine returning after
 * its window closed opens the next window on its own anchor and spends nothing. A new machine identity
 * is budgeted per account *and* per network, so the per-network budget is the fixed step between one
 * address and the next fresh allowance — and it is the one control a client cannot edit away, because
 * it counts identities instead of comparing fingerprints.
 *
 * Measured end to end on one private address whose identity budget is spent first with the *configured*
 * limits: a machine that never enrolled there is refused `mining_device_enrollment_limited` (403),
 * while a machine that already enrolled there is admitted with a full fresh 10h window. So the bound
 * bites the multiplication and nothing else.
 */
test("ENROLL BOUND: an address that spent its identity budget refuses a new machine and still admits a returning one", async () => {
  const owner = await register("enroll-bound-owner");
  const newcomer = await register("enroll-bound-newcomer");
  // A private address: no network identity (no country, no ASN) and unique to this run, so the budget
  // spent here can never be another test's and the suite's own fixtures stay outside this sweep.
  const ip = `10.${(slotEditIpSequence++ % 200) + 10}.77.${(Date.now() % 200) + 20}`;
  const salt = `enroll-bound-${RUN}`;
  const first = await startWith(owner, "laptop-x", ip, salt);
  assert.equal(first.status, 200, JSON.stringify(first.body));
  const sessionId = (first.body["session"] as { id: string }).id;
  // A day later: the quota anchors move only forward, so the window this start opened has closed and
  // the next start on the same machine opens its next window on an identity that already exists.
  const dayAgo = new Date(Date.now() - 25 * 60 * 60 * 1000);
  await collections.miningSessions.updateOne(
    { publicId: sessionId },
    {
      $set: {
        startedAt: dayAgo,
        endsAt: new Date(dayAgo.getTime() + 60 * 60 * 1000),
        accountWindowStart: dayAgo,
        deviceWindowStart: dayAgo,
      },
    },
  );
  assert.equal((await call("POST", "/api/v1/mining/stop", { token: owner.accessToken })).status, 200);

  // Spend the address's identity budget with the real budget function and the configured limits. Each
  // charge uses its own account id so the per-account budget (three) cannot be what refuses: the
  // network is the scope under test.
  const limits = {
    maxNewClustersPerAccountPerDay: config.lmdg.maxNewClustersPerAccountPerDay,
    maxNewClustersPerNetworkPerHour: config.lmdg.maxNewClustersPerNetworkPerHour,
    maxNewClustersPerNetworkPerDay: config.lmdg.maxNewClustersPerNetworkPerDay,
  };
  const spentIpHash = ipHash(config.encryptionKey, ip);
  let allowed = 0;
  let limitHit: { scope: string; limit: number; count: number } | null = null;
  for (let attempt = 0; attempt <= limits.maxNewClustersPerNetworkPerHour + 1; attempt += 1) {
    const charge = await consumeEnrollmentBudget({
      collections,
      limits,
      ownerUserId: `enroll-bound-spend-${randomUUID()}`,
      ipHash: spentIpHash,
      identityKey: `enroll-bound-${RUN}-${attempt}`,
      nowMs: Date.now(),
    });
    if (charge.allowed) {
      allowed += 1;
      continue;
    }
    limitHit = charge.hit === null ? null : { scope: charge.hit.scope, limit: charge.hit.limit, count: charge.hit.count };
    break;
  }
  // One of the address's slots was spent by the machine that enrolled above, and the rollover start
  // spends nothing: the budget allows exactly its configured hour's worth and refuses the next.
  assert.equal(allowed, limits.maxNewClustersPerNetworkPerHour - 1, "the configured per-address hour budget is the binding bound");
  assert.equal(limitHit?.scope, "network");
  assert.equal(limitHit?.limit, limits.maxNewClustersPerNetworkPerHour);
  assert.equal(limitHit?.count, limits.maxNewClustersPerNetworkPerHour + 1);

  // A machine that never enrolled on this address cannot be given an identity at all.
  const refused = await startWith(newcomer, "laptop-y", ip, `${salt}-new`);
  assert.equal(refused.status, 403, JSON.stringify(refused.body));
  assert.equal((refused.body["error"] as { code?: string } | null)?.code, "mining_device_enrollment_limited");

  // The returning machine is untouched: its identity exists, the budget is never consulted, and it
  // gets its next window — which is the whole reason the bound sits on the identity rather than on the
  // machine, which no similarity rule can name any more.
  const returning = await startWith(owner, "laptop-x", ip, salt);
  assert.equal(returning.status, 200, JSON.stringify(returning.body));
  assert.equal((returning.body["session"] as { durationSeconds?: number } | null)?.durationSeconds, MINING_DAILY_QUOTA_SECONDS);
  assert.equal((await call("POST", "/api/v1/mining/stop", { token: owner.accessToken })).status, 200);
});

test("FIXTURE ISOLATION: no two simulated machines correlate into one", () => {
  // The suite's synthetic machines must stay outside each other's same/ambiguous/near-clone
  // verdicts, or a later test inherits an earlier test's live lease and fails on its own fixtures.
  // This recomputes the real comparison for 64 fixture indices with the real matching functions.
  const secret = config.encryptionKey;
  const fixtures = Array.from({ length: 64 }, (_, index) => {
    const raw = buildFeatureMap(normalizeSignals(sanitizeEvidence(machineShapeAtIndex(index))));
    return { index, digests: digestFeatureMap(secret, raw), raw };
  });
  const problems: string[] = [];
  // The separation must hold for the *allowance* as well as for the verdict: the near-clone band lets
  // a record that was enrolled beside a machine keep that machine's 10h window, so a fixture pair
  // inside the band would spend a neighbour's window in whichever test mined first. Measured: zero.
  // And the cost of the only rule that would close a three-slot edit instead — bind the allowance
  // whenever the machine class is intact and at least three identity slots still agree — is counted
  // here too, because that count is why the boundary sits at four (see SLOT-EDIT BOUNDARY above).
  let quotaBandPairs = 0;
  let widenedPairs = 0;
  let pairs = 0;
  const bandCount = (match: ReturnType<typeof matchDeviceFeatures>): void => {
    const agreements = match.matchedMachine.filter((key) => CORE_MACHINE_FEATURE_SET.has(key)).length;
    const moves = match.drifted.filter((key) => CORE_MACHINE_FEATURE_SET.has(key)).length;
    if (isNearCloneMatch(match)) quotaBandPairs += 1;
    if (match.classDrifted.length === 0 && agreements >= 3 && moves >= 3) widenedPairs += 1;
  };
  for (let i = 0; i < fixtures.length; i += 1) {
    const profile = learnFeatureProfile(null, fixtures[i]!.digests);
    for (let j = i + 1; j < fixtures.length; j += 1) {
      const match = matchDeviceFeatures(
        { featureProfile: profile, featureSnapshot: fixtures[i]!.digests, browserKeyPublicKey: null, fingerprintVisitorIdHash: null },
        { digests: fixtures[j]!.digests, raw: fixtures[j]!.raw, machine: {} },
        secret,
      );
      pairs += 1;
      bandCount(match);
      const verdict = decideClusterMatch(match, config.lmdg.highConfidenceThreshold, config.lmdg.ambiguousThreshold);
      if (verdict !== "different") problems.push(`fixture ${i} vs ${j}: ${verdict} (score ${match.score}, machine ${match.machineScore})`);
    }
  }
  // The same isolation must hold for the *variants* every test actually sends. A kind may pin its
  // machine's description (a Mac user agent, a second monitor), but the compared slots must stay
  // index-driven: two salts are two machines, whatever kinds they are built from. This is the check
  // the pinned `laptop-y` slot failed — the near-clone verdict appeared only between two variant
  // fixtures, which the pristine-only sweep above could not see.
  // The certificate code holds 90 distinct machines. A suite that quietly grew past that would wrap
  // the index and hand two tests the same machine — the exact collision this test exists to catch,
  // but one the pairs below cannot see if the wrapped indices are not both in the sweep. Fail here,
  // with the reason, before that can happen: add another data slot or raise the depth alphabet.
  assert.ok(machineIndexBySalt.size + 40 <= 90, `the fixture identity code holds 90 machines; ${machineIndexBySalt.size} are already assigned, and this sweep needs 40 more`);
  const kinds = ["laptop-x", "laptop-y", "laptop-x-firefox", "laptop-x-cleared", "laptop-x-vpn", "laptop-x-second-browser", "laptop-x-firefox-engine"] as const;
  const variants = kinds.flatMap((kind) =>
    Array.from({ length: 40 }, (_, slot) => {
      const salt = `isolation-${slot}`;
      const raw = buildFeatureMap(normalizeSignals(sanitizeEvidence(deviceEvidence(kind, salt))));
      return { kind, salt, digests: digestFeatureMap(secret, raw), raw };
    }),
  );
  for (let i = 0; i < variants.length; i += 1) {
    const profile = learnFeatureProfile(null, variants[i]!.digests);
    for (let j = i + 1; j < variants.length; j += 1) {
      // One salt is one machine, by design: the same-machine browser variants share it.
      if (variants[i]!.salt === variants[j]!.salt) continue;
      const match = matchDeviceFeatures(
        { featureProfile: profile, featureSnapshot: variants[i]!.digests, browserKeyPublicKey: null, fingerprintVisitorIdHash: null },
        { digests: variants[j]!.digests, raw: variants[j]!.raw, machine: {} },
        secret,
      );
      pairs += 1;
      bandCount(match);
      const verdict = decideClusterMatch(match, config.lmdg.highConfidenceThreshold, config.lmdg.ambiguousThreshold);
      if (verdict !== "different") problems.push(`variant ${variants[i]!.kind}/${variants[i]!.salt} vs ${variants[j]!.kind}/${variants[j]!.salt}: ${verdict} (score ${match.score}, machine ${match.machineScore})`);
    }
  }
  assert.deepEqual(problems, [], `fixtures must not correlate: ${problems.slice(0, 5).join("; ")}`);
  // The allowance separation, and the measured price of widening it to catch a three-slot edit.
  assert.equal(quotaBandPairs, 0, `${quotaBandPairs} of ${pairs} fixture pairs would share one device allowance`);
  assert.ok(
    widenedPairs > 500,
    `a three-agreement band would bind ${widenedPairs} of ${pairs} distinct fixture pairs to one allowance — that is the measured reason the near-clone band needs a majority of the identity slots (see SLOT-EDIT BOUNDARY)`,
  );
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
  const resolve = (label: string, ip: string) => {
    usedIps.add(ip);
    return guard.resolveOrCreateDevice({
      collections,
      config,
      evidenceRaw: thinEvidence(label),
      ip,
      intel,
      ownerUserId: account.userId,
      correlationId: `enroll-a-${label}`,
    });
  };
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
    // The latest device network is not necessarily the winning start's network.
    lastIpHash: ipHash(config.encryptionKey, "10.20.20.21"),
    createdAt: now, updatedAt: now,
  } as never);
  await collections.miningDeviceObservations.insertOne({
    publicId: `transition-observation-${RUN}`, deviceId: devicePublicId,
    ownerUserId: account.userId, observedAt: now, ipHash: networkHash,
    asn: null, country: null, riskScore: 0, decision: "allow",
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
    labels.map((label, index) => {
      const probeIp = `10.8.8.${10 + index}`;
      usedIps.add(probeIp);
      return guard
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
          ip: probeIp,
          intel,
          ownerUserId: account.userId,
          correlationId: `enroll-d-${label}`,
        })
        .then(() => "created" as const)
        .catch((error: unknown) => (error as { code?: string }).code ?? "error");
    }),
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
    const refundIp = `10.8.9.${index + 1}`;
    usedIps.add(refundIp);
    const spent = await guard
      .resolveOrCreateDevice({
        collections,
        config,
        evidenceRaw: {
          browserKeyPublicKey: `browser-key-refund-${index}-${RUN}`,
          visitorId: `visitor-refund-${index}-${RUN}`,
          integrity: { webdriver: false, headlessHint: false, impossibleUaPlatform: false, missingCapabilities: false },
        },
        ip: refundIp,
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

/**
 * ONBOARD: a user who has never mined starts on a brand-new machine, and that machine is then closed
 * to every other account.
 *
 * The reported onboarding failure was "a user who never mined got blocked". The measured cause is
 * never the absence of history: a first-ever start enrolls the machine (owned by the caller,
 * `provisional`) and is admitted with a whole window ahead of it. What refuses a *different* account
 * afterwards is the machine lease — the property this test also pins, on that same machine, both
 * sequentially and racing, so the onboarding path can never become a way around the one-device rule.
 */
test("ONBOARD: a first-ever start is admitted, and the machine then belongs to one account", async () => {
  const accountA = await register("onboard-a");
  const accountB = await register("onboard-b");
  const accountC = await register("onboard-c");
  // Nothing about this account has ever been seen: no device row, no cycle, no lease.
  assert.equal(await collections.miningDevices.countDocuments({ enrollmentUserId: accountA.userId }), 0);
  assert.equal(await collections.miningSessions.countDocuments({ ownerUserId: accountA.userId }), 0);

  const first = await startWith(accountA, "laptop-x", undefined, "onboard");
  assert.equal(first.status, 200, `a brand-new account on a brand-new machine must mine: ${JSON.stringify(first.body)}`);
  const session = first.body["session"] as { status: string } | null;
  assert.ok(session, "the admitted start returns its cycle");
  assert.equal(session.status, "active");
  assert.equal(first.body["poolRequired"], false, "the account's pool membership is not in question");
  assert.equal((first.body["quota"] as { remainingSeconds: number }).remainingSeconds > 0, true, "a first-ever start has its whole window left");
  const enrolled = await collections.miningDevices.findOne({ enrollmentUserId: accountA.userId });
  assert.ok(enrolled, "the first start enrolled exactly the caller's machine");
  assert.equal(enrolled.trustState, "provisional", "a first-sight identity is never born trusted");
  assert.equal(enrolled.admissionCount, 1);

  // Two more accounts, one after the other and then together, on that same machine: refused, and no
  // second cycle exists.
  const sequential = await startWith(accountB, "laptop-x", undefined, "onboard");
  const [raceOne, raceTwo] = await Promise.all([
    startWith(accountB, "laptop-x", undefined, "onboard"),
    startWith(accountC, "laptop-x", undefined, "onboard"),
  ]);
  for (const refused of [sequential, raceOne, raceTwo]) {
    assert.equal(refused.status, 409, `another account cannot take the machine: ${JSON.stringify(refused.body)}`);
    assert.equal((refused.body["error"] as { code: string }).code, "mining_device_already_in_use");
  }
  const active = await collections.miningSessions.countDocuments({
    ownerUserId: { $in: [accountA.userId, accountB.userId, accountC.userId] },
    status: "active",
  });
  assert.equal(active, 1, "one machine holds one cycle, whichever account asked for it");
});

for (const racing of [false, true]) {
  test(`CROSS-POOL: same device in low and medium (${racing ? "racing" : "sequential"})`, async () => {
    const a = await register(`cross-pool-a-${racing}`);
    const b = await register(`cross-pool-b-${racing}`, "medium");
    const salt = `cross-pool-${racing}`;
    const start = (account: Account, kind: Parameters<typeof deviceEvidence>[0]) => call("POST", "/api/v1/mining/start", {
      token: account.accessToken, body: { device: deviceEvidence(kind, salt) },
    });
    const results = racing
      ? await Promise.all([start(a, "laptop-x"), start(b, "laptop-x-second-browser")])
      : [await start(a, "laptop-x"), await start(b, "laptop-x-second-browser")];
    assert.deepEqual(results.map((result) => result.status).sort(), [200, 409], JSON.stringify(results));
    const refused = results.find((result) => result.status === 409)!;
    assert.equal((refused.body["error"] as { code: string }).code, "mining_device_already_in_use");
    assert.equal(await collections.miningSessions.countDocuments({ ownerUserId: { $in: [a.userId, b.userId] }, status: "active" }), 1);
  });
}

test("CROSS-POOL ANCHOR: enrolled profiles sharing a machine cannot mine in separate pools after traits drift", async () => {
  const a = await register("cross-anchor-a");
  const b = await register("cross-anchor-b", "medium");
  const guard = await import("../modules/mining-device/service.js");
  const intel = { asn: null, country: null, vpn: false, proxy: false, tor: false, hosting: false, anonymous: false, providerRisk: null };
  const evidenceA = deviceEvidence("laptop-x", "cross-anchor-a");
  const evidenceB = deviceEvidence("laptop-y", "cross-anchor-b");
  const enroll = (account: Account, evidenceRaw: unknown) => guard.resolveOrCreateDevice({
    collections, config, ownerUserId: account.userId, correlationId: randomUUID(),
    evidenceRaw, ip: nextIp(), intel,
  });
  const root = await enroll(a, evidenceA);
  const profile = await enroll(b, evidenceB);
  assert.notEqual(root.device.publicId, profile.device.publicId);
  assert.ok(root.device.anchorHash);
  // Existing server-owned correlation survives subsequent browser-visible trait drift.
  await collections.miningDevices.updateOne({ publicId: profile.device.publicId }, { $set: { quotaAnchorHash: root.device.anchorHash } });
  const results = await Promise.all([
    call("POST", "/api/v1/mining/start", { token: a.accessToken, body: { device: evidenceA } }),
    call("POST", "/api/v1/mining/start", { token: b.accessToken, body: { device: evidenceB } }),
  ]);
  assert.deepEqual(results.map((result) => result.status).sort(), [200, 409], "one server-correlated machine has one active cycle across pools");
  const refused = results.find((result) => result.status === 409)!;
  assert.equal((refused.body["error"] as { code: string }).code, "mining_device_already_in_use");
  assert.equal(await collections.miningSessions.countDocuments({ ownerUserId: { $in: [a.userId, b.userId] }, status: "active" }), 1);
  const winnerIndex = results[0]!.status === 200 ? 0 : 1;
  const winner = winnerIndex === 0 ? a : b;
  const waiting = winnerIndex === 0 ? b : a;
  createdSessionIds.push((results[winnerIndex]!.body["session"] as { id: string }).id);
  assert.equal(await collections.miningDeviceLeases.countDocuments({ ownerUserId: waiting.userId, status: "active" }), 0);
  const stopped = await call("POST", "/api/v1/mining/stop", { token: winner.accessToken });
  assert.equal(stopped.status, 200, JSON.stringify(stopped.body));
  const resumed = await call("POST", "/api/v1/mining/start", {
    token: waiting.accessToken, body: { device: winnerIndex === 0 ? evidenceB : evidenceA },
  });
  assert.equal(resumed.status, 200, "stopping the winner frees the shared machine for the waiting account");
  createdSessionIds.push((resumed.body["session"] as { id: string }).id);
  assert.equal(await collections.miningSessions.countDocuments({ ownerUserId: { $in: [a.userId, b.userId] }, status: "active" }), 1);
});
