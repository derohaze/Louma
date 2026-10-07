import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { MongoServerError, ObjectId, type MongoClient } from "mongodb";
import { buildApp } from "../app.js";
import { loadConfig, type AppConfig } from "../config/env.js";
import { connectMongo } from "../infrastructure/mongodb/client.js";
import { ensureDatabaseIndexes } from "../infrastructure/mongodb/indexes.js";
import { getCollections, type Collections } from "../infrastructure/mongodb/collections.js";
import { disabledRedis } from "../infrastructure/redis/client.js";
import { isMiningTransaction, MONEY_SCALE } from "../shared/types.js";
import { reconcileLedger, TEST_FUNDING_CORRELATION_PREFIXES } from "../modules/ledger/reconciliation.js";
import { buildFeatureMap, decideClusterMatch, digestFeatureMap, learnFeatureProfile, matchDeviceFeatures } from "../modules/mining-device/identity.js";
import { normalizeSignals, sanitizeEvidence } from "../modules/mining-device/signals.js";

/**
 * Mining against the configured MongoDB cluster.
 *
 * The guarantees under test are the ones the product depends on: a fresh segment is at most 10
 * hours inside a 24h quota window, the rate is the server's and never the browser's, the reward
 * is a pure function of persisted state, and settlement credits the ledger exactly once no matter
 * how many times or how concurrently it is asked. Where a test needs time to have passed it moves
 * the stored window (both endpoints together, so the segment-length invariant holds) rather than
 * waiting.
 *
 * Run with `npm run test:integration:mining`. Every document the run creates is removed afterwards,
 * and the shared treasury is returned to the balance it had before the run.
 */

const PASSWORD = "SmokeTest1234";
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const DAY_SECONDS = 24 * 60 * 60;
// 10h daily quota per 24h window: fresh starts open a 10h segment, not a 24h cycle.
const QUOTA_SECONDS = 10 * 60 * 60;
const QUOTA_MS = QUOTA_SECONDS * 1000;

/**
 * Namespace and start time for one run of this file.
 *
 * A device lease lives for the full 24-hour cycle, so without a per-run namespace a second run's
 * "machine 0" would resolve to the first run's device and inherit its still-live lease — the suite
 * would then fail on its own leftovers instead of on the behaviour under test. The namespace plus
 * the accounts this run registered bound the cleanup: device records carry no owner on purpose, so
 * `after` matches them through this run's fixture namespace and its observations, never through a
 * bare creation-time window that could catch another suite's rows.
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
let treasuryDeltaMinor = 0;let requestIp = 0;
// A fresh address per request, in this suite's own range. The guard scopes *new-identity*
// admission to a network, so a recycled address would carry an earlier test's live lease into a
// later one (and into another suite sharing the database), making a test fail on its fixture
// rather than on the rule under test.
const nextIp = () => {
  const index = requestIp++;
  return `10.4.${Math.floor(index / 254) % 254}.${(index % 254) + 1}`;
};
let preauthCsrfTokenValue = "";
const csrfByAccessToken = new Map<string, string>();

interface Account {
  userId: string;
  email: string;
  accessToken: string;
  refreshCookie: string;
  walletId: string;
  ledgerAccountId: string;
  /** Index of the distinct simulated machine this account mines from. */
  machine: number;
}

let nextMachine = 0;

/**
 * Device evidence for one simulated machine.
 *
 * Mining requires device evidence while LMDG is enabled, and this suite needs several accounts
 * mining at the same time — so each account gets its own machine, derived from its index: a distinct
 * OS, screen class, CPU/memory class and rendering stack. Two accounts in one run must not look like
 * one device, or the guard would (correctly) refuse the second start.
 */
const WINDOWS_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const MAC_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";
const LINUX_UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

const MACHINE_RESOLUTIONS: [number, number, number][] = [
  [1366, 768, 1], [1440, 900, 2], [1600, 900, 1], [1728, 1117, 2], [1920, 1080, 1],
  [1920, 1200, 1.25], [2048, 1536, 2], [2560, 1080, 1], [2560, 1440, 1], [2560, 1600, 2],
  [2880, 1800, 2], [3840, 2160, 1.5],
];
const MACHINE_ZONES: [string, number][] = [
  ["Africa/Cairo", -180], ["Europe/London", 0], ["America/New_York", 300],
  ["Asia/Dubai", -240], ["Europe/Berlin", -120], ["Asia/Riyadh", -180],
];
const MACHINE_SYSTEMS = [
  { platform: "Win32", userAgent: WINDOWS_UA },
  { platform: "MacIntel", userAgent: MAC_UA },
  { platform: "Linux x86_64", userAgent: LINUX_UA },
];

function deviceEvidence(machine: number): Record<string, unknown> {
  // Each account mines from its own machine. The six engine-stable identity slots are a
  // certificate code, the same construction as the mining-device suite's fixtures: four data slots
  // carry a mixed-radix machine index — CPU class (5), touch class (3), display gamut (3), HDR (2)
  // — the panel colour depth is their weighted-sum certificate (nonzero for every change of any
  // one of them), and the audio device stays unique. Any two machines therefore differ in at least
  // three identity slots (capacity: 90 machines). The coarse pattern this replaces left pairs that
  // agreed on four slots and moved two — the guard's near-clone band — so a test could read its
  // neighbour's live lease and fail for the wrong reason (measured: `mining_device_already_in_use`
  // on the accrual and device-quota starts, which must succeed).
  const hardwareDigit = machine % 5;
  const touchDigit = Math.floor(machine / 5) % 3;
  const gamutDigit = Math.floor(machine / 15) % 3;
  const hdrDigit = Math.floor(machine / 45) % 2;
  const depthDigit = (hardwareDigit + 3 * touchDigit + 5 * gamutDigit + 7 * hdrDigit) % 8;
  const [width, height, pixelRatio] = MACHINE_RESOLUTIONS[machine % MACHINE_RESOLUTIONS.length]!;
  const [timezone, timezoneOffsetMinutes] = MACHINE_ZONES[machine % MACHINE_ZONES.length]!;
  const system = MACHINE_SYSTEMS[machine % MACHINE_SYSTEMS.length]!;
  return {
    visitorId: `visitor-machine-${RUN}-${machine}`,
    fingerprintConfidence: 0.95,
    fingerprintVersion: "v5",
    platform: system.platform,
    userAgent: system.userAgent,
    screenWidth: width,
    screenHeight: height,
    pixelRatio,
    timezone,
    timezoneOffsetMinutes,
    language: "en-US",
    hardwareConcurrency: [2, 4, 8, 16, 32][hardwareDigit]!,
    deviceMemory: [1, 2, 4, 8, 16, 32][machine % 6]!,
    maxTouchPoints: [0, 5, 10][touchDigit]!,
    // The GPU identity, its limits, its extensions and the audio device are part of the machine
    // identity the server derives, and they are what makes each simulated machine distinct for any
    // number of accounts: the screen/CPU/memory pattern repeats every 60 indices, and a collision
    // there would (correctly) refuse the second account's start.
    screenAvailWidth: width,
    screenAvailHeight: height - (machine % 5) * 8,
    // The machine key hashes only the engine-stable core (core count, touch class, audio device,
    // gamut, HDR, panel depth), and the coarse CPU/memory/screen pattern below repeats every twelve
    // entries — so a fixture that left the audio device at a constant 48 kHz and the panel at 24-bit
    // produced an identical core for two different machines (indices 2/11, 4/13, 9/18 all matched),
    // and the later account then inherited the earlier one's live lease. A unique negotiated rate and
    // a non-default panel depth make every simulated machine distinct by construction. Neither value
    // is what a plain desktop reports, which also keeps a fixture from colliding with a real machine.
    audioSampleRate: 22050 + machine * 750,
    screenColorDepth: [24, 30, 32, 36, 40, 48, 56, 64][depthDigit]!,
    webglVendor: `vendor-machine-${RUN}-${machine}`,
    webglRenderer: `renderer-machine-${RUN}-${machine}`,
    webglLimitsHash: `limits-machine-${RUN}-${machine}`,
    webglExtensionsHash: `extensions-machine-${RUN}-${machine}`,
    webgpuHash: `webgpu-machine-${RUN}-${machine}`,
    audioChannels: 2,
    hdr: hdrDigit === 1,
    webglHash: `webgl-machine-${RUN}-${machine}`,
    canvasHash: `canvas-machine-${RUN}-${machine}`,
    audioHash: `audio-machine-${RUN}-${machine}`,
    fontsHash: `fonts-machine-${RUN}-${machine}`,
    colorGamut: ["srgb", "p3", "rec2020"][gamutDigit]!,
    mediaAudioInputs: machine % 5,
    mediaVideoInputs: machine % 4,
    platformVersion: `${machine}.${machine % 7}.${machine % 5}`,
    browserKeyPublicKey: `browser-key-machine-${RUN}-${machine}`,
    integrity: { webdriver: false, headlessHint: false, impossibleUaPlatform: false, missingCapabilities: false },
  };
}

