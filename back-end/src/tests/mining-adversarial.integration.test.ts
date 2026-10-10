import { afterEach, beforeEach, test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { MongoClient, MongoServerError, ObjectId, type ClientSession } from "mongodb";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { loadConfig, type AppConfig } from "../config/env.js";
import { getCollections, type Collections } from "../infrastructure/mongodb/collections.js";
import { ensureDatabaseIndexes } from "../infrastructure/mongodb/indexes.js";
import { disabledRedis } from "../infrastructure/redis/client.js";
import { decideClusterMatch, ipHash, learnFeatureProfile, matchDeviceFeatures } from "../modules/mining-device/identity.js";
import { observedFeatures, resolveOrCreateDevice } from "../modules/mining-device/resolution.js";
import { normalizeSignals, sanitizeEvidence } from "../modules/mining-device/signals.js";
import { backfillMiningAdmissionWindows, beginMiningAdmission, endMiningAdmission, iterateMiningAdmissionCandidates, miningAdmissionCandidateFilter } from "../infrastructure/mongodb/mining-admission.js";
import { admissionEvidence } from "../modules/mining-device/candidate-evidence.js";
import { backfillMiningEvidence, evidenceCandidateFilter, planAdmissionEvidence, verifyMiningEvidence, EVIDENCE_INDEX } from "../infrastructure/mongodb/mining-evidence.js";

// Deliberately ignores application .env files. Only the isolated runner supplies this URI;
// every test creates and drops its own randomly named database, never an existing database.
const uri = process.env["MINING_AUDIT_URI"] ?? "";
assert.match(uri, /^mongodb:\/\/127\.0\.0\.1:\d+\/\?replicaSet=louma_audit$/, "Use the isolated mining audit runner");
let client: MongoClient;
let app: FastifyInstance;
let config: AppConfig;
let collections: Collections;
let database: string;
let csrf: string;
let ipSequence = 0;
interface Account { id: string; token: string; csrf: string }

beforeEach(async (context) => {
  database = `louma_mining_audit_${randomUUID().replaceAll("-", "")}`;
  config = loadConfig({
    NODE_ENV: "test", MONGODB_URI: uri, MONGODB_DATABASE: database,
    ACCESS_TOKEN_SECRET: randomBytes(32).toString("base64"),
    APP_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
    LMDG_RISK_MODE: "enforce", LMDG_NETWORK_LEASE_LOCK: "true",
    LMDG_IDENTITY_MODE: "strict",
    LMDG_TEST_LEGACY_IDENTITY: context.name.startsWith("STRICT:") ? "false" : "true",
  });
  client = new MongoClient(uri, { monitorCommands: true });
  await client.connect();
  const hello = await client.db("admin").command({ hello: 1 });
  assert.ok(hello["setName"], "real MongoDB replica set is required for transactions");
  collections = getCollections(client.db(database));
  await ensureDatabaseIndexes(client.db(database));
  app = await buildApp({ config, collections, mongoClient: client, redis: disabledRedis(), logger: false });
  csrf = (await app.inject({ method: "GET", url: "/api/v1/auth/csrf" })).json().csrfToken as string;
});

afterEach(async () => {
  await app?.close();
  if (client) {
    assert.match(database, /^louma_mining_audit_[a-f0-9]{32}$/);
    await client.db(database).dropDatabase();
    await client.close();
  }
});

async function post(url: string, payload: Record<string, unknown>, account?: Account, ip?: string, api = app) {
  const response = await api.inject({
    method: "POST", url, payload,
    remoteAddress: ip ?? `10.41.${Math.floor(++ipSequence / 250)}.${ipSequence % 250 + 1}`,
    headers: { "x-csrf-token": account?.csrf ?? csrf, ...(account ? { authorization: `Bearer ${account.token}` } : {}) },
  });
  return { status: response.statusCode, body: response.json() as {
    user: { id: string }; accessToken: string; csrfToken: string; error: { code: string }; nonce: string; payload: string;
  } };
}

async function account(poolId: "low" | "medium" = "low"): Promise<Account> {
  const registered = await post("/api/v1/auth/register", {
    email: `audit.${randomUUID()}@example.test`, password: "AuditTest12345", displayName: "Mining audit",
  });
  assert.equal(registered.status, 201, JSON.stringify(registered.body));
  const result = { id: registered.body.user.id as string, token: registered.body.accessToken as string, csrf: registered.body.csrfToken as string };
  const joined = await post("/api/v1/mining/pools/join", { poolId }, result);
  assert.equal(joined.status, 200, JSON.stringify(joined.body));
  return result;
}

function evidence(edits: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    fingerprintConfidence: 0.95, fingerprintVersion: "v5", platform: "Win32",
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
    screenWidth: 1920, screenHeight: 1080, screenColorDepth: 24, pixelRatio: 1,
    timezone: "Africa/Cairo", timezoneOffsetMinutes: -180, language: "en-US",
    hardwareConcurrency: 8, deviceMemory: 8, maxTouchPoints: 0, colorGamut: "srgb", hdr: false,
    audioSampleRate: 44100, audioChannels: 2, mediaAudioInputs: 1, mediaVideoInputs: 1,
    webglHash: "webgl-x", canvasHash: "canvas-x", audioHash: "audio-x", fontsHash: "fonts-x",
    browserKeyPublicKey: null, visitorId: null,
    integrity: { webdriver: false, headlessHint: false, impossibleUaPlatform: false, missingCapabilities: false },
    ...edits,
  };
}

function editedEvidence(slots: 2 | 3): Record<string, unknown> {
  return evidence({
    audioSampleRate: 48000, audioChannels: 1, colorGamut: "p3", ...(slots === 3 ? { hdr: true } : {}),
    deviceMemory: null, mediaAudioInputs: null, mediaVideoInputs: null,
    screenWidth: 2560, screenHeight: 1440, timezone: "Europe/Berlin", timezoneOffsetMinutes: -120,
    webglHash: "webgl-second", canvasHash: "canvas-second", audioHash: "audio-second", fontsHash: "fonts-second",
  });
}

function unrelatedEvidence() {
  return evidence({
    hardwareConcurrency: 32, deviceMemory: 32, maxTouchPoints: 5, screenColorDepth: 30,
    colorGamut: "rec2020", hdr: true, audioSampleRate: 96000, audioChannels: 6,
    webglHash: "other-webgl", canvasHash: "other-canvas", audioHash: "other-audio", fontsHash: "other-fonts",
  });
}

async function seedIdleDevices(template: Awaited<ReturnType<typeof enroll>>["device"], count: number, raw: Record<string, unknown>) {
  const observed = observedFeatures(config.encryptionKey, normalizeSignals(sanitizeEvidence(raw)));
  for (let offset = 0; offset < count; offset += 100) {
    await collections.miningDevices.insertMany(Array.from({ length: Math.min(100, count - offset) }, () => {
      const id = randomUUID();
      return {
        ...template, _id: new ObjectId(), publicId: id, enrollmentUserId: randomUUID(),
        deviceKeyHash: `idle-key-${id}`, machineKeyHash: `idle-machine-${id}`, anchorHash: `idle-machine-${id}`,
        aliasHashes: [], quotaAnchorHash: null, browserKeyPublicKey: null, normalizedSignalHash: `idle-vector-${id}`,
        featureProfile: learnFeatureProfile(null, observed.digests), featureSnapshot: observed.digests,
        ...admissionEvidence({ featureProfile: learnFeatureProfile(null, observed.digests), featureSnapshot: observed.digests,
          browserKeyPublicKey: null, machineKeyHash: `idle-machine-${id}` }, config.encryptionKey),
        machineFeatureProfile: null, lastSeenAt: new Date(Date.now() + 60_000),
      };
    }));
  }
}

function verdict(a: Record<string, unknown>, b: Record<string, unknown>) {
  const observed = (raw: Record<string, unknown>) => observedFeatures(config.encryptionKey, normalizeSignals(sanitizeEvidence(raw)));
  const match = matchDeviceFeatures({
    featureProfile: learnFeatureProfile(null, observed(a).digests), featureSnapshot: null,
    browserKeyPublicKey: null, fingerprintVisitorIdHash: null,
  }, observed(b), config.encryptionKey);
  return decideClusterMatch(match, config.lmdg.highConfidenceThreshold, config.lmdg.ambiguousThreshold);
}

const start = (owner: Account, device: Record<string, unknown>, ip?: string, api = app) => post("/api/v1/mining/start", { device }, owner, ip, api);
const running = () => collections.miningSessions.countDocuments({ status: "active", endsAt: { $gt: new Date() } });
const enroll = (owner: Account, evidenceRaw: Record<string, unknown>, ip: string | null = null) => resolveOrCreateDevice({
  collections, config, ownerUserId: owner.id, correlationId: randomUUID(), evidenceRaw, ip,
  intel: { asn: null, country: null, vpn: false, proxy: false, tor: false, hosting: false, anonymous: false, providerRisk: null },
});

function gate(t: TestContext, label: string) {
  let release!: () => void;
  const promise = new Promise<void>((resolve, reject) => {
    release = resolve;
    const timer = setTimeout(() => reject(new Error(`timing barrier failed: ${label}`)), 15_000);
    t.after(() => clearTimeout(timer));
  });
  // Avoid an unhandled rejection while the counterpart is still doing real database work.
  void promise.catch(() => undefined);
  return { promise, release };
}