async function call(
  method: "GET" | "POST",
  url: string,
  options: { token?: string; cookie?: string; body?: unknown } = {},
): Promise<{ status: number; body: Record<string, unknown>; cookie: string }> {
  const headers: Record<string, string> = {};
  if (options.token) headers["authorization"] = `Bearer ${options.token}`;
  if (options.cookie) headers["cookie"] = options.cookie;
  if (method !== "GET") {
    const token = options.token ? csrfByAccessToken.get(options.token) : undefined;
    headers["x-csrf-token"] = token ?? preauthCsrfTokenValue;
  }
  const response = await app.inject({
    method,
    url,
    headers,
    remoteAddress: nextIp(),
    ...(options.body === undefined ? {} : { payload: options.body as Record<string, unknown> }),
  });
  const setCookie = response.headers["set-cookie"];
  const body = response.payload.length ? (response.json() as Record<string, unknown>) : {};
  if (typeof body["accessToken"] === "string" && typeof body["csrfToken"] === "string") {
    csrfByAccessToken.set(body["accessToken"], body["csrfToken"]);
  }
  return { status: response.statusCode, body, cookie: Array.isArray(setCookie) ? (setCookie[0] ?? "") : ((setCookie as string | undefined) ?? "") };
}

const FIXTURE_DEVICE_FILTER = { webglFingerprintHash: { $regex: /^webgl-(machine|laptop)/ } };

async function removeFixtureDevices(): Promise<void> {
  const devices = await collections.miningDevices
    // Only leftovers from earlier runs: rows created after this run started may belong to a suite
    // running concurrently against the same database and must never be touched here.
    .find({ ...FIXTURE_DEVICE_FILTER, firstSeenAt: { $lt: runStartedAt } }, { projection: { publicId: 1, deviceKeyHash: 1, machineKeyHash: 1 } })
    .toArray();
  if (devices.length === 0) return;
  // Every identity a lease can be keyed by: the machine key, the browser key, or an older record id.
  const leaseKeys = [
    ...new Set(
      devices.flatMap((device) => [device.publicId, device.deviceKeyHash, device.machineKeyHash]),
    ),
  ].filter((key): key is string => key !== null);
  await collections.miningDeviceLeases.deleteMany({ deviceClusterId: { $in: leaseKeys } });
  await collections.miningDevices.deleteMany({ publicId: { $in: devices.map((device) => device.publicId) } });
}

async function register(label: string): Promise<Account> {
  const email = `mining.${label}.${randomUUID()}@example.test`;
  const response = await call("POST", "/api/v1/auth/register", {
    body: { email, password: PASSWORD, displayName: `Mining ${label}`.slice(0, 32) },
  });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  const user = response.body["user"] as { id: string };
  const wallet = response.body["wallet"] as { id: string };
  createdUserIds.push(user.id);
  const account = await collections.ledgerAccounts.findOne({ walletId: wallet.id, accountType: "wallet" });
  assert.ok(account, "the wallet has a ledger account");
  createdWalletAccountIds.push(account.publicId);
  // No room on registration: a hold lasts only while a start or a cycle justifies it, so fixtures
  // take one where the test needs one (`startMiningOn` joins Low first).
  return {
    userId: user.id,
    email,
    accessToken: response.body["accessToken"] as string,
    refreshCookie: response.cookie.split(";")[0] ?? "",
    walletId: wallet.id,
    ledgerAccountId: account.publicId,
    machine: nextMachine++,
  };
}

interface MiningSession {
  id: string;
  status: string;
  cycleNumber: number;
  startedAt: string;
  endsAt: string;
  durationSeconds: number;
  rate: string;
  rateUnits: number;
  rateScale: number;
  accrued: string;
  accruedMinor: number;
  settled: string;
  settledMinor: number;
  totalAccrued: string;
  totalAccruedMinor: number;
  elapsedSeconds: number;
  remainingSeconds: number;
  canSettle: boolean;
}

async function miningState(account: Account) {
  const response = await call("GET", "/api/v1/mining/state", { token: account.accessToken });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  return response.body as {
    status: string;
    enabled: boolean;
    canStart: boolean;
    serverNow: string;
    session: MiningSession | null;
    poolId: string | null;
    poolRequired: boolean;
  };
}

async function startMining(account: Account) {
  return startMiningOn(account, account.machine);
}

/** Takes the Low room, which a start requires. Re-joining a held room is an idempotent no-op. */
async function joinLow(account: Account): Promise<void> {
  const response = await call("POST", "/api/v1/mining/pools/join", { token: account.accessToken, body: { poolId: "low" } });
  assert.equal(response.status, 200, JSON.stringify(response.body));
}

/**
 * Starts mining as `account` from an explicit simulated machine (a device), after taking a room:
 * a cycle only opens from inside one, and both a stop and a finished window release it.
 */
async function startMiningOn(account: Account, machine: number) {
  await joinLow(account);
  const response = await call("POST", "/api/v1/mining/start", {
    token: account.accessToken,
    body: { device: deviceEvidence(machine) },
  });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  const state = response.body as { status: string; session: MiningSession };
  createdSessionIds.push(state.session.id);
  return state;
}

/** Reserves a simulated machine index nobody has registered on, for cross-device tests. */
function freshMachine(): number {
  return nextMachine++;
}

/**
 * FIXTURE ISOLATION: the certificate code's guarantee, recomputed with the real matcher.
 *
 * Two distinct simulated machines must differ in at least three engine-stable identity slots, so no
 * pair may resolve to "same" or "ambiguous". Without this, a test whose machine landed in the
 * guard's one-moved or two-moved bands reads its neighbour's live lease and fails on the fixture
 * rather than on the rule under test (measured: the accrual and device-quota starts, refused with
 * `mining_device_already_in_use` before the certificate code replaced the coarse pattern).
 */
test("FIXTURE ISOLATION: distinct simulated machines never correlate into one", () => {
  const secret = config.encryptionKey;
  const fixtures = Array.from({ length: 90 }, (_, machine) => {
    const raw = buildFeatureMap(normalizeSignals(sanitizeEvidence(deviceEvidence(machine))));
    return { machine, digests: digestFeatureMap(secret, raw), raw };
  });
  const problems: string[] = [];
  for (let i = 0; i < fixtures.length; i += 1) {
    const profile = learnFeatureProfile(null, fixtures[i]!.digests);
    for (let j = i + 1; j < fixtures.length; j += 1) {
      const match = matchDeviceFeatures(
        { featureProfile: profile, featureSnapshot: fixtures[i]!.digests, browserKeyPublicKey: null, fingerprintVisitorIdHash: null },
        { digests: fixtures[j]!.digests, raw: fixtures[j]!.raw, machine: {} },
        secret,
      );
      const verdict = decideClusterMatch(match, config.lmdg.highConfidenceThreshold, config.lmdg.ambiguousThreshold);
      if (verdict !== "different") problems.push(`machine ${i} vs ${j}: ${verdict} (score ${match.score}, machine ${match.machineScore})`);
    }
  }
  assert.deepEqual(problems, [], `simulated machines must not correlate: ${problems.slice(0, 5).join("; ")}`);
});

async function settleMining(account: Account, body?: unknown) {
  const response = await call("POST", "/api/v1/mining/settle", { token: account.accessToken, ...(body === undefined ? {} : { body }) });
  if (response.status === 200 && response.body["session"]) {
    const session = response.body["session"] as MiningSession;
    if (!createdSessionIds.includes(session.id)) createdSessionIds.push(session.id);
  }
  return response;
}

async function balanceMinorOf(account: Account): Promise<number> {
  const response = await call("GET", "/api/v1/wallet", { token: account.accessToken });
  const balance = (response.body["wallet"] as { balance: string }).balance;
  const [whole = "0", fraction = ""] = balance.split(".");
  return Number(whole) * MONEY_SCALE + Number(fraction.padEnd(4, "0"));
}

async function ledgerDerivedMinor(ledgerAccountId: string): Promise<number> {
  const entries = await collections.ledgerEntries.find({ ledgerAccountId }).toArray();
  return entries.reduce((total, entry) => total + (entry.side === "credit" ? entry.amountMinor : -entry.amountMinor), 0);
}

/** Moves a stored cycle back by `elapsedMs`, keeping `endsAt - startedAt` exactly 24 hours. */
async function rewindCycle(sessionId: string, elapsedMs: number): Promise<void> {
  const session = await collections.miningSessions.findOne({ publicId: sessionId });
  assert.ok(session, "the cycle exists");
  await collections.miningSessions.updateOne(
    { publicId: sessionId },
    { $set: { startedAt: new Date(session.startedAt.getTime() - elapsedMs), endsAt: new Date(session.endsAt.getTime() - elapsedMs) } },
  );
}

/** The accrual the API must report, computed independently from the persisted integers. */
function expectedAccruedMinor(session: MiningSession, elapsedSeconds: number): number {
  const bounded = Math.max(0, Math.min(elapsedSeconds, session.durationSeconds));
  return Number((BigInt(session.rateUnits) * BigInt(MONEY_SCALE) * BigInt(bounded)) / (BigInt(session.rateScale) * 3600n));
}

/**
 * True when a settled total is exactly the accrual at some second within a few of the reported
 * elapsed one. A settlement commits on the server clock and its response is read a moment later, so
 * the read's elapsed second can be one or two ahead of the instant that was actually credited; the
 * point of the check is that the credited amount is an exact accrual, not an approximation of one.
 */
function settledMatchesRecentAccrual(session: MiningSession, settledMinor: number): boolean {
  for (let seconds = Math.max(0, session.elapsedSeconds - 5); seconds <= session.elapsedSeconds; seconds += 1) {
    if (expectedAccruedMinor(session, seconds) === settledMinor) return true;
  }
  return false;
}

async function trackSettlements(sessionId: string): Promise<void> {
  // The journal header is the settlement record (see ADR-003): one header per reward.
  const settlements = await collections.transactions.find({ type: "mining", miningSessionId: sessionId }).toArray();
  for (const settlement of settlements) {
    if (!createdTransactionIds.includes(settlement.publicId)) {
      createdTransactionIds.push(settlement.publicId);
      treasuryDeltaMinor += settlement.amountMinor;
    }
  }
}

before(async () => {
  config = loadConfig();
  const connection = await connectMongo(config, { serverSelectionTimeoutMS: 30_000, connectTimeoutMS: 20_000 });
  client = connection.client;
  collections = getCollections(connection.db);
  await ensureDatabaseIndexes(connection.db);
  // Fixture devices from an earlier run of this file (or of the LMDG suite): their leases live for a
  // full 24 hours and would correlate with this run's machines. Only test rows can match — a real
  // client reports a SHA-256 of its GPU string, never a `webgl-machine-*` label.
  await removeFixtureDevices();
  app = await buildApp({ config, collections, mongoClient: client, redis: disabledRedis(), logger: false });
  const csrf = await call("GET", "/api/v1/auth/csrf");
  assert.equal(csrf.status, 200, JSON.stringify(csrf.body));
  preauthCsrfTokenValue = csrf.body["csrfToken"] as string;
});