test("OPEN: three edited identity slots on two networks still produce two live cycles", async (t) => {
  const a = await account();
  const b = await account("medium");
  assert.equal(verdict(evidence(), editedEvidence(3)), "different");
  assert.equal((await start(a, evidence(), "10.42.0.1")).status, 200);
  const second = await start(b, editedEvidence(3), "10.42.0.2");
  assert.equal(second.status, 200, JSON.stringify(second.body));
  assert.equal(await running(), 2);
  const sessions = await collections.miningSessions.find({ status: "active" }).toArray();
  assert.equal(new Set(sessions.map(row => row.deviceQuotaKey)).size, 2);
  const leases = await collections.miningDeviceLeases.find({ status: "active" }).toArray();
  assert.equal(new Set(leases.map(row => row.deviceClusterId)).size, leases.length);
  t.diagnostic("OPEN identity-spoofing witness: two accounts, two pools, disjoint unique lease keys, two live MongoDB sessions");
});

test("CONTROL: a sequential two-slot edit is refused beside the running original", async () => {
  const a = await account();
  const b = await account();
  assert.equal(verdict(evidence(), editedEvidence(2)), "ambiguous");
  assert.equal((await start(a, evidence())).status, 200);
  const second = await start(b, editedEvidence(2));
  assert.equal(second.status, 409, JSON.stringify(second.body));
  assert.equal(second.body.error.code, "mining_device_already_in_use");
  assert.equal(await running(), 1);
});

test("KEY CONTINUITY: re-encoding one P-256 key cannot split two edited mining identities", async () => {
  const a = await account();
  const b = await account("medium");
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const jwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  const original = evidence({ browserKeyPublicKey: JSON.stringify(jwk) });
  assert.equal((await start(a, original)).status, 200);
  for (const key of [
    { y: jwk.y, x: jwk.x, crv: "P-256", kty: "EC", kid: "another-label" },
    { kty: "EC", crv: "P-256", x: `${jwk.x}=`, y: `${jwk.y}=` },
  ]) {
    const edited = { ...editedEvidence(3), browserKeyPublicKey: JSON.stringify(key) };
    const result = await start(b, edited);
    assert.equal(result.status, 409, JSON.stringify(result.body));
    assert.equal(result.body.error.code, "mining_device_already_in_use");
    assert.equal(await running(), 1);
  }
});

test("KEY RACE: pre-enrolled edited profiles sharing P-256 material have one concurrent owner", async (t) => {
  const a = await account();
  const b = await account("medium");
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const jwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  const first = evidence({ browserKeyPublicKey: JSON.stringify(jwk) });
  const second = { ...editedEvidence(3), browserKeyPublicKey: JSON.stringify({ y: jwk.y, x: jwk.x, crv: "P-256", kty: "EC" }) };
  const enrolled = [await enroll(a, first), await enroll(b, second)];
  assert.notEqual(enrolled[0]!.device.publicId, enrolled[1]!.device.publicId, "legacy records remain independently enrolled");
  const snapshots = gate(t, "both pending starts hold a MongoDB snapshot before either publishes a cycle");
  const findOne = collections.miningDevices.findOne.bind(collections.miningDevices);
  let arrived = 0;
  t.mock.method(collections.miningDevices, "findOne", async (...args: Parameters<typeof findOne>) => {
    const row = await findOne(...args);
    if (args[1]?.session && arrived < 2) {
      if (++arrived === 2) snapshots.release();
      await snapshots.promise;
    }
    return row;
  });
  const results = await Promise.all([start(a, first), start(b, second)]);
  assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
  assert.equal(await running(), 1);
  const loser = results[0]!.status === 409 ? a : b;
  assert.equal(await collections.miningDeviceLeases.countDocuments({ ownerUserId: loser.id, status: "active" }), 0);
});

test("LEASE WINDOWS: acquired peer identities remain discoverable after the peer request finishes", async () => {
  const owner = await account();
  const peer = await account("medium");
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const jwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  const first = { ...editedEvidence(3), browserKeyPublicKey: JSON.stringify(jwk) };
  const second = evidence({ browserKeyPublicKey: JSON.stringify({ y: jwk.y, x: jwk.x, crv: "P-256", kty: "EC" }) });
  const original = await enroll(owner, first);
  const other = await enroll(peer, second);
  assert.notEqual(original.device.publicId, other.device.publicId);
  // Seed a peer at the pending-request boundary. It never opens a cycle of its own.
  await collections.miningDevices.updateOne({ publicId: other.device.publicId }, { $set: { admissionPending: 1 } });
  assert.equal((await start(owner, first)).status, 200);
  const cycle = await collections.miningSessions.findOne({ ownerUserId: owner.id, status: "active" });
  assert.ok(cycle);
  assert.equal(await collections.miningDeviceLeases.countDocuments({ miningSessionId: cycle.publicId, deviceClusterId: other.device.publicId, status: "active" }), 1);
  await collections.miningDevices.updateOne({ publicId: other.device.publicId }, { $inc: { admissionPending: -1 } });
  assert.equal(await collections.miningDevices.countDocuments({
    publicId: other.device.publicId, ...miningAdmissionCandidateFilter(cycle.endsAt.getTime() - 1),
  }), 1, "the peer remains comparable for as long as the owner's lease covers its identities");
});

test("OPEN FALSE POSITIVE: distinct-key same-model fixtures still collide on the coarse machine core", async (t) => {
  const owners = [await account(), await account("medium")];
  const keys = await Promise.all(owners.map(async () => {
    const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    return JSON.stringify(await crypto.subtle.exportKey("jwk", pair.publicKey));
  }));
  assert.notEqual(keys[0], keys[1]);
  const first = evidence({ browserKeyPublicKey: keys[0] });
  const second = evidence({ browserKeyPublicKey: keys[1],
    canvasHash: "separate-machine-canvas", audioHash: "separate-machine-audio", fontsHash: "separate-machine-fonts",
    webglHash: "separate-machine-webgl", screenWidth: 2560, screenHeight: 1440, timezone: "Europe/Berlin",
  });
  assert.equal((await start(owners[0]!, first)).status, 200);
  const response = await start(owners[1]!, second);
  assert.equal(response.status, 409);
  assert.equal(response.body.error.code, "mining_device_already_in_use");
  assert.equal(await running(), 1);
  t.diagnostic("OPEN false-positive witness: synthetic separate-device labels, different keys/rendering, identical six coarse slots; not a measured real-user rate");
});

test("LEGACY WINDOWS: backfill retains running legacy records without erasing pending starts", async () => {
  const owner = await account();
  const contender = await account("medium");
  assert.equal((await start(owner, evidence())).status, 200);
  const device = await collections.miningDevices.findOne({ enrollmentUserId: owner.id });
  const cycle = await collections.miningSessions.findOne({ ownerUserId: owner.id, status: "active" });
  assert.ok(device && cycle);
  await collections.miningDevices.updateOne({ _id: device._id }, {
    $unset: { admissionLeaseEndsAt: "" }, $set: { admissionPending: 2, status: "blocked" },
  });
  assert.equal(await backfillMiningAdmissionWindows(client.db(database)), 1);
  const retained = await collections.miningDevices.findOne({ _id: device._id });
  assert.equal(retained?.admissionPending, 2);
  assert.ok(retained?.admissionLeaseEndsAt && retained.admissionLeaseEndsAt >= cycle.endsAt);
  assert.equal(await backfillMiningAdmissionWindows(client.db(database)), 0, "backfill is idempotent");
  assert.equal((await start(contender, editedEvidence(2))).status, 409);
});

test("PENDING CLEANUP: a lost release remains visible instead of expiring an in-flight contender", async (t) => {
  const owner = await account();
  const update = collections.miningDevices.updateOne.bind(collections.miningDevices);
  const failed = t.mock.method(collections.miningDevices, "updateOne", (...args: Parameters<typeof update>) => {
    if (!Array.isArray(args[1]) && args[1].$inc?.admissionPending === -1) throw new Error("injected reference cleanup outage");
    return update(...args);
  });
  assert.equal((await start(owner, evidence())).status, 200);
  failed.mock.restore();
  const row = await collections.miningDevices.findOne({ enrollmentUserId: owner.id });
  assert.ok(row?.admissionLeaseEndsAt);
  assert.equal(row.admissionPending, 1);
  assert.equal(await collections.miningDevices.countDocuments({
    publicId: row.publicId, ...miningAdmissionCandidateFilter(row.admissionLeaseEndsAt.getTime() + 86_400_000),
  }), 1, "elapsed time alone never hides an outstanding request");
});

test("IDLE DISCOVERY: transaction discovery retains legacy rows while assessment retains all history", async () => {
  const owner = await account();
  const idle = await enroll(owner, evidence());
  const candidateIds = async (session?: ClientSession) => {
    const ids: string[] = [];
    for await (const row of iterateMiningAdmissionCandidates(collections, session)) ids.push(row.publicId);
    return ids;
  };
  assert.deepEqual(await candidateIds(), [idle.device.publicId]);
  const session = client.startSession();
  try {
    await session.withTransaction(async () => assert.deepEqual(await candidateIds(session), []));
    await collections.miningDevices.updateOne({ publicId: idle.device.publicId }, { $unset: { admissionLeaseEndsAt: "" } });
    await session.withTransaction(async () => assert.deepEqual(await candidateIds(session), [idle.device.publicId]));
  } finally { await session.endSession(); }
});

test("HISTORY: an idle learned peer cannot escape previously correlated ownership", async (t) => {
  const owners = [await account(), await account("medium")];
  const profiles = [evidence(), editedEvidence(3)];
  const records = [await enroll(owners[0]!, profiles[0]!), await enroll(owners[1]!, profiles[1]!)];
  assert.notEqual(records[0]!.device.publicId, records[1]!.device.publicId);
  const observed = observedFeatures(config.encryptionKey, normalizeSignals(sanitizeEvidence(profiles[0])));
  // Seed valid bounded history, not a claim that this setup measures a history-poisoning attack.
  const history = learnFeatureProfile(records[1]!.device.featureProfile, observed.digests);
  await collections.miningDevices.updateOne({ publicId: records[1]!.device.publicId }, { $set: { featureProfile: history,
    ...admissionEvidence({ ...records[1]!.device, featureProfile: history }, config.encryptionKey) } });
  assert.equal((await start(owners[0]!, profiles[0]!)).status, 200);
  assert.equal((await start(owners[1]!, profiles[1]!)).status, 409);
  assert.equal(await running(), 1);
  t.diagnostic("learned history must contribute before committing lease keys, even when its record is idle");
});