after(async () => {
  if (!collections) return;
  for (const sessionId of createdSessionIds) await trackSettlements(sessionId);
  for (const userId of createdUserIds) {
    await collections.miningSessions.deleteMany({ ownerUserId: userId });
    await collections.miningSettlements.deleteMany({ ownerUserId: userId });
    await collections.miningPoolMembers.deleteMany({ ownerUserId: userId });
    await collections.securityEvents.deleteMany({ ownerUserId: userId });
    await collections.sessions.deleteMany({ ownerUserId: userId });
    // Wallets and their owners go last, after the ledger accounts below: an interrupted run must
    // not leave a wallet account whose wallet is already gone (unreachable to cleanup and reported
    // as a projection mismatch by the next suite's reconciliation).
  }
  // Device identity and its leases, so a finished run leaves nothing that can refuse the next
  // one's starts. Device records deliberately carry no owner, so the rows this run created are
  // identified by what links to this run only: observations of the accounts this file registered
  // (a denied start still records an observation, so the observed set alone is not proof this run
  // created the device — the creation-time bound is what excludes a pre-existing device a fixture
  // merely resolved to), plus this run's fixture namespace (`RUN`). A bare creation-time window is
  // never used alone — it would also match devices another suite or user created mid-run against
  // the same database.
  const observedDeviceIds = (
    (await collections.miningDeviceObservations.distinct("deviceId", { ownerUserId: { $in: createdUserIds } }).catch(() => [] as unknown[])) as unknown[]
  ).filter((value): value is string => typeof value === "string");
  const devices = await collections.miningDevices
    .find(
      {
        $or: [
          { publicId: { $in: observedDeviceIds }, firstSeenAt: { $gte: runStartedAt } },
          {
            webglFingerprintHash: { $regex: new RegExp(`^webgl-(machine|laptop).*${RUN}`) },
            firstSeenAt: { $gte: runStartedAt },
          },
        ],
      },
      { projection: { publicId: 1 } },
    )
    .toArray();
  const deviceIds = devices.map((device) => device.publicId);
  if (deviceIds.length > 0) {
    await collections.miningDeviceLeases.deleteMany({ deviceClusterId: { $in: deviceIds } });
    await collections.miningDevices.deleteMany({ publicId: { $in: deviceIds } });
  }
  await collections.miningDeviceLeases.deleteMany({ ownerUserId: { $in: createdUserIds } });
  await collections.miningDeviceObservations.deleteMany({ ownerUserId: { $in: createdUserIds } });
  await collections.ledgerEntries.deleteMany({ transactionId: { $in: createdTransactionIds } });
  await collections.transactions.deleteMany({ publicId: { $in: createdTransactionIds } });
  await collections.ledgerEntries.deleteMany({ ledgerAccountId: { $in: createdWalletAccountIds } });
  await collections.ledgerAccounts.deleteMany({ publicId: { $in: createdWalletAccountIds } });
  if (treasuryDeltaMinor !== 0) {
    await collections.ledgerAccounts.updateOne({ accountType: "system_treasury", currency: "LMA" }, { $inc: { balanceMinor: -treasuryDeltaMinor } });
  }
  // Last, once every ledger account is gone: wallets and their owners.
  for (const userId of createdUserIds) {
    await collections.wallets.deleteMany({ ownerUserId: userId });
    await collections.users.deleteMany({ publicId: userId });
  }
  await app?.close();
  await client?.close();
});

test("mining requires a session", async () => {
  assert.equal((await call("GET", "/api/v1/mining/state")).status, 401);
  // An empty JSON body, not no body: the request schema is validated before the auth hook, so a
  // bodyless POST is refused as malformed (400) before it can be refused as unauthenticated.
  assert.equal((await call("POST", "/api/v1/mining/start", { body: {} })).status, 401);
});

test("mining is impossible without a pool: start is refused until the account joins one", async () => {
  // A fresh account that never joined: state reports the gate, start is refused.
  const email = `mining.nopool.${randomUUID()}@example.test`;
  const response = await call("POST", "/api/v1/auth/register", {
    body: { email, password: PASSWORD, displayName: "Mining nopool" },
  });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  const token = response.body["accessToken"] as string;
  createdUserIds.push((response.body["user"] as { id: string }).id);

  const pools = await call("GET", "/api/v1/mining/pools", { token });
  assert.equal(pools.status, 200, JSON.stringify(pools.body));
  assert.equal((pools.body as { poolId: string | null }).poolId, null);
  assert.equal(((pools.body as { pools: { id: string }[] }).pools ?? []).length, 2, "exactly two system pools");

  const state = await call("GET", "/api/v1/mining/state", { token });
  assert.equal(state.status, 200);
  assert.equal((state.body as { poolRequired: boolean }).poolRequired, true);
  assert.equal((state.body as { canStart: boolean }).canStart, false);

  const refused = await call("POST", "/api/v1/mining/start", { token, body: {} });
  assert.equal(refused.status, 409);
  assert.equal((refused.body["error"] as { code: string }).code, "mining_pool_required");

  // Joining opens the gate: the same account can now start.
  const joined = await call("POST", "/api/v1/mining/pools/join", { token, body: { poolId: "medium" } });
  assert.equal(joined.status, 200, JSON.stringify(joined.body));
  assert.equal((joined.body as { poolId: string }).poolId, "medium");
  const after = await call("GET", "/api/v1/mining/state", { token });
  assert.equal((after.body as { poolRequired: boolean }).poolRequired, false);
  assert.equal((after.body as { canStart: boolean }).canStart, true);

  // Unknown pools are refused, not created.
  const bogus = await call("POST", "/api/v1/mining/pools/join", { token, body: { poolId: "mega" } });
  assert.equal(bogus.status, 400);
});

test("stopping releases the room, and a running cycle owns it: no moving while mining", async () => {
  const account = await register("stop-releases");
  const started = await startMining(account);
  const held = await call("GET", "/api/v1/mining/pools", { token: account.accessToken });
  assert.equal((held.body as { poolId: string | null }).poolId, "low", "the room is held while the cycle runs");

  // A running cycle drew its rate from this room: it can neither be left nor swapped while it runs.
  const leaveWhileRunning = await call("POST", "/api/v1/mining/pools/leave", { token: account.accessToken });
  assert.equal(leaveWhileRunning.status, 409, JSON.stringify(leaveWhileRunning.body));
  assert.equal((leaveWhileRunning.body["error"] as { code: string }).code, "mining_cycle_active");
  const switchWhileRunning = await call("POST", "/api/v1/mining/pools/join", { token: account.accessToken, body: { poolId: "medium" } });
  assert.equal(switchWhileRunning.status, 409, JSON.stringify(switchWhileRunning.body));
  assert.equal((switchWhileRunning.body["error"] as { code: string }).code, "mining_cycle_active");

  await rewindCycle(started.session.id, HOUR_MS);
  const stopped = await call("POST", "/api/v1/mining/stop", { token: account.accessToken });
  assert.equal(stopped.status, 200, JSON.stringify(stopped.body));

  const after = await call("GET", "/api/v1/mining/pools", { token: account.accessToken });
  assert.equal((after.body as { poolId: string | null }).poolId, null, "the stop released the room with the cycle");
  assert.equal(
    ((after.body as { pools: { id: string; joined: boolean }[] }).pools ?? []).find((pool) => pool.id === "low")?.joined,
    false,
    "the room no longer counts the account as a miner",
  );
  const afterState = await miningState(account);
  assert.equal(afterState.poolRequired, true, "the state gate agrees: a room is required again");
  const refused = await call("POST", "/api/v1/mining/start", {
    token: account.accessToken,
    body: { device: deviceEvidence(account.machine) },
  });
  assert.equal(refused.status, 409, JSON.stringify(refused.body));
  assert.equal((refused.body["error"] as { code: string }).code, "mining_pool_required");

  // Taking the same room again is never throttled, so stop -> rejoin -> start stays the normal loop.
  await joinLow(account);
  const resumed = await startMining(account);
  assert.notEqual(resumed.session.id, started.session.id);
});