test("ABUSE BUDGET: rotating IPs and API instances cannot multiply one account's start attempts", async () => {
  const owner = await account();
  const otherClient = new MongoClient(uri);
  await otherClient.connect();
  const otherApp = await buildApp({ config, collections: getCollections(otherClient.db(database)), mongoClient: otherClient, redis: disabledRedis(), logger: false });
  try {
    const results = await Promise.all(Array.from({ length: 24 }, (_, index) => start(owner, {}, undefined, index % 2 ? app : otherApp)));
    assert.equal(results.filter(result => result.status === 400).length, 12);
    assert.equal(results.filter(result => result.status === 429).length, 12);
    assert.equal(await collections.miningDevices.countDocuments(), 0);
    assert.equal(await running(), 0);
    // The limit belongs to the account, not its network or another customer's device.
    const honest = await account();
    assert.equal((await start(honest, evidence())).status, 200);
  } finally {
    await otherApp.close();
    await otherClient.close();
  }
});

test("ABUSE BUDGET: expired nonces cannot reset the account's challenge window", async () => {
  const owner = await account();
  const results = await Promise.all(Array.from({ length: 24 }, () => post("/api/v1/mining/device/challenge", { device: evidence() }, owner)));
  assert.equal(results.filter(result => result.status === 200).length, 20);
  assert.equal(results.filter(result => result.status === 429).length, 4);
  // Model the nonce TTL reaping rows before the hourly attempt window ends.
  await collections.miningDeviceNonces.deleteMany({ ownerUserId: owner.id });
  const again = await post("/api/v1/mining/device/challenge", { device: evidence() }, owner);
  assert.equal(again.status, 429, JSON.stringify(again.body));
  assert.equal(await collections.miningDeviceNonces.countDocuments(), 0);
});

test("ABUSE BUDGET: audit failures cannot permit unlimited invalid proofs", async (t) => {
  const owner = await account();
  const insert = collections.securityEvents.insertOne.bind(collections.securityEvents);
  t.mock.method(collections.securityEvents, "insertOne", (...args: Parameters<typeof insert>) => {
    if (args[0].eventType === "mining_device_challenge_failed") throw new Error("injected audit outage");
    return insert(...args);
  });
  const results = await Promise.all(Array.from({ length: 40 }, () => post("/api/v1/mining/device/prove", {
    nonce: randomBytes(32).toString("base64url"), signature: randomBytes(64).toString("base64url"), publicKeyJwk: {},
  }, owner)));
  assert.equal(results.filter(result => result.status === 401).length, 30);
  assert.equal(results.filter(result => result.status === 429).length, 10);
  assert.equal(await collections.miningDeviceNonces.countDocuments(), 0);
  assert.equal(await running(), 0);
});

test("ABUSE WINDOW: sliding expiry frees only expired attempts and storage remains bounded", async (t) => {
  const owner = await account();
  await Promise.all(Array.from({ length: 12 }, () => start(owner, {})));
  assert.equal((await start(owner, {})).status, 429);
  const id = `${owner.id}:start`;
  assert.equal((await collections.miningDeviceAttempts.findOne({ _id: id }))?.attempts.length, 12);
  // Advance one slot's age in the isolated fixture, leaving the other eleven recent.
  await collections.miningDeviceAttempts.updateOne({ _id: id }, [{ $set: {
    attempts: { $concatArrays: [[{ $subtract: ["$$NOW", 61_000] }], { $slice: ["$attempts", 1, 11] }] },
  } }]);
  const results = await Promise.all([start(owner, {}), start(owner, {})]);
  assert.deepEqual(results.map(result => result.status).sort(), [400, 429]);
  assert.equal((await collections.miningDeviceAttempts.findOne({ _id: id }))?.attempts.length, 12);
  await assert.rejects(collections.miningDeviceAttempts.updateOne({ _id: id }, {
    $set: { attempts: Array.from({ length: 31 }, () => new Date()) },
  }), (error: unknown) => error instanceof MongoServerError && error.code === 121);
  const plan = await collections.miningDeviceAttempts.find({ _id: id }).explain("executionStats");
  assert.equal(plan["executionStats"].totalKeysExamined, 1);
  assert.equal(plan["executionStats"].totalDocsExamined, 1);
  const indexes = await collections.miningDeviceAttempts.indexes();
  assert.ok(indexes.some(index => index.key["expiresAt"] === 1 && index.expireAfterSeconds === 0));
  t.diagnostic("attempt lookup: one key / one document; rolling window permits one replacement; validator rejects 31 timestamps");
});

test("ABUSE STORAGE FAILURE: a failed budget write cannot reach device enrollment or mining", async (t) => {
  const owner = await account();
  const failed = t.mock.method(collections.miningDeviceAttempts, "updateOne", async () => { throw new Error("injected budget outage"); });
  const refused = await start(owner, evidence());
  assert.equal(refused.status, 503, JSON.stringify(refused.body));
  assert.equal(await collections.miningDevices.countDocuments(), 0);
  assert.equal(await running(), 0);
  failed.mock.restore();
  assert.equal((await start(owner, evidence())).status, 200);
});

test("RACE: stale enrollment and one-sided admission must not open two near-clone cycles", async (t) => {
  const a = await account();
  const b = await account("medium");
  const scans = gate(t, "both resolution scans finished");
  const firstAdmission = gate(t, "first admission finished before second enrollment");
  const transactions = gate(t, "both starts ready to commit");
  let scanCount = 0;
  let transactionCount = 0;
  const find = collections.miningDevices.find.bind(collections.miningDevices);
  t.mock.method(collections.miningDevices, "find", (...args: Parameters<typeof find>) => {
    const cursor = find(...args);
    if (args[0]?.$or && scanCount < 2) {
      const toArray = cursor.toArray.bind(cursor);
      t.mock.method(cursor, "toArray", async () => {
        const result = await toArray();
        if (++scanCount === 2) scans.release();
        await scans.promise;
        return result;
      });
    }
    return cursor;
  });
  const insert = collections.miningDevices.insertOne.bind(collections.miningDevices);
  t.mock.method(collections.miningDevices, "insertOne", async (...args: Parameters<typeof insert>) => {
    if (args[0].enrollmentUserId === b.id) await firstAdmission.promise;
    return insert(...args);
  });
  const startSession = client.startSession.bind(client);
  t.mock.method(client, "startSession", (...args: Parameters<typeof startSession>) => {
    const session = startSession(...args);
    const transaction = session.withTransaction.bind(session);
    t.mock.method(session, "withTransaction", async (fn: (s: ClientSession) => Promise<unknown>, options: Parameters<typeof transaction>[1]) => {
      firstAdmission.release();
      if (++transactionCount === 2) transactions.release();
      await transactions.promise;
      return transaction(fn, options);
    });
    return session;
  });
  const results = await Promise.all([start(a, evidence()), start(b, editedEvidence(2))]);
  assert.equal(scanCount, 2, "both real resolution reads preceded either enrollment");
  assert.equal(transactionCount, 2, "both admissions passed before either transaction began");
  t.diagnostic(`stale-plan race statuses=${results.map(result => result.status)} active=${await running()}`);
  assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
  assert.equal(await running(), 1);
  const loser = results[0]!.status === 409 ? a : b;
  assert.equal(await collections.miningDeviceLeases.countDocuments({ ownerUserId: loser.id, status: "active" }), 0);
});

test("CONTROL: same identity concurrent starts across pools have one owner and no partial leases", async () => {
  const a = await account();
  const b = await account("medium");
  const results = await Promise.all([start(a, evidence()), start(b, evidence())]);
  assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
  assert.equal(await running(), 1);
  const loser = results[0]!.status === 409 ? a : b;
  assert.equal(await collections.miningDeviceLeases.countDocuments({ ownerUserId: loser.id, status: "active" }), 0);
  const indexes = await collections.miningDeviceLeases.indexes();
  assert.ok(indexes.some(index => index.unique && index.key["deviceClusterId"] === 1 && index.partialFilterExpression?.["status"] === "active"));
});

test("RACE: recency churn cannot erase a pair already compared by both admissions", async (t) => {
  const a = await account();
  const b = await account("medium");
  const first = await enroll(a, evidence());
  const otherEvidence = evidence({ hardwareConcurrency: 32 });
  const second = await enroll(b, otherEvidence);
  assert.equal(verdict(evidence(), otherEvidence), "ambiguous");
  assert.equal(second.quotaAnchor, null, "the fixture has no shared quota anchor hiding the pair-token bug");
  const ready = gate(t, "both admissions before recency churn");
  let arrivals = 0;
  const startSession = client.startSession.bind(client);
  t.mock.method(client, "startSession", (...args: Parameters<typeof startSession>) => {
    const session = startSession(...args);
    const transaction = session.withTransaction.bind(session);
    t.mock.method(session, "withTransaction", async (fn: (s: ClientSession) => Promise<unknown>, options: Parameters<typeof transaction>[1]) => {
      if (++arrivals === 2) {
        // Fixtures model unrelated enrollments becoming newer while both requests are in flight.
        await collections.miningDevices.insertMany(Array.from({ length: 55 }, (_, index) => ({
          ...first.device, _id: new ObjectId(), publicId: randomUUID(), deviceKeyHash: `churn-key-${index}`,
          machineKeyHash: `churn-machine-${index}`, anchorHash: `churn-machine-${index}`, aliasHashes: [],
          quotaAnchorHash: null, normalizedSignalHash: `churn-vector-${index}`, browserKeyPublicKey: null,
          featureProfile: null, featureSnapshot: null, machineFeatureProfile: null,
          ...admissionEvidence({ featureProfile: null, featureSnapshot: null, browserKeyPublicKey: null,
            machineKeyHash: `churn-machine-${index}` }, config.encryptionKey),
          lastSeenAt: new Date(Date.now() + 1000),
        })));
        ready.release();
      }
      await ready.promise;
      return transaction(fn, options);
    });
    return session;
  });
  const results = await Promise.all([start(a, evidence()), start(b, otherEvidence)]);
  t.diagnostic(`recency churn statuses=${results.map(result => result.status)} active=${await running()}`);
  assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
  assert.equal(await running(), 1);
});

test("RACE: a resident committing after newcomer assessment still enforces the network rule", async (t) => {
  const resident = await account();
  const newcomer = await account("medium");
  const ip = "10.43.0.1";
  const device = await enroll(resident, evidence(), ip);
  const now = new Date();
  await collections.miningDevices.updateOne({ publicId: device.device.publicId }, { $set: {
    trustState: "established", admissionCount: config.lmdg.establishMinAdmissions, establishedAt: now,
    networkTrusts: [{ ipHash: ipHash(config.encryptionKey, ip)!, admissions: config.lmdg.establishMinAdmissions, proofs: 0, firstAt: now, lastAt: now }],
  } });
  const assessed = gate(t, "newcomer passed network assessment");
  const committed = gate(t, "resident committed");
  let arrivals = 0;
  const startSession = client.startSession.bind(client);
  t.mock.method(client, "startSession", (...args: Parameters<typeof startSession>) => {
    const session = startSession(...args);
    const transaction = session.withTransaction.bind(session);
    t.mock.method(session, "withTransaction", async (fn: (s: ClientSession) => Promise<unknown>, options: Parameters<typeof transaction>[1]) => {
      if (++arrivals === 1) { assessed.release(); await committed.promise; }
      return transaction(fn, options);
    });
    return session;
  });
  const pending = start(newcomer, editedEvidence(3), ip);
  await Promise.race([assessed.promise, pending.then(result => { throw new Error(`newcomer never reached transaction: ${JSON.stringify(result)}`); })]);
  try { assert.equal((await start(resident, evidence(), ip)).status, 200); }
  finally { committed.release(); }
  const result = await pending;
  t.diagnostic(`resident/newcomer race status=${result.status} active=${await running()}`);
  assert.equal(result.status, 409, JSON.stringify(result.body));
  assert.equal(result.body.error.code, "mining_device_network_in_use");
  assert.equal(await running(), 1);
});

test("OPEN: a spoofed newcomer starting first can overlap an established resident on the same network", async (t) => {
  const resident = await account();
  const newcomer = await account("medium");
  const ip = "10.43.1.1";
  const device = await enroll(resident, evidence(), ip);
  const now = new Date();
  // Seed only the server-earned residency prerequisite, not either target cycle.
  await collections.miningDevices.updateOne({ publicId: device.device.publicId }, { $set: {
    trustState: "established", admissionCount: config.lmdg.establishMinAdmissions, establishedAt: now,
    networkTrusts: [{ ipHash: ipHash(config.encryptionKey, ip)!, admissions: config.lmdg.establishMinAdmissions, proofs: 0, firstAt: now, lastAt: now }],
  } });
  assert.equal(verdict(evidence(), editedEvidence(3)), "different");
  const first = await start(newcomer, editedEvidence(3), ip);
  assert.equal(first.status, 200, JSON.stringify(first.body));
  const second = await start(resident, evidence(), ip);
  assert.equal(second.status, 200, JSON.stringify(second.body));
  assert.equal(await running(), 2);
  assert.equal((await collections.miningDeviceLeases.distinct("ownerUserId", { status: "active" })).length, 2);
  t.diagnostic("OPEN network ordering: newcomer=200 then resident=200 on one IP; residency is seeded, both cycles use the real API");
});

test("CONTROL: distinct established devices on one network can still start concurrently", async () => {
  const a = await account();
  const b = await account("medium");
  const ip = "10.44.0.1";
  const devices = [await enroll(a, evidence(), ip), await enroll(b, editedEvidence(3), ip)];
  const now = new Date();
  await collections.miningDevices.updateMany({ publicId: { $in: devices.map(result => result.device.publicId) } }, { $set: {
    trustState: "established", admissionCount: config.lmdg.establishMinAdmissions, establishedAt: now,
    networkTrusts: [{ ipHash: ipHash(config.encryptionKey, ip)!, admissions: config.lmdg.establishMinAdmissions, proofs: 0, firstAt: now, lastAt: now }],
  } });
  const results = await Promise.all([start(a, evidence(), ip), start(b, editedEvidence(3), ip)]);
  assert.deepEqual(results.map(result => result.status), [200, 200], JSON.stringify(results));
  assert.equal(await running(), 2, "sharing a coordination fence does not merge devices or hold the network");
  assert.equal(await collections.miningAdmissionNetworks.countDocuments({ _id: ipHash(config.encryptionKey, ip)! }), 1);
});

test("ATOMICITY: MongoDB rejects invalid lease writes and rolls back the cycle and admission fence", async (t) => {
  const owner = await account();
  const insert = collections.miningDeviceLeases.insertMany.bind(collections.miningDeviceLeases);
  let mongoCode: number | undefined;
  const injected = t.mock.method(collections.miningDeviceLeases, "insertMany", async (...args: Parameters<typeof insert>) => {
    try {
      return await insert(args[0].map(row => ({ ...row, status: "invalid-for-validator" })) as never, args[1]);
    } catch (error) {
      if (error instanceof MongoServerError && typeof error.code === "number") mongoCode = error.code;
      throw error;
    }
  });
  const result = await start(owner, evidence(), "10.45.0.1");
  injected.mock.restore();
  assert.equal(result.status, 500);
  assert.equal(mongoCode, 121, "the actual MongoDB validator rejected the write");
  assert.equal(await collections.miningSessions.countDocuments({}), 0);
  assert.equal(await collections.miningDeviceLeases.countDocuments({}), 0);
  const device = await collections.miningDevices.findOne({ enrollmentUserId: owner.id });
  assert.equal(device?.admissionFence ?? false, false);
  assert.equal(device?.admissionPending, 0, "failed transactions release their pending reference");
  assert.equal(device?.admissionLeaseEndsAt?.getTime(), 0, "failed transactions publish no cycle window");
  const network = await collections.miningAdmissionNetworks.findOne({ _id: ipHash(config.encryptionKey, "10.45.0.1")! });
  assert.equal(network?.fence, false, "only preparation survives, never the transactional toggle");
  assert.equal((await start(owner, evidence(), "10.45.0.1")).status, 200, "rollback leaves the legitimate retry usable");
});

test("OPEN: separate self-generated keys both pass real P-256 proofs despite physical-device spoofing", async (t) => {
  config.lmdg.browserKeyRequired = true;
  const owners = [await account(), await account("medium")];
  for (let index = 0; index < owners.length; index++) {
    const owner = owners[index]!;
    const key = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    const jwk = await crypto.subtle.exportKey("jwk", key.publicKey);
    const device = { ...(index === 0 ? evidence() : editedEvidence(3)), browserKeyPublicKey: JSON.stringify(jwk) };
    const ip = `10.46.0.${index + 1}`;
    const unproved = await start(owner, device, ip);
    assert.equal(unproved.status, 409);
    assert.equal(unproved.body.error.code, "mining_device_challenge_required");
    const challenge = await post("/api/v1/mining/device/challenge", { device }, owner, ip);
    assert.equal(challenge.status, 200);
    const signature = Buffer.from(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key.privateKey, Buffer.from(challenge.body.payload))).toString("base64url");
    const proved = await post("/api/v1/mining/device/prove", { nonce: challenge.body.nonce, signature, publicKeyJwk: jwk, device }, owner, ip);
    assert.equal(proved.status, 200, JSON.stringify(proved.body));
    const started = await start(owner, device, ip);
    assert.equal(started.status, 200, JSON.stringify(started.body));
  }
  assert.equal(await running(), 2);
  t.diagnostic("OPEN: proof-of-possession authenticates two caller-generated keys; it does not attest to two physical computers");
});

test("CONCURRENCY: six accounts across two API instances and Mongo clients have exactly one device owner", async () => {
  const otherClient = new MongoClient(uri);
  await otherClient.connect();
  const otherApp = await buildApp({ config, collections: getCollections(otherClient.db(database)), mongoClient: otherClient, redis: disabledRedis(), logger: false });
  try {
    const owners: Account[] = [];
    for (let index = 0; index < 6; index++) owners.push(await account(index % 2 ? "medium" : "low"));
    const results = await Promise.all(owners.map((owner, index) => start(owner, evidence(), undefined, index % 2 ? app : otherApp)));
    assert.deepEqual(results.map(result => result.status).sort(), [200, 409, 409, 409, 409, 409]);
    assert.equal(await running(), 1);
    const winners = await collections.miningDeviceLeases.distinct("ownerUserId", { status: "active" });
    assert.equal(winners.length, 1);
  } finally {
    await otherApp.close();
    await otherClient.close();
  }
});