test("a finished cycle releases its room by itself: the deadline is the cycle's end", async () => {
  const account = await register("cycle-releases");
  const started = await startMining(account);
  // The window ends: the hold's deadline was the cycle's end, so the room is gone the moment the
  // cycle is. A plain read reports it — no job runs, and no write is needed to make it true. The
  // rewind is a test-only time machine, so it moves both: production never moves a cycle's window
  // without its hold, because the start wrote `expiresAt = endsAt`.
  await rewindCycle(started.session.id, DAY_MS + 60_000);
  const rewound = await collections.miningSessions.findOne({ publicId: started.session.id });
  assert.ok(rewound, "the cycle exists");
  await collections.miningPoolMembers.updateOne(
    { ownerUserId: account.userId },
    { $set: { expiresAt: rewound.endsAt } },
  );
  const state = await miningState(account);
  assert.equal(state.status, "completed");
  assert.equal(state.poolRequired, true, "a completed cycle is not a room");
  const pools = await call("GET", "/api/v1/mining/pools", { token: account.accessToken });
  assert.equal((pools.body as { poolId: string | null }).poolId, null);
  assert.equal((pools.body as { cycleActive: boolean }).cycleActive, false);
});

test("an expired hold cannot open a cycle, and a cycle's hold is exactly its window", async () => {
  const account = await register("expired-hold");
  await joinLow(account);
  // The join grace passes before anybody presses Start: the room is no longer the account's, so the
  // stale row can never open a cycle.
  await collections.miningPoolMembers.updateOne(
    { ownerUserId: account.userId },
    { $set: { expiresAt: new Date(Date.now() - 1000) } },
  );
  const refused = await call("POST", "/api/v1/mining/start", {
    token: account.accessToken,
    body: { device: deviceEvidence(account.machine) },
  });
  assert.equal(refused.status, 409, JSON.stringify(refused.body));
  assert.equal((refused.body["error"] as { code: string }).code, "mining_pool_required");

  const started = await startMining(account);
  assert.equal(started.session.status, "active");
  const row = await collections.miningPoolMembers.findOne({ ownerUserId: account.userId });
  assert.equal(row?.status, "held");
  assert.equal(
    row?.expiresAt?.getTime(),
    new Date(started.session.endsAt).getTime(),
    "starting extended the join grace to the cycle's end",
  );
});

test("a pool cap stored in mining_settings is enforced without a restart", async () => {
  // Idempotent start: a leaked row from an interrupted run must not fail this one.
  await collections.miningSettings.deleteOne({ key: "mining.pools.medium" });
  // The cap is sized from the room's live occupancy: leftover memberships from earlier
  // runs share this database, so an absolute cap of 1 could already be full. One seat
  // past the current headcount leaves exactly room for `first` and nobody else.
  const scout = await register("capscout");
  const before = await call("GET", "/api/v1/mining/pools", { token: scout.accessToken });
  assert.equal(before.status, 200, JSON.stringify(before.body));
  const mediumBefore = ((before.body as { pools: { id: string; activeMiners: number }[] }).pools ?? []).find((pool) => pool.id === "medium");
  assert.ok(mediumBefore, "the medium room is listed");
  const cap = mediumBefore.activeMiners + 1;
  await collections.miningSettings.insertOne({
    _id: new ObjectId(),
    key: "mining.pools.medium",
    value: { baseHashrate: 100, rewardMinBps: 7000, rewardMaxBps: 13000, maxMembers: cap },
    updatedAt: new Date(),
    updatedBy: "test",
  });
  try {
    const first = await register("capfirst");
    const moved = await call("POST", "/api/v1/mining/pools/join", { token: first.accessToken, body: { poolId: "medium" } });
    assert.equal(moved.status, 200, JSON.stringify(moved.body));

    const pools = await call("GET", "/api/v1/mining/pools", { token: first.accessToken });
    assert.equal(pools.status, 200, JSON.stringify(pools.body));
    const medium = ((pools.body as { pools: { id: string; maxMembers: number; full: boolean }[] }).pools ?? []).find((pool) => pool.id === "medium");
    assert.equal(medium?.maxMembers, cap, "the live cap comes from the collection, not the env");
    assert.equal(medium?.full, true);

    const second = await register("capsecond");
    const refused = await call("POST", "/api/v1/mining/pools/join", { token: second.accessToken, body: { poolId: "medium" } });
    assert.equal(refused.status, 409);
    assert.equal((refused.body["error"] as { code: string }).code, "mining_pool_full");
  } finally {
    await collections.miningSettings.deleteOne({ key: "mining.pools.medium" });
  }
});

test("start opens at most a 10-hour segment with a server-chosen rate inside the configured band", async () => {
  const account = await register("start");
  assert.equal((await miningState(account)).status, "idle", "a fresh account has no cycle");

  const requestedAt = Date.now();
  const started = await startMining(account);
  const session = started.session;
  assert.equal(session.status, "active");
  assert.equal(new Date(session.endsAt).getTime() - new Date(session.startedAt).getTime(), QUOTA_MS, "a fresh account gets the full 10h quota");
  assert.equal(session.durationSeconds, QUOTA_SECONDS);
  // "The segment just opened" is a fact about the stored start versus the server clock (both in the
  // payload), not about this process's wall clock: a fixed tolerance on `remainingSeconds` fails
  // whenever the round trip to the database exceeds it. Assert the window's own arithmetic — the
  // remaining time is derived from the stored start, never re-chosen — plus that this is a fresh
  // segment, still inside its 10-hour allowance.
  assert.ok(new Date(session.startedAt).getTime() >= requestedAt - 1000, "the segment opens at the server clock of this request");
  assert.equal(session.remainingSeconds, QUOTA_SECONDS - session.elapsedSeconds, "remaining time is the stored window minus the stored start");
  assert.ok(session.elapsedSeconds >= 0 && session.elapsedSeconds < QUOTA_SECONDS, "the fresh segment is inside its 10-hour allowance");
  assert.match(session.rate, /^\d+\.\d{6}$/);
  const rateUnits = Number(session.rate.replace(".", ""));
  // Fixtures join the Low pool (factor 0.85–1.15x) on top of the configured band.
  assert.ok(
    rateUnits >= Math.floor(config.mining.rate.minUnits * 0.85) && rateUnits <= Math.ceil(config.mining.rate.maxUnits * 1.15),
    "the drawn rate is the base band scaled by the pool factor",
  );
  assert.equal(session.accrued, "0.0000", "nothing has accrued yet");
  assert.ok(session.totalAccruedMinor > 0, "the segment still has a positive 10-hour ceiling");
  assert.ok(session.accruedMinor < session.totalAccruedMinor);
  assert.equal(started.session.canSettle, false);

  // A second start while the cycle runs is refused rather than silently replacing the window.
  const second = await call("POST", "/api/v1/mining/start", {
    token: account.accessToken,
    body: { device: deviceEvidence(account.machine) },
  });
  assert.equal(second.status, 409);
  assert.equal((second.body["error"] as { code: string }).code, "mining_cycle_active");
});