test("CONCURRENCY: overlapping Mongo snapshots cause a real write-conflict retry and one cycle", async (t) => {
  const a = await account();
  const b = await account("medium");
  const devices = [await enroll(a, evidence()), await enroll(b, evidence({ hardwareConcurrency: 32 }))];
  const ids = new Set(devices.map(device => device.device.publicId));
  const snapshots = gate(t, "both Mongo transactions read their device snapshot");
  let reads = 0;
  let attempts = 0;
  const findOne = collections.miningDevices.findOne.bind(collections.miningDevices);
  t.mock.method(collections.miningDevices, "findOne", async (...args: Parameters<typeof findOne>) => {
    const row = await findOne(...args);
    if (args[1]?.session?.inTransaction() && typeof args[0]?.publicId === "string" && ids.has(args[0].publicId)) {
      if (++reads === 2) snapshots.release();
      await snapshots.promise;
    }
    return row;
  });
  const startSession = client.startSession.bind(client);
  t.mock.method(client, "startSession", (...args: Parameters<typeof startSession>) => {
    const session = startSession(...args);
    const transaction = session.withTransaction.bind(session);
    t.mock.method(session, "withTransaction", (fn: (s: ClientSession) => Promise<unknown>, options: Parameters<typeof transaction>[1]) =>
      transaction(async s => { attempts++; return fn(s); }, options));
    return session;
  });
  const results = await Promise.all([start(a, evidence()), start(b, evidence({ hardwareConcurrency: 32 }))]);
  assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
  assert.equal(await running(), 1);
  assert.ok(attempts >= 3, "two overlapping snapshots required a real MongoDB transaction retry");
  t.diagnostic(`Mongo transaction callbacks=${attempts}; outcomes=${results.map(result => result.status)}`);
});

test("RETRY BOUND: transient failures at the first transaction read stop after five attempts", async (t) => {
  const owner = await account();
  const findOne = collections.miningSessions.findOne.bind(collections.miningSessions);
  let failures = 0;
  const injected = t.mock.method(collections.miningSessions, "findOne", async (...args: Parameters<typeof findOne>) => {
    const result = await findOne(...args);
    if (args[1]?.session?.inTransaction() && failures < 8) {
      failures++;
      // Inject only the transient error after a REAL snapshot read; retry/abort are the driver's.
      throw new MongoServerError({ message: "injected transient first-read failure", code: 112, errorLabels: ["TransientTransactionError"] });
    }
    return result;
  });
  const result = await start(owner, evidence());
  injected.mock.restore();
  t.diagnostic(`first-read failures=${failures}; status=${result.status}`);
  assert.equal(result.status, 503);
  assert.equal(result.body.error.code, "mining_start_busy");
  assert.equal(failures, 5);
  assert.equal(await running(), 0);
  assert.equal(await collections.miningDeviceLeases.countDocuments({ status: "active" }), 0);
  assert.equal((await start(owner, evidence())).status, 200, "a later healthy request remains usable");
});

test("SATURATION: newer live devices cannot hide an edited identity; unrelated devices still start", async (t) => {
  const a = await account();
  const b = await account("medium");
  const exact = await account();
  assert.equal((await start(a, evidence())).status, 200);
  const original = await collections.miningDevices.findOne({ enrollmentUserId: a.id });
  const cycle = await collections.miningSessions.findOne({ ownerUserId: a.id, status: "active" });
  const lease = await collections.miningDeviceLeases.findOne({ ownerUserId: a.id, status: "active" });
  assert.ok(original && cycle && lease);
  const other = unrelatedEvidence();
  assert.equal(verdict(other, evidence()), "different");
  assert.equal(verdict(other, editedEvidence(2)), "different");
  const observed = observedFeatures(config.encryptionKey, normalizeSignals(sanitizeEvidence(other)));
  const recent = new Date(Date.now() + 1000);
  // Populate the database boundary directly, not a claimed 70-account HTTP attack. Every row
  // passes the real validator/indexes and every filler lease references a real running cycle.
  // This isolates search completeness from the separate cost of obtaining this population.
  for (let index = 0; index < 70; index++) {
    const id = randomUUID();
    const owner = randomUUID();
    const sessionId = randomUUID();
    const keys = [id, `filler-machine-${id}`, `filler-browser-${id}`];
    await collections.miningDevices.insertOne({
      ...original, _id: new ObjectId(), publicId: id, enrollmentUserId: owner,
      deviceKeyHash: keys[2]!, machineKeyHash: keys[1]!, anchorHash: keys[1]!, quotaAnchorHash: null,
      aliasHashes: [], browserKeyPublicKey: null, normalizedSignalHash: `filler-vector-${id}`,
      featureProfile: learnFeatureProfile(null, observed.digests), featureSnapshot: observed.digests,
      ...admissionEvidence({ featureProfile: learnFeatureProfile(null, observed.digests), featureSnapshot: observed.digests,
        browserKeyPublicKey: null, machineKeyHash: keys[1]! }, config.encryptionKey),
      machineFeatureProfile: null, lastSeenAt: recent,
    });
    await collections.miningSessions.insertOne({
      ...cycle, _id: new ObjectId(), publicId: sessionId, ownerUserId: owner, deviceId: id, deviceQuotaKey: keys[1]!,
    });
    await collections.miningDeviceLeases.insertMany(keys.map(key => ({
      ...lease, _id: new ObjectId(), publicId: randomUUID(), ownerUserId: owner,
      deviceClusterId: key, deviceId: id, miningSessionId: sessionId, ipHash: null, leasedAt: recent,
    })));
  }
  const recentDevices = await collections.miningDevices.find({}).sort({ lastSeenAt: -1 }).limit(50).toArray();
  const recentLeases = await collections.miningDeviceLeases.find({ status: "active" }).sort({ leasedAt: -1 }).limit(200).toArray();
  assert.ok(recentDevices.every(row => row.publicId !== original.publicId));
  assert.ok(recentLeases.every(row => row.deviceId !== original.publicId));
  const started = performance.now();
  const edited = await start(b, editedEvidence(2));
  assert.equal(edited.status, 409, JSON.stringify(edited.body));
  assert.equal(edited.body.error.code, "mining_device_already_in_use");
  assert.equal(await collections.miningSessions.countDocuments({ ownerUserId: { $in: [a.id, b.id] }, status: "active" }), 1);
  const unchanged = await start(exact, evidence());
  assert.equal(unchanged.status, 409, JSON.stringify(unchanged.body));
  assert.equal(unchanged.body.error.code, "mining_device_already_in_use");
  const unrelated = await account("medium");
  assert.equal(verdict(other, editedEvidence(3)), "different");
  assert.equal((await start(unrelated, editedEvidence(3))).status, 200, "a complete scan must not deny because the population is large");
  t.diagnostic(`search-cap regression: 70 seeded live devices / 210 newer lease keys; edited=409, exact=409, unrelated=200; checks took ${(performance.now() - started).toFixed(1)} ms`);
});

test("SCALE: 5000 unrelated historical devices preserve admission and a hidden live legacy conflict", async (t) => {
  const owner = await account();
  const contender = await account("medium");
  const original = await enroll(owner, evidence());
  assert.equal(verdict(unrelatedEvidence(), evidence()), "different");
  assert.equal(verdict(unrelatedEvidence(), editedEvidence(2)), "different");
  await seedIdleDevices(original.device, 5000, unrelatedEvidence());
  const transactionMs: number[] = [];
  const startSession = client.startSession.bind(client);
  t.mock.method(client, "startSession", (...args: Parameters<typeof startSession>) => {
    const session = startSession(...args);
    const transaction = session.withTransaction.bind(session);
    t.mock.method(session, "withTransaction", (fn: (s: ClientSession) => Promise<unknown>, options: Parameters<typeof transaction>[1]) =>
      transaction(async s => {
        const before = performance.now();
        try { return await fn(s); }
        finally { transactionMs.push(performance.now() - before); }
      }, options));
    return session;
  });
  const before = performance.now();
  const admitted = await start(owner, evidence());
  const admissionMs = performance.now() - before;
  assert.equal(admitted.status, 200, JSON.stringify(admitted.body));
  // Older builds stored raw snapshots. A blocked record may still own a live cycle: neither
  // legacy storage nor status changes may hide that ownership from the complete scan.
  await collections.miningDevices.updateOne({ publicId: original.device.publicId }, { $set: {
    status: "blocked", featureProfile: null,
    featureSnapshot: observedFeatures(config.encryptionKey, normalizeSignals(sanitizeEvidence(evidence()))).raw,
  }, $unset: { admissionEvidenceVersion: "", admissionEvidenceTokens: "" } });
  const denied = await start(contender, editedEvidence(2));
  assert.equal(denied.status, 409, JSON.stringify(denied.body));
  assert.equal(await running(), 1);
  const scan = await collections.miningDevices.find({}).explain("executionStats");
  t.diagnostic(`5000 idle profiles: legitimate start=${admissionMs.toFixed(1)} ms; transaction callbacks=${transactionMs.map(ms => ms.toFixed(1))} ms; full-scan documents=${scan["executionStats"].totalDocsExamined}; hidden blocked/raw-snapshot conflict=409`);
});

test("INDEXED SCALE: transaction discovery is bounded beside 50000 idle profiles; assessment stays complete", async (t) => {
  const owner = await account();
  const original = await enroll(owner, evidence());
  await seedIdleDevices(original.device, 50_000, unrelatedEvidence());
  const find = collections.miningDevices.find.bind(collections.miningDevices);
  let compared = 0;
  let scanFilter: Parameters<typeof find>[0] | undefined;
  t.mock.method(collections.miningDevices, "find", (...args: Parameters<typeof find>) => {
    const cursor = find(...args);
    if (args[1]?.session && args[1]?.projection?.["featureProfile"] === 1) {
      scanFilter = args[0];
      const next = cursor.next.bind(cursor);
      t.mock.method(cursor, "next", async () => { const row = await next(); if (row) compared++; return row; });
    }
    return cursor;
  });
  const began = performance.now();
  const result = await start(owner, evidence());
  const ms = performance.now() - began;
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.ok(ms < 2000, `legitimate 50000-profile admission exceeded budget: ${ms.toFixed(1)}ms`);
  compared = 0;
  await beginMiningAdmission(collections, original.device.publicId);
  const session = client.startSession();
  const transactionBegan = performance.now();
  try {
    await session.withTransaction(async () => {
      for await (const candidate of iterateMiningAdmissionCandidates(collections, session)) {
        assert.equal(candidate.publicId, original.device.publicId);
      }
    });
  } finally {
    await session.endSession();
    await endMiningAdmission(collections, original.device.publicId);
  }
  const transactionMs = performance.now() - transactionBegan;
  assert.ok(compared <= 10, `idle history entered the matcher: ${compared} records`);
  assert.ok(scanFilter);
  const plan = await find(scanFilter).explain("executionStats");
  assert.ok(plan["executionStats"].totalDocsExamined <= 10);
  t.diagnostic(`50000 idle profiles: complete start status=${result.status}, latency=${ms.toFixed(1)}ms; transaction discovery=${transactionMs.toFixed(1)}ms, compared=${compared}; indexed documents=${plan["executionStats"].totalDocsExamined}; keys=${plan["executionStats"].totalKeysExamined}`);
});