test("the rate and window are immutable for the life of the cycle, and identical on every device", async () => {
  const account = await register("immutable");
  const started = await startMining(account).then((state) => state.session);

  const again = (await miningState(account)).session;
  assert.ok(again);
  assert.equal(again.id, started.id);
  assert.equal(again.rate, started.rate, "a read never re-draws the rate");
  assert.equal(again.startedAt, started.startedAt);
  assert.equal(again.endsAt, started.endsAt);

  // A second sign-in (another device) reads the same canonical cycle from the server.
  const phone = await call("POST", "/api/v1/auth/login", { body: { email: account.email, password: PASSWORD } });
  assert.equal(phone.status, 200, JSON.stringify(phone.body));
  const onPhone = (await miningState({ ...account, accessToken: phone.body["accessToken"] as string })).session;
  assert.ok(onPhone);
  assert.equal(onPhone.id, started.id);
  assert.equal(onPhone.rate, started.rate);
  assert.equal(onPhone.startedAt, started.startedAt);
  assert.equal(onPhone.endsAt, started.endsAt);
});

test("rates differ between accounts rather than being a global constant", async () => {
  const rates = new Set<string>();
  for (let index = 0; index < 12; index += 1) {
    const account = await register(`rate-${index}`);
    rates.add((await startMining(account)).session.rate);
  }
  assert.ok(rates.size >= 3, `twelve accounts drew distinct per-cycle rates: ${[...rates].join(", ")}`);
});

test("the server reports the accrual from persisted state, and settlement posts it through the ledger", async () => {
  const account = await register("accrue");
  const started = await startMining(account);
  const before = await collections.ledgerEntries.countDocuments({ ledgerAccountId: account.ledgerAccountId });

  await rewindCycle(started.session.id, HOUR_MS);
  const hour = (await miningState(account)).session;
  assert.ok(hour);
  assert.equal(hour.status, "active");
  assert.ok(hour.elapsedSeconds >= 3600, "about an hour has elapsed");
  assert.equal(hour.accruedMinor, expectedAccruedMinor(hour, hour.elapsedSeconds), "the reported accrual matches the exact server arithmetic");
  assert.equal(hour.remainingSeconds, QUOTA_SECONDS - hour.elapsedSeconds);
  assert.ok(hour.accruedMinor > 0, "an hour of mining has produced a reward");

  const settled = await settleMining(account);
  assert.equal(settled.status, 200, JSON.stringify(settled.body));
  const afterSettle = settled.body["session"] as MiningSession;
  assert.ok(settledMatchesRecentAccrual(afterSettle, afterSettle.settledMinor), "the whole accrual reached the ledger as an exact amount");
  assert.equal(await balanceMinorOf(account), afterSettle.settledMinor, "the wallet balance is the settled reward");

  // The ledger still explains the balance, and the settlement wrote exactly two lines.
  assert.equal(await ledgerDerivedMinor(account.ledgerAccountId), afterSettle.settledMinor);
  // The wallet is credited exactly once; the balancing debit lands on the treasury, not on the
  // wallet, so this account's line count grows by one.
  const written = await collections.ledgerEntries.countDocuments({ ledgerAccountId: account.ledgerAccountId });
  assert.equal(written - before, 1, "one credit line for the wallet");
  const settlement = await collections.transactions.findOne({ type: "mining", miningSessionId: started.session.id });
  assert.ok(settlement);
  const lines = await collections.ledgerEntries.find({ transactionId: settlement.publicId }).toArray();
  assert.equal(lines.length, 2, "the settlement is one balanced two-line transaction");

  // A mining settlement is not a transfer: it must not appear in the customer's transfer history.
  const history = await call("GET", "/api/v1/transactions?limit=50", { token: account.accessToken });
  assert.equal(history.status, 200);
  assert.equal((history.body["transactions"] as unknown[]).length, 0, "mining never surfaces as a transfer");
});

test("exactly 10 hours: past the segment end pays nothing more", async () => {
  const account = await register("window");
  const started = await startMining(account);
  const cap = started.session.totalAccruedMinor;
  assert.ok(cap > 0, "the configured band pays a non-zero 10-hour reward");

  await rewindCycle(started.session.id, DAY_MS + 30 * DAY_MS);
  const expired = (await miningState(account)).session;
  assert.ok(expired);
  assert.equal(expired.status, "completed");
  assert.equal(expired.accruedMinor, cap, "a month past the segment is clamped to the 10-hour reward");
  assert.equal(expired.remainingSeconds, 0);

  await settleMining(account);
  assert.equal(await balanceMinorOf(account), cap);

  // Repeated, replayed settlement after the segment cannot credit a second time.
  const before = await collections.ledgerEntries.countDocuments({ ledgerAccountId: account.ledgerAccountId });
  for (let attempt = 0; attempt < 3; attempt += 1) await settleMining(account);
  assert.equal(await balanceMinorOf(account), cap, "no reward beyond the 10-hour total");
  assert.equal(await collections.ledgerEntries.countDocuments({ ledgerAccountId: account.ledgerAccountId }), before, "no further lines were written");

  // A closed 10h segment exhausts the window: the next start in the SAME window
  // is refused, and only the next 24h window opens fresh quota. The room is taken first: it was
  // released with the cycle, and the pool gate would otherwise answer before the quota does.
  await joinLow(account);
  const refused = await call("POST", "/api/v1/mining/start", {
    token: account.accessToken,
    body: { device: deviceEvidence(account.machine) },
  });
  assert.equal(refused.status, 409);
  assert.equal((refused.body["error"] as { code: string }).code, "mining_quota_exhausted");

  // Simulate the next window by moving the settled segment's anchors 25h back;
  // the new start anchors a fresh window and the old record is not reused.
  const past = new Date(Date.now() - 25 * HOUR_MS);
  await collections.miningSessions.updateMany(
    { ownerUserId: account.userId },
    { $set: { accountWindowStart: past, deviceWindowStart: past } },
  );
  const next = await startMining(account);
  assert.notEqual(next.session.id, started.session.id);
  assert.equal(next.session.cycleNumber, 2);
  assert.notEqual(next.session.startedAt, started.session.startedAt);
});