test("SATURATION RACE: two idle correlated records remain exclusive when both recency scans miss them", async (t) => {
  const a = await account();
  const b = await account("medium");
  const other = evidence({ hardwareConcurrency: 32 });
  assert.equal(verdict(evidence(), other), "ambiguous");
  const first = await enroll(a, evidence());
  const second = await enroll(b, other);
  assert.equal(second.quotaAnchor, null);
  await seedIdleDevices(first.device, 70, unrelatedEvidence());
  const observed = gate(t, "both assessments completed before their device observations");
  const transactions = gate(t, "both observations written before recency churn");
  let observations = 0;
  let arrivals = 0;
  const updateOne = collections.miningDevices.updateOne.bind(collections.miningDevices);
  t.mock.method(collections.miningDevices, "updateOne", async (...args: Parameters<typeof updateOne>) => {
    if (!Array.isArray(args[1]) && args[1]?.$set?.featureProfile) {
      if (++observations === 2) observed.release();
      await observed.promise;
    }
    return updateOne(...args);
  });
  const startSession = client.startSession.bind(client);
  t.mock.method(client, "startSession", (...args: Parameters<typeof startSession>) => {
    const session = startSession(...args);
    const transaction = session.withTransaction.bind(session);
    t.mock.method(session, "withTransaction", async (fn: (s: ClientSession) => Promise<unknown>, options: Parameters<typeof transaction>[1]) => {
      if (++arrivals === 2) transactions.release();
      await transactions.promise;
      return transaction(fn, options);
    });
    return session;
  });
  const results = await Promise.all([start(a, evidence()), start(b, other)]);
  assert.deepEqual(results.map(result => result.status).sort(), [200, 409], JSON.stringify(results));
  assert.equal(await running(), 1);
  t.diagnostic(`hidden idle contenders: statuses=${results.map(result => result.status)}; one active cycle`);
});

test("SCAN FAILURE: a timed-out transaction comparison never commits partial admission", async (t) => {
  const owner = await account();
  const find = collections.miningDevices.find.bind(collections.miningDevices);
  let reads = 0;
  const injected = t.mock.method(collections.miningDevices, "find", (...args: Parameters<typeof find>) => {
    const cursor = find(...args);
    if (args[1]?.session?.inTransaction() && args[1]?.projection?.["featureProfile"] === 1) {
      const next = cursor.next.bind(cursor);
      t.mock.method(cursor, "next", async () => {
        await next(); // Real snapshot read succeeds before simulating a server budget expiry.
        reads++;
        throw new MongoServerError({ message: "injected scan execution budget exceeded", code: 50 });
      });
    }
    return cursor;
  });
  const result = await start(owner, evidence(), "10.49.0.1");
  injected.mock.restore();
  assert.ok(reads > 0);
  assert.equal(result.status, 503, JSON.stringify(result.body));
  assert.equal(result.body.error.code, "mining_start_busy");
  assert.equal(await running(), 0);
  assert.equal(await collections.miningDeviceLeases.countDocuments({ status: "active" }), 0);
  assert.equal((await collections.miningAdmissionNetworks.findOne({ _id: ipHash(config.encryptionKey, "10.49.0.1")! }))?.fence, false);
  assert.equal((await start(owner, evidence(), "10.49.0.1")).status, 200);
});

test("SCAN BOUND: excessive correlated records return busy without banning the account or opening a cycle", async () => {
  const owner = await account();
  const original = await enroll(owner, evidence());
  await seedIdleDevices(original.device, 201, evidence());
  // Resource bounds apply to current work; historical idle matches no longer consume the scan.
  await collections.miningDevices.updateMany({ publicId: { $ne: original.device.publicId } }, { $set: { admissionPending: 1 } });
  const result = await start(owner, evidence());
  assert.equal(result.status, 503, JSON.stringify(result.body));
  assert.equal(result.body.error.code, "mining_start_busy");
  assert.equal(await running(), 0);
  assert.equal(await collections.miningDeviceLeases.countDocuments({ status: "active" }), 0);
  assert.equal((await collections.miningDevices.findOne({ publicId: original.device.publicId }))?.status, original.device.status);
  const state = await app.inject({ method: "GET", url: "/api/v1/mining/state", headers: { authorization: `Bearer ${owner.token}` } });
  assert.equal(state.statusCode, 200, "the account remains usable after resource exhaustion");
});

test("STORAGE: coordination rows are indexed, expire independently, and missing preparation fails closed", async (t) => {
  const owner = await account();
  const ip = "10.48.0.1";
  const startSession = client.startSession.bind(client);
  const injected = t.mock.method(client, "startSession", (...args: Parameters<typeof startSession>) => {
    const session = startSession(...args);
    const transaction = session.withTransaction.bind(session);
    t.mock.method(session, "withTransaction", async (fn: (s: ClientSession) => Promise<unknown>, options: Parameters<typeof transaction>[1]) => {
      await collections.miningAdmissionNetworks.deleteOne({ _id: ipHash(config.encryptionKey, ip)! });
      return transaction(fn, options);
    });
    return session;
  });
  const result = await start(owner, evidence(), ip);
  injected.mock.restore();
  assert.equal(result.status, 503, JSON.stringify(result.body));
  assert.equal(await running(), 0);
  assert.equal(await collections.miningDeviceLeases.countDocuments({ status: "active" }), 0);
  assert.equal((await start(owner, evidence(), ip)).status, 200);
  const indexes = await collections.miningAdmissionNetworks.indexes();
  assert.ok(indexes.some(index => index.name === "_id_" && index.key["_id"] === 1));
  assert.ok(indexes.some(index => index.key["expiresAt"] === 1 && index.expireAfterSeconds === 0));
  const plan = await collections.miningAdmissionNetworks.find({ _id: ipHash(config.encryptionKey, ip)! }).explain("executionStats");
  assert.equal(plan["executionStats"].totalDocsExamined, 1);
  assert.equal(plan["executionStats"].totalKeysExamined, 1);
  // Model TTL removal of an idle coordination row: the independently committed leases survive.
  await collections.miningAdmissionNetworks.deleteOne({ _id: ipHash(config.encryptionKey, ip)! });
  assert.equal(await running(), 1);
  assert.ok(await collections.miningDeviceLeases.countDocuments({ status: "active" }) > 0);
  t.diagnostic("network fence lookup: 1 key / 1 document; deletion never grants or removes a mining lease");
});

test("RETRY BOUND: an exhausted contender reports the committed foreign owner instead of a busy error", async (t) => {
  const winner = await account();
  const contender = await account("medium");
  const findOne = collections.miningSessions.findOne.bind(collections.miningSessions);
  let failures = 0;
  t.mock.method(collections.miningSessions, "findOne", async (...args: Parameters<typeof findOne>) => {
    const result = await findOne(...args);
    if (args[1]?.session?.inTransaction() && args[0]?.ownerUserId === contender.id) {
      if (failures++ === 0) assert.equal((await start(winner, evidence())).status, 200);
      throw new MongoServerError({ message: "injected contention after winner committed", code: 112, errorLabels: ["TransientTransactionError"] });
    }
    return result;
  });
  const result = await start(contender, evidence());
  assert.equal(failures, 5);
  assert.equal(result.status, 409, JSON.stringify(result.body));
  assert.equal(result.body.error.code, "mining_device_already_in_use");
  assert.equal(await running(), 1);
  assert.equal(await collections.miningDeviceLeases.countDocuments({ ownerUserId: contender.id, status: "active" }), 0);
});

test("STRICT: forged fingerprints, fresh keys, identical models and shared NAT cannot authorize mining or merge devices", async () => {
  const owners = [await account(), await account("medium")];
  const { generateKeyPairSync } = await import("node:crypto");
  const keys = owners.map(() => JSON.stringify(generateKeyPairSync("ec", { namedCurve: "P-256" }).publicKey.export({ format: "jwk" })));
  const attempts = [
    evidence({ browserKeyPublicKey: keys[0] }),
    evidence({ browserKeyPublicKey: keys[1] }),
    { ...editedEvidence(3), browserKeyPublicKey: keys[1], attestation: { verified: true, tpm: true, deviceId: "forged" } },
    evidence({ browserKeyPublicKey: keys[0], userAgent: "Firefox", platform: "Linux" }),
  ];
  const secondApi = await buildApp({ config, collections, mongoClient: client, redis: disabledRedis(), logger: false });
  try {
    const results = await Promise.all(attempts.map((device, index) => start(owners[index % 2]!, device,
      index < 2 ? "10.65.0.1" : "10.65.0.2", index % 2 ? secondApi : app)));
    for (const result of results) {
      assert.equal(result.status, 403, JSON.stringify(result.body));
      assert.equal(result.body.error.code, "mining_verified_device_required");
    }
    assert.equal(await running(), 0);
    assert.equal(await collections.miningDevices.countDocuments(), 0, "unverified evidence cannot create or merge identities");
    assert.equal(await collections.miningDeviceLeases.countDocuments(), 0);
    assert.equal(await collections.miningDeviceQuotas.countDocuments(), 0);
    assert.equal(await collections.miningDeviceNonces.countDocuments(), 0);
    assert.equal(await collections.miningDeviceAttempts.countDocuments(), 0, "unsupported enrollment does not spend an attempt budget");
  } finally { await secondApi.close(); }
});