test("a partial settlement advances the cycle and a later one posts only the difference", async () => {
  const account = await register("partial");
  const started = await startMining(account);

  await rewindCycle(started.session.id, HOUR_MS);
  const first = (await settleMining(account)).body["session"] as MiningSession;
  assert.ok(first.settledMinor > 0);
  assert.equal(await balanceMinorOf(account), first.settledMinor);

  await rewindCycle(started.session.id, HOUR_MS);
  const second = (await settleMining(account)).body["session"] as MiningSession;
  assert.ok(second.settledMinor > first.settledMinor, "the second settle posted only the newly accrued difference");
  assert.ok(settledMatchesRecentAccrual(second, second.settledMinor), "the cumulative settled total is still an exact accrual");
  // The two settlements' sequences advance, so nothing was rewritten in place.
  const settlements = (await collections.transactions.find({ type: "mining", miningSessionId: started.session.id }).sort({ sequenceNumber: 1 }).toArray()).filter(isMiningTransaction);
  assert.deepEqual(settlements.map((row) => row.sequenceNumber), [1, 2]);
  assert.equal(await balanceMinorOf(account), second.settledMinor);
  assert.equal(await ledgerDerivedMinor(account.ledgerAccountId), second.settledMinor);
});

test("duplicate and concurrent settlement credit exactly once", async () => {
  const account = await register("concurrent");
  const started = await startMining(account);
  await rewindCycle(started.session.id, 2 * HOUR_MS);

  const responses = await Promise.all(Array.from({ length: 6 }, () => settleMining(account)));
  assert.ok(responses.every((response) => response.status === 200), `every settle is answered: ${JSON.stringify(responses.map((response) => response.status))}`);
  const session = responses[0]!.body["session"] as MiningSession;

  // There may be more than one settlement: a slow link can have a later request observe an extra
  // second's accrual and post that small difference. That is not a double credit — the guarantee is
  // that the total never exceeds what the window earned and that no accrual is posted twice, which
  // is what is asserted here. "Exactly one row" would be asserting the link's latency.
  const settlements = (await collections.transactions.find({ type: "mining", miningSessionId: started.session.id }).sort({ sequenceNumber: 1 }).toArray()).filter(isMiningTransaction);
  assert.ok(settlements.length >= 1, "the reward reached the ledger");
  assert.deepEqual(
    settlements.map((row) => row.sequenceNumber),
    Array.from({ length: settlements.length }, (_, index) => index + 1),
    "settlements take contiguous, unique sequence numbers — none was applied twice",
  );
  const credited = settlements.reduce((sum, row) => sum + row.amountMinor, 0);
  assert.equal(await balanceMinorOf(account), credited, "the wallet holds exactly the credited settlements");
  assert.equal(await ledgerDerivedMinor(account.ledgerAccountId), credited);
  assert.ok(credited <= expectedAccruedMinor(session, session.elapsedSeconds), "the credit never exceeds the true accrual");
  assert.ok(credited >= expectedAccruedMinor(session, Math.max(0, session.elapsedSeconds - 5)), "and it is not short of the accrual a few seconds ago");

  for (const row of settlements) {
    const lines = await collections.ledgerEntries.find({ transactionId: row.publicId }).toArray();
    assert.equal(lines.length, 2, "every settlement is a two-line transaction");
    const debits = lines.filter((line) => line.side === "debit").reduce((sum, line) => sum + line.amountMinor, 0);
    const credits = lines.filter((line) => line.side === "credit").reduce((sum, line) => sum + line.amountMinor, 0);
    assert.equal(debits, credits, "every settlement is balanced");
    assert.equal(debits, row.amountMinor);
  }
});

test("a client cannot forge a rate, a window, or an amount", async () => {
  const account = await register("tamper");
  const started = await startMining(account);
  await rewindCycle(started.session.id, HOUR_MS);
  const before = (await miningState(account)).session;
  assert.ok(before);

  // None of these are read by the server; the canonical numbers come from the stored cycle.
  const forged = await settleMining(account, {
    rate: "999.000000",
    accrued: "999.0000",
    startedAt: new Date(0).toISOString(),
    endsAt: new Date(Date.now() + 10 * DAY_MS).toISOString(),
    durationSeconds: 10 * DAY_SECONDS,
  });
  assert.equal(forged.status, 200, JSON.stringify(forged.body));
  const session = forged.body["session"] as MiningSession;
  assert.equal(session.id, started.session.id);
  assert.equal(session.rate, before.rate, "the rate is still the stored one");
  assert.equal(session.endsAt, before.endsAt, "the window was not extended");
  assert.equal(session.durationSeconds, QUOTA_SECONDS);
  assert.ok(session.accruedMinor <= before.totalAccruedMinor, "the reward cannot exceed the 10-hour total");
  assert.ok(settledMatchesRecentAccrual(session, session.settledMinor), "only the canonical reward was credited");
  assert.equal(await balanceMinorOf(account), session.settledMinor);
});

test("another account cannot see or touch a cycle that is not its own", async () => {
  const owner = await register("isolation-owner");
  const stranger = await register("isolation-stranger");
  const started = await startMining(owner);

  const strangerState = await miningState(stranger);
  assert.equal(strangerState.status, "idle", "a fresh account sees no cycle");

  const strangerSettle = await settleMining(stranger);
  assert.equal(strangerSettle.status, 200);
  assert.equal(strangerSettle.body["session"], null, "settling your own idle account touches nothing else");
  const ownerStillOwns = await collections.miningSessions.findOne({ publicId: started.session.id });
  assert.equal(ownerStillOwns?.ownerUserId, owner.userId, "the owner's cycle is untouched");
});