test("STRICT: disabling heuristic controls and claiming native attestation cannot bypass the service guard", async () => {
  const owner = await account();
  config.lmdg.enabled = false;
  config.lmdg.leaseEnabled = false;
  config.lmdg.riskMode = "monitor";
  const result = await start(owner, { ...evidence(), verified: true, enrollmentId: "forged", tpmCertificate: "self-signed" });
  assert.equal(result.status, 403, JSON.stringify(result.body));
  assert.equal(result.body.error.code, "mining_verified_device_required");
  const { startMining } = await import("../modules/mining/start.js");
  await assert.rejects(startMining({ collections, mongoClient: client, config, ownerUserId: owner.id,
    correlationId: randomUUID(), device: { evidenceRaw: evidence(), ip: "10.66.0.1" } }),
    { code: "mining_verified_device_required" });
  assert.equal(await running(), 0);
});

test("STRICT: browser proof issuance and replay never grant enrollment trust", async () => {
  const owner = await account();
  const challenge = await post("/api/v1/mining/device/challenge", { device: evidence() }, owner);
  assert.equal(challenge.status, 403, JSON.stringify(challenge.body));
  assert.equal(challenge.body.error.code, "mining_verified_device_required");
  const { generateKeyPairSync, sign } = await import("node:crypto");
  const pair = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const payload = { nonce: "old-nonce-0123456789", signature: sign("sha256", Buffer.from("forged attestation"), pair.privateKey).toString("base64url"),
    publicKeyJwk: pair.publicKey.export({ format: "jwk" }), device: evidence() };
  for (let index = 0; index < 2; index++) {
    const proof = await post("/api/v1/mining/device/prove", payload, owner);
    assert.equal(proof.status, 403, JSON.stringify(proof.body));
    assert.equal(proof.body.error.code, "mining_verified_device_required");
  }
  assert.equal(await collections.miningDeviceNonces.countDocuments(), 0);
  assert.equal(await collections.miningDevices.countDocuments(), 0);
  assert.equal(await running(), 0);
});

test("EVIDENCE: slow probes share one deadline and cancel outstanding reads", async (t) => {
  const find = collections.miningDevices.find.bind(collections.miningDevices);
  let completed = 0, cancelled = 0;
  t.mock.method(collections.miningDevices, "find", (...args: Parameters<typeof find>) => {
    if (args[1]?.hint !== EVIDENCE_INDEX) return find(...args);
    const signal = args[1].signal;
    assert.ok(signal, "every probe must be cancellable");
    return { limit() { return this; }, toArray: () => new Promise((resolve, reject) => {
      const abort = () => { clearTimeout(timer); cancelled++; reject(signal.reason); };
      const timer = setTimeout(() => { signal.removeEventListener("abort", abort); completed++; resolve([]); }, 175);
      if (signal.aborted) abort(); else signal.addEventListener("abort", abort, { once: true });
    }) };
  });
  const observed = observedFeatures(config.encryptionKey, normalizeSignals(sanitizeEvidence(evidence())));
  const started = performance.now();
  await assert.rejects(planAdmissionEvidence({ collections, observed, secret: config.encryptionKey,
    machineKey: null, browserKey: null, ambiguousThreshold: 55, deadline: started + 250 }), { code: "mining_start_busy" });
  assert.ok(performance.now() - started < 750, "a slow sequence must not acquire a new budget per query");
  assert.ok(completed <= 4, "only the first probe batch may finish");
  assert.ok(cancelled > 0, "outstanding probes were cancelled");
});

test("EVIDENCE: selectivity probe timeout refuses cleanly without granting a cycle", async (t) => {
  const owner = await account();
  const find = collections.miningDevices.find.bind(collections.miningDevices);
  let injected = 0;
  t.mock.method(collections.miningDevices, "find", (...args: Parameters<typeof find>) => {
    if (args[1]?.hint === EVIDENCE_INDEX) {
      injected++;
      throw new MongoServerError({ code: 50, errmsg: "injected probe time limit" });
    }
    return find(...args);
  });
  const result = await start(owner, evidence());
  assert.ok(injected > 0);
  assert.equal(result.status, 503, JSON.stringify(result.body));
  assert.equal(result.body.error.code, "mining_start_busy");
  assert.equal(await running(), 0);
  assert.equal(await collections.miningDeviceLeases.countDocuments(), 0);
  assert.equal(await collections.miningDevices.countDocuments({ admissionPending: { $gt: 0 } }), 0);
});

test("EVIDENCE: interrupted backfill fails closed, resumes and preserves all historical records", async (t) => {
  const owner = await account();
  const original = await enroll(owner, evidence());
  await seedIdleDevices(original.device, 410, unrelatedEvidence());
  await collections.miningDevices.updateMany({ publicId: { $ne: original.device.publicId } },
    { $unset: { admissionEvidenceVersion: "", admissionEvidenceTokens: "" } });
  const idsBefore = (await collections.miningDevices.find({}, { projection: { publicId: 1 } }).toArray()).map(row => row.publicId).sort();
  assert.equal((await start(owner, evidence())).status, 503, "unindexed evidence must not disappear");
  assert.equal(await running(), 0);
  assert.equal(await collections.miningDeviceLeases.countDocuments(), 0);
  // The second batch fails after the first 200 rows committed. Retry must skip only completed rows.
  const { Collection } = await import("mongodb");
  const bulk = Collection.prototype.bulkWrite;
  let batches = 0;
  const fault = t.mock.method(Collection.prototype, "bulkWrite", async function (this: InstanceType<typeof Collection>, ...args: Parameters<typeof bulk>) {
    if (this.collectionName === "mining_devices" && ++batches === 2) throw new Error("injected migration interruption");
    return bulk.apply(this, args);
  });
  await assert.rejects(backfillMiningEvidence(client.db(database), config.encryptionKey), /injected migration interruption/);
  fault.mock.restore();
  assert.equal(await collections.miningDevices.countDocuments({ admissionEvidenceVersion: { $exists: false } }), 210);
  assert.equal(await backfillMiningEvidence(client.db(database), config.encryptionKey), 210);
  assert.equal(await backfillMiningEvidence(client.db(database), config.encryptionKey), 0);
  const idsAfter = (await collections.miningDevices.find({}, { projection: { publicId: 1 } }).toArray()).map(row => row.publicId).sort();
  assert.deepEqual(idsAfter, idsBefore);
  assert.equal((await start(owner, evidence())).status, 200);
  assert.equal(await running(), 1);
  assert.equal(await collections.miningDevices.countDocuments({ admissionPending: { $gt: 0 } }), 0);
});

test("EVIDENCE: a stale partial observation cannot corrupt a newer machine token or learned history", async () => {
  const owner = await account();
  const original = await enroll(owner, evidence());
  const newer = { ...original.device, machineKeyHash: "newer-machine" };
  await collections.miningDevices.updateOne({ _id: original.device._id },
    { $set: { machineKeyHash: newer.machineKeyHash, ...admissionEvidence(newer, config.encryptionKey) } });
  const { recordDeviceSeen } = await import("../modules/mining-device/observation.js");
  await recordDeviceSeen(collections, config.encryptionKey, original.device, {
    ip: null, correlationId: randomUUID(), findings: [],
    intel: { asn: null, country: null, vpn: false, proxy: false, tor: false, hosting: false, anonymous: false, providerRisk: null },
  }, { raw: {}, digests: {}, machine: {} });
  const stored = await collections.miningDevices.findOne({ _id: original.device._id });
  assert.ok(stored);
  assert.equal(stored.machineKeyHash, newer.machineKeyHash);
  assert.deepEqual(stored.featureProfile, newer.featureProfile);
  assert.equal((await verifyMiningEvidence(client.db(database), config.encryptionKey)).mismatched, 0);
});

test("EVIDENCE: maintenance verification detects and repairs stale versioned tokens without changing identities", async () => {
  const owner = await account();
  const original = await enroll(owner, evidence());
  const clean = await verifyMiningEvidence(client.db(database), config.encryptionKey);
  assert.equal(clean.mismatched, 0);
  await collections.miningDevices.updateOne({ _id: original.device._id }, { $set: { admissionEvidenceTokens: [] } });
  const stale = await verifyMiningEvidence(client.db(database), config.encryptionKey);
  assert.equal(stale.mismatched, 1);
  assert.deepEqual((await collections.miningDevices.findOne({ _id: original.device._id }))?.admissionEvidenceTokens, [], "preflight is read-only");
  const repair = await verifyMiningEvidence(client.db(database), config.encryptionKey, true);
  assert.equal(repair.repaired, 1);
  assert.equal(repair.concurrentChanges, 0);
  assert.deepEqual(await verifyMiningEvidence(client.db(database), config.encryptionKey), clean);
  assert.equal(await collections.transactions.countDocuments(), 0);
  assert.equal(await collections.miningDeviceLeases.countDocuments(), 0);
});