test("the database enforces one active cycle per account", async () => {
  const account = await register("unique");
  await startMining(account);
  await assert.rejects(
    () =>
      collections.miningSessions.insertOne({
        publicId: randomUUID(),
        ownerUserId: account.userId,
        walletId: account.walletId,
        ledgerAccountId: account.ledgerAccountId,
        status: "active",
        cycleNumber: 99,
        startedAt: new Date(),
        endsAt: new Date(Date.now() + DAY_MS),
        durationSeconds: DAY_SECONDS,
        rateUnits: 10_000,
        rateScale: 1_000_000,
        rateDecimals: 6,
        rate: "0.010000",
        rateUnit: "LMA/hour",
        settledMinor: 0,
        settlementSequence: 0,
        lastSettledAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as never),
    (error: unknown) => error instanceof MongoServerError && error.code === 11000,
  );
});

test("stop closes the active segment and resume continues from the remaining quota", async () => {
  const account = await register("stop-resume");
  const first = await startMining(account);
  assert.equal(first.session.durationSeconds, QUOTA_SECONDS);

  await rewindCycle(first.session.id, HOUR_MS);
  const stopped = await call("POST", "/api/v1/mining/stop", { token: account.accessToken });
  assert.equal(stopped.status, 200, JSON.stringify(stopped.body));
  const stoppedState = stopped.body as { status: string; quota: { consumedSeconds: number; remainingSeconds: number } };
  assert.ok(stoppedState.quota.consumedSeconds >= 3600, "one hour is consumed and never refunded");
  assert.ok(stoppedState.quota.remainingSeconds <= QUOTA_SECONDS - 3600, "remaining is quota minus consumed");

  // Resume is a new segment on the same anchors, capped to what remains.
  const resumed = await startMining(account);
  assert.notEqual(resumed.session.id, first.session.id);
  assert.ok(resumed.session.durationSeconds <= QUOTA_SECONDS - 3600, "resume only gets what remains");
  assert.ok(resumed.session.durationSeconds > 0);

  // Stop is idempotent: with no active segment it returns state without writing.
  await call("POST", "/api/v1/mining/stop", { token: account.accessToken });
  const idleStop = await call("POST", "/api/v1/mining/stop", { token: account.accessToken });
  assert.equal(idleStop.status, 200);
});

test("exhausting the 10h quota refuses the next start until the window resets", async () => {
  const account = await register("exhaust");
  const started = await startMining(account);
  // Consume the full 10h, then stop: the window is exhausted.
  await rewindCycle(started.session.id, QUOTA_MS);
  const stopped = await call("POST", "/api/v1/mining/stop", { token: account.accessToken });
  assert.equal(stopped.status, 200, JSON.stringify(stopped.body));
  // The stop released the room, so it is taken again before the start — the quota must be what
  // refuses this account, not the pool gate.
  await joinLow(account);
  const refused = await call("POST", "/api/v1/mining/start", {
    token: account.accessToken,
    body: { device: deviceEvidence(account.machine) },
  });
  assert.equal(refused.status, 409);
  assert.equal((refused.body["error"] as { code: string }).code, "mining_quota_exhausted");
});

test("cross-account device quota: A 1h + B 2h on X, then A is capped everywhere", async () => {
  const accountA = await register("quota-a");
  const accountB = await register("quota-b");
  const deviceX = accountA.machine;
  const deviceY = freshMachine();

  // A mines 1h on X and stops: A consumed 1h, X consumed 1h, nothing refunded.
  const aFirst = await startMiningOn(accountA, deviceX);
  assert.equal(aFirst.session.durationSeconds, QUOTA_SECONDS);
  await rewindCycle(aFirst.session.id, HOUR_MS);
  const aStopped = await call("POST", "/api/v1/mining/stop", { token: accountA.accessToken });
  assert.equal(aStopped.status, 200, JSON.stringify(aStopped.body));
  const aQuota = (aStopped.body as { quota: { consumedSeconds: number; remainingSeconds: number } }).quota;
  // The stop truncates the segment at the server clock, so the consumed second carries the round
  // trip between the start and the stop: an hour, never a second less. It is asserted as the exact
  // relationship the quota holds (consumed + remaining = one window), not as a literal that the
  // link's latency would decide.
  assert.ok(aQuota.consumedSeconds >= 3600 && aQuota.consumedSeconds < 3600 + 30, `one hour of mining is consumed: ${aQuota.consumedSeconds}`);
  assert.equal(aQuota.remainingSeconds, QUOTA_SECONDS - aQuota.consumedSeconds);

  // B starts on the SAME device X: the shared device quota leaves B exactly what A's hour left on
  // it, even though B's own account quota is a fresh 10h.
  const bFirst = await startMiningOn(accountB, deviceX);
  assert.equal(bFirst.session.durationSeconds, QUOTA_SECONDS - aQuota.consumedSeconds, "device X has what A left, shared across accounts");
  await rewindCycle(bFirst.session.id, 2 * HOUR_MS);
  const bStopped = await call("POST", "/api/v1/mining/stop", { token: accountB.accessToken });
  assert.equal(bStopped.status, 200, JSON.stringify(bStopped.body));
  const bQuota = (bStopped.body as { quota: { consumedSeconds: number; remainingSeconds: number } }).quota;
  assert.ok(bQuota.consumedSeconds >= 2 * 3600 && bQuota.consumedSeconds < 2 * 3600 + 30, `two hours of mining are consumed: ${bQuota.consumedSeconds}`);
  assert.equal(bQuota.remainingSeconds, QUOTA_SECONDS - bQuota.consumedSeconds);

  // A moves to a FRESH device Y: A's own account quota (what its first hour left) still binds, so
  // the segment is capped to it even though Y itself is untouched.
  const aOnY = await startMiningOn(accountA, deviceY);
  assert.equal(aOnY.session.durationSeconds, QUOTA_SECONDS - aQuota.consumedSeconds, "account quota follows across devices");

  // While A mines on Y, B cannot mine on Y at the same moment, and the rejected
  // attempt consumes no quota for B. B's room was released by its own stop, so it takes it again:
  // the device conflict is what this attempt must be measured against, not the pool gate.
  await joinLow(accountB);
  const bRace = await call("POST", "/api/v1/mining/start", {
    token: accountB.accessToken,
    body: { device: deviceEvidence(deviceY) },
  });
  assert.equal(bRace.status, 409);
  assert.equal((bRace.body["error"] as { code: string }).code, "mining_device_already_in_use");
  const bState = await miningState(accountB);
  assert.equal((bState as unknown as { quota: { consumedSeconds: number } }).quota.consumedSeconds, bQuota.consumedSeconds, "the rejected start consumed nothing");
  assert.equal((await miningState(accountA)).status, "active", "A remains the active miner on Y");

  // A mines 8h more on Y and stops: A consumed 9h total, 1h remains.
  await rewindCycle(aOnY.session.id, 8 * HOUR_MS);
  const aStopped2 = await call("POST", "/api/v1/mining/stop", { token: accountA.accessToken });
  assert.equal(aStopped2.status, 200, JSON.stringify(aStopped2.body));
  const aQuota2 = (aStopped2.body as { quota: { consumedSeconds: number; remainingSeconds: number } }).quota;
  assert.ok(
    aQuota2.consumedSeconds >= aQuota.consumedSeconds + 8 * 3600 && aQuota2.consumedSeconds < aQuota.consumedSeconds + 8 * 3600 + 30,
    `eight more hours are consumed on top of the first: ${aQuota2.consumedSeconds}`,
  );
  assert.equal(aQuota2.remainingSeconds, QUOTA_SECONDS - aQuota2.consumedSeconds);

  // The next segment for A is capped to exactly what the account has left, on any device — the
  // same remaining the stop just reported.
  const aLast = await startMiningOn(accountA, deviceY);
  assert.equal(aLast.session.durationSeconds, aQuota2.remainingSeconds);
});

// NOTE (environmental, 2026-10-07): on the shared dev database this test also sees four
// pre-existing `demo-funding-*` orphan lines from 24 Jul 2026 (two Gmail demo accounts).
// They are load-bearing history — the funded money moved onward, so deleting the 980M
// credit would drive its wallet projection to -800M. They must NOT be deleted, forged a
// journal header for, or added to TEST_FUNDING_CORRELATION_PREFIXES (the cleanup script
// would then eat real balances). A failure naming only those four entries is data, not
// mining code: the pool→start→settle→release→start loop is covered by the other tests
// in this file plus the pool-race suite.
test("the ledger remains reconciled after mining settles", async () => {
  const result = await reconcileLedger({ collections, mongoClient: client, options: { excludeCorrelationIdPrefixes: TEST_FUNDING_CORRELATION_PREFIXES } });
  assert.ok(result.ok, `ledger reconciliation must pass: ${JSON.stringify(result.issues)}`);
});