test("EVIDENCE: indexed retrieval includes directional learned, drift and legacy witnesses", async () => {
  const owner = await account();
  const source = await enroll(owner, editedEvidence(3));
  const observed = observedFeatures(config.encryptionKey, normalizeSignals(sanitizeEvidence(evidence())));
  const history = learnFeatureProfile(source.device.featureProfile, observed.digests);
  const docs = [
    { ...source.device, featureProfile: history },
    { ...source.device, featureProfile: null, featureSnapshot: observed.raw },
    { ...source.device, featureProfile: Object.fromEntries(Object.entries(history).map(([key, entry]) =>
      [key, { ...entry, drift: [observed.digests[key]!].filter(Boolean) }])) },
  ].map((row, index) => ({ ...row, _id: new ObjectId(), publicId: randomUUID(), deviceKeyHash: `witness-${index}`,
    machineKeyHash: null, anchorHash: null, browserKeyPublicKey: null }));
  for (const row of docs) await collections.miningDevices.insertOne({ ...row, ...admissionEvidence(row, config.encryptionKey) });
  const tokens = await planAdmissionEvidence({ collections, observed, secret: config.encryptionKey,
    machineKey: null, browserKey: null, ambiguousThreshold: config.lmdg.ambiguousThreshold });
  const retrieved = await collections.miningDevices.find(evidenceCandidateFilter(tokens)).toArray();
  for (const row of docs) {
    assert.notEqual(decideClusterMatch(matchDeviceFeatures(row, observed, config.encryptionKey), 78, 55), "different");
    assert.ok(retrieved.some(candidate => candidate.publicId === row.publicId));
  }
  const stats = (await collections.miningDevices.find(evidenceCandidateFilter(tokens)).explain("executionStats"))["executionStats"];
  assert.ok(stats.totalDocsExamined <= 4);
  const probe = (await collections.miningDevices.find({ admissionEvidenceTokens: tokens[0]! },
    { projection: { _id: 0, publicId: 1 }, hint: EVIDENCE_INDEX }).limit(201).explain("executionStats"))["executionStats"];
  assert.equal(probe.totalDocsExamined, 0, "selectivity probes must be covered index reads");
});

test("STRICT: an established network resident cannot bypass verified-device policy in either order", async () => {
  const owners = [await account(), await account("medium")];
  const ip = "10.67.0.1";
  // Preserve a legacy resident as migration input; this does not claim independently verified identity.
  const legacy = { ...config, lmdg: { ...config.lmdg, identityMode: "legacy-test" as const } };
  const resident = await resolveOrCreateDevice({ collections, config: legacy, ownerUserId: owners[0]!.id,
    correlationId: randomUUID(), evidenceRaw: evidence(), ip,
    intel: { asn: null, country: null, vpn: false, proxy: false, tor: false, hosting: false, anonymous: false, providerRisk: null } });
  await collections.miningDevices.updateOne({ publicId: resident.device.publicId }, { $set: {
    trustState: "established", admissionCount: 10,
    networkTrusts: [{ ipHash: ipHash(config.encryptionKey, ip)!, admissions: 10, proofs: 0, firstAt: new Date(), lastAt: new Date() }],
  } });
  for (const order of [[1, 0], [0, 1]]) {
    for (const index of order) {
      const result = await start(owners[index]!, index === 0 ? evidence() : editedEvidence(3), ip);
      assert.equal(result.status, 403);
      assert.equal(result.body.error.code, "mining_verified_device_required");
    }
  }
  assert.equal(await running(), 0);
  assert.equal(await collections.miningDevices.countDocuments(), 1, "resident history is retained; forged newcomer not enrolled");
});

test("STRICT: existing cycles can still stop and settle while new starts and unverified recovery remain unavailable", async () => {
  const owner = await account();
  const legacyConfig = { ...config, lmdg: { ...config.lmdg, identityMode: "legacy-test" as const } };
  const legacyApp = await buildApp({ config: legacyConfig, collections, mongoClient: client, redis: disabledRedis(), logger: false });
  try { assert.equal((await start(owner, evidence(), "10.68.0.1", legacyApp)).status, 200); }
  finally { await legacyApp.close(); }
  const before = await collections.miningSessions.findOne({ ownerUserId: owner.id, status: "active" });
  assert.ok(before);
  const stopped = await post("/api/v1/mining/stop", {}, owner);
  assert.equal(stopped.status, 200, JSON.stringify(stopped.body));
  assert.equal(await running(), 0);
  assert.equal(await collections.miningDeviceLeases.countDocuments({ status: "active" }), 0);
  const state = await app.inject({ method: "GET", url: "/api/v1/mining/state", headers: { authorization: `Bearer ${owner.token}` } });
  assert.equal(state.statusCode, 200);
  assert.equal(state.json().canStart, false);
  assert.equal(state.json().startRestriction.code, "mining_verified_device_required");
  const requirements = await app.inject({ method: "GET", url: "/api/v1/mining/device/requirements", headers: { authorization: `Bearer ${owner.token}` } });
  assert.equal(requirements.json().enrollmentAvailable, false);
  assert.equal(requirements.json().browserMiningAllowed, false);
  assert.equal((await start(owner, evidence({ reinstall: true, recovery: true, rotateKey: true }))).status, 403);
  assert.equal(await collections.miningSessions.countDocuments({ publicId: before.publicId }), 1, "historical cycle retained");
});

const scalePopulations = (process.env["MINING_SCALE_PROFILES"] ?? "").split(",").filter(Boolean).map(Number);
for (const population of scalePopulations) {
  assert.ok([1000, 5000, 50_000, 100_000].includes(population), "unsupported scale fixture size");
  test(`EVIDENCE SCALE: ${population} historical profiles with indexed complete admission`, async (t) => {
    const owner = await account();
    const original = await enroll(owner, evidence());
    const seedBegan = performance.now();
    await seedIdleDevices(original.device, population, unrelatedEvidence());
    // Historical raw snapshots, already indexed by the migration, remain match-equivalent.
    const legacyIds = (await collections.miningDevices.find({ publicId: { $ne: original.device.publicId } },
      { projection: { publicId: 1 } }).limit(100).toArray()).map(row => row.publicId);
    const legacyRaw = observedFeatures(config.encryptionKey, normalizeSignals(sanitizeEvidence(unrelatedEvidence()))).raw;
    await collections.miningDevices.updateMany({ publicId: { $in: legacyIds } }, {
      $set: { featureProfile: null, featureSnapshot: legacyRaw, admissionLeaseEndsAt: new Date(Date.now() + 86_400_000) },
      $unset: { admissionEvidenceVersion: "", admissionEvidenceTokens: "" },
    });
    assert.equal(await backfillMiningEvidence(client.db(database), config.encryptionKey), 100);
    const seedMs = performance.now() - seedBegan;
    let measuring = false;
    const operations: Record<string, number> = {};
    const commands = (event: { commandName: string }) => {
      if (measuring) operations[event.commandName] = (operations[event.commandName] ?? 0) + 1;
    };
    client.on("commandStarted", commands);
    const find = collections.miningDevices.find.bind(collections.miningDevices);
    const filters: Parameters<typeof find>[0][] = [];
    t.mock.method(collections.miningDevices, "find", (...args: Parameters<typeof find>) => {
      if (measuring && args[1]?.projection?.["featureProfile"] === 1) filters.push(args[0]);
      return find(...args);
    });
    const samples: { status: number; code: string | null; ms: number }[] = [];
    let cpuUserMicros = 0;
    let cpuSystemMicros = 0;
    let peakRssBytes = process.memoryUsage().rss;
    const memorySampler = setInterval(() => { peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss); }, 10);
    try {
      for (let sample = 0; sample < 8; sample++) {
        const cpu = process.cpuUsage();
        const began = performance.now();
        measuring = true;
        const result = await start(owner, evidence(), "10.69.0.1");
        measuring = false;
        const elapsed = performance.now() - began;
        const used = process.cpuUsage(cpu);
        cpuUserMicros += used.user;
        cpuSystemMicros += used.system;
        samples.push({ status: result.status, code: result.body.error?.code ?? null, ms: elapsed });
        if (result.status === 200) {
          assert.equal(await running(), 1);
          const leases = await collections.miningDeviceLeases.find({ status: "active" }).toArray();
          assert.equal(new Set(leases.map(row => row.deviceClusterId)).size, leases.length);
          assert.ok(leases.every(row => row.ownerUserId === owner.id));
          assert.equal((await post("/api/v1/mining/stop", {}, owner)).status, 200);
          assert.equal((await post("/api/v1/mining/pools/join", { poolId: "low" }, owner)).status, 200);
        }
      }
    } finally { clearInterval(memorySampler); client.off("commandStarted", commands); measuring = false; }
    const explained = [];
    for (const filter of filters.slice(0, 2)) {
      const plan = await find(filter).limit(201).explain("executionStats");
      const stats = plan["executionStats"];
      explained.push({ keys: stats.totalKeysExamined, documents: stats.totalDocsExamined,
        executionMs: stats.executionTimeMillis, indexed: JSON.stringify(plan["queryPlanner"].winningPlan).includes(EVIDENCE_INDEX) });
    }
    const sorted = samples.map(row => row.ms).sort((a, b) => a - b);
    const percentile = (p: number) => sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)];
    const report = { population, mode: "isolated legacy matcher diagnostic; no physical-device guarantee", seedMs,
      samples, successful: samples.filter(row => row.status === 200).length,
      rejected: samples.filter(row => row.status !== 200).length,
      p50: percentile(0.5), p95: percentile(0.95), p99: percentile(0.99),
      cpuUserMicros, cpuSystemMicros, peakRssBytes, mongoResidentMiB: (await client.db("admin").command({ serverStatus: 1 }))["mem"]?.resident,
      operations, explained, pending: await collections.miningDevices.countDocuments({ admissionPending: { $gt: 0 } }),
      activeLeasesAfterStop: await collections.miningDeviceLeases.countDocuments({ status: "active" }),
    };
    const output = process.env["MINING_SCALE_OUT"];
    if (output) (await import("node:fs")).appendFileSync(output, `${JSON.stringify(report)}\n`);
    t.diagnostic(JSON.stringify(report));
    assert.equal(report.successful, 8, "every refusal is counted; failed starts do not establish capacity");
    assert.ok(samples[0]!.ms < 2000, "first start must meet the unchanged budget");
    assert.ok(explained.length === 2 && explained.every(row => row.indexed && row.documents <= 5));
    assert.equal(report.pending, 0);
    assert.equal(report.activeLeasesAfterStop, 0);
  });
}
