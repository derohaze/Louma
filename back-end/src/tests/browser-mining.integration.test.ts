import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, randomBytes, randomUUID, sign } from "node:crypto";
import { MongoClient, ObjectId } from "mongodb";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { loadConfig, type AppConfig } from "../config/env.js";
import { getCollections, type Collections } from "../infrastructure/mongodb/collections.js";
import { ensureDatabaseIndexes } from "../infrastructure/mongodb/indexes.js";
import { disabledRedis } from "../infrastructure/redis/client.js";
import { browserIdentity } from "../modules/mining-device/browser-identity.js";
import { settleSession } from "../modules/mining/settle.js";
import { loadWalletAndAccount } from "../modules/mining/state.js";
import { generate, generateSecret } from "otplib";
import { encryptSecret } from "../modules/security/crypto.js";
import { admissionEvidence } from "../modules/mining-device/candidate-evidence.js";
import { learnFeatureProfile } from "../modules/mining-device/identity.js";

const uri = process.env["MINING_AUDIT_URI"] ?? "";
assert.match(uri, /^mongodb:\/\/127\.0\.0\.1:\d+\/\?replicaSet=louma_audit$/, "Use the isolated audit runner");
const password = "BrowserAudit12345";
let app: FastifyInstance, client: MongoClient, collections: Collections, config: AppConfig, database: string, csrf: string;
let ipSequence = 0;
interface Account { id: string; token: string; csrf: string }

beforeEach(async () => {
  database = `louma_mining_audit_${randomUUID().replaceAll("-", "")}`;
  config = loadConfig({ NODE_ENV: "test", MONGODB_URI: uri, MONGODB_DATABASE: database,
    ACCESS_TOKEN_SECRET: randomBytes(32).toString("base64"), APP_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
    LMDG_IDENTITY_MODE: "browser", LMDG_ENABLED: "false", LMDG_DEVICE_LEASE_ENABLED: "false", LMDG_RISK_MODE: "monitor" });
  client = new MongoClient(uri, { monitorCommands: true }); await client.connect();
  collections = getCollections(client.db(database));
  await ensureDatabaseIndexes(client.db(database), { miningEvidenceSecret: config.encryptionKey });
  app = await buildApp({ config, collections, mongoClient: client, redis: disabledRedis(), logger: false });
  csrf = (await app.inject({ method: "GET", url: "/api/v1/auth/csrf" })).json().csrfToken as string;
});
afterEach(async () => {
  await app?.close();
  if (client) { assert.match(database, /^louma_mining_audit_[a-f0-9]{32}$/); await client.db(database).dropDatabase(); await client.close(); }
});
async function post(url: string, payload: Record<string, unknown>, account?: Account, api = app, ip?: string) {
  const response = await api.inject({ method: "POST", url, payload,
    remoteAddress: ip ?? `10.61.${Math.floor(++ipSequence / 250)}.${ipSequence % 250 + 1}`,
    headers: { "x-csrf-token": account?.csrf ?? csrf, ...(account ? { authorization: `Bearer ${account.token}` } : {}) } });
  return { status: response.statusCode, body: response.json() as { user: { id: string }; accessToken: string; csrfToken: string; error?: { code: string }; nonce: string; payload: string } };
}
async function account(): Promise<Account> {
  const result = await post("/api/v1/auth/register", { email: `browser.${randomUUID()}@example.test`, password, displayName: "Browser audit" });
  assert.equal(result.status, 201, JSON.stringify(result.body));
  const owner = { id: result.body.user.id, token: result.body.accessToken, csrf: result.body.csrfToken };
  assert.equal((await post("/api/v1/mining/pools/join", { poolId: "low" }, owner)).status, 200);
  return owner;
}
function browser(seed: string = randomUUID(), edits: Record<string, unknown> = {}) {
  const pair = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const jwk = pair.publicKey.export({ format: "jwk" });
  const device: Record<string, unknown> = { platform: "Win32", hardwareConcurrency: 8, deviceMemory: 8,
    screenColorDepth: 24, colorGamut: "srgb", hdr: false, audioSampleRate: 44100, audioChannels: 2,
    maxTouchPoints: 0, userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126.0",
    canvasHash: `canvas-${seed}`, audioHash: `audio-${seed}`, webglHash: `webgl-${seed}`, fontsHash: `fonts-${seed}`,
    browserKeyPublicKey: JSON.stringify(jwk), ...edits };
  return { pair, jwk, device };
}
async function proof(owner: Account, agent: ReturnType<typeof browser>, api = app, ip?: string) {
  const challenge = await post("/api/v1/mining/device/challenge", { device: agent.device }, owner, api, ip);
  assert.equal(challenge.status, 200, JSON.stringify(challenge.body));
  const signature = sign("sha256", Buffer.from(challenge.body.payload), { key: agent.pair.privateKey, dsaEncoding: "ieee-p1363" }).toString("base64url");
  const verified = await post("/api/v1/mining/device/prove", { device: agent.device, nonce: challenge.body.nonce, signature, publicKeyJwk: agent.jwk }, owner, api, ip);
  assert.equal(verified.status, 200, JSON.stringify(verified.body));
  return { device: agent.device, proofNonce: challenge.body.nonce };
}
const start = (owner: Account, payload: Record<string, unknown>, api = app, ip?: string) => post("/api/v1/mining/start", payload, owner, api, ip);
const running = () => collections.miningSessions.countDocuments({ status: "active", endsAt: { $gt: new Date() } });

test("BROWSER: 24 authenticated users on one NAT complete proof and start without sharing HTTP budgets", async () => {
  const owners: Account[] = [];
  for (let index = 0; index < 24; index++) owners.push(await account());
  const results = await Promise.all(owners.map(async owner => start(owner, await proof(owner, browser(), app, "10.88.0.1"), app, "10.88.0.1")));
  assert.ok(results.every(result => result.status === 200), JSON.stringify(results.map(result => [result.status, result.body.error?.code])));
  assert.equal(await running(), 24);
});

test("BROWSER: explicit enrollment revocation after admission prevents reward credit", async () => {
  const owner = await account();
  assert.equal((await start(owner, await proof(owner, browser()))).status, 200);
  const session = (await collections.miningSessions.findOne({ ownerUserId: owner.id }))!;
  const past = new Date(Date.now() - 60_000);
  await collections.miningSessions.updateOne({ _id: session._id }, { $set: { startedAt: past, "browserAdmission.verifiedAt": past } });
  await collections.miningDevices.updateOne({ publicId: session.deviceId! }, { $set: { status: "blocked" } });
  assert.equal((await post("/api/v1/mining/settle", {}, owner)).body.error?.code, "mining_reward_ineligible");
  assert.equal((await post("/api/v1/mining/stop", {}, owner)).body.error?.code, "mining_reward_ineligible");
  assert.equal((await loadWalletAndAccount(collections, owner.id)).walletAccount.balanceMinor, 0);
});

test("BROWSER: enabled 2FA is mandatory, atomic with admission and single-use", async (t) => {
  const owner = await account(), agent = browser(undefined, { integrity: { webdriver: true } });
  const secret = generateSecret(), encrypted = encryptSecret(secret, config.encryptionKey), now = new Date();
  await collections.twoFactorCredentials.insertOne({ _id: new ObjectId(), ownerUserId: owner.id,
    encryptedSecret: encrypted.encryptedSecret, secretIv: encrypted.iv, secretAuthTag: encrypted.authTag,
    pendingExpiresAt: null, enabledAt: now, recoveryCodeHashes: [], createdAt: now, updatedAt: now });
  const payload = await proof(owner, agent);
  assert.equal((await start(owner, { ...payload, verification: { password } })).body.error?.code, "invalid_two_factor_code");
  assert.equal((await start(owner, { ...payload, verification: { password, twoFactorCode: "invalid" } })).body.error?.code, "invalid_two_factor_code");
  const code = await generate({ secret });
  const mock = t.mock.method(collections.miningDeviceLeases, "insertMany", async () => { throw new Error("lease failure after credential consume"); });
  assert.notEqual((await start(owner, { ...payload, verification: { password, twoFactorCode: code } })).status, 200);
  assert.equal(await collections.twoFactorUses.countDocuments(), 0);
  mock.mock.restore();
  assert.equal((await start(owner, { ...payload, verification: { password, twoFactorCode: await generate({ secret }) } })).status, 200);
  assert.equal(await collections.twoFactorUses.countDocuments({ purpose: "mining" }), 1);
  assert.equal((await post("/api/v1/mining/stop", {}, owner)).status, 200);
  await post("/api/v1/mining/pools/join", { poolId: "low" }, owner);
  const next = await proof(owner, agent);
  // Pin the currently valid step as already consumed so crossing a 30s boundary cannot flake.
  await collections.twoFactorUses.updateOne({ ownerUserId: owner.id }, { $set: { timeStep: Math.floor(Date.now() / 30_000) } });
  assert.equal((await start(owner, { ...next, verification: { password, twoFactorCode: await generate({ secret }) } })).body.error?.code, "two_factor_code_already_used");
});

test("BROWSER: signed Origin cannot be changed during proof or start", async () => {
  const owner = await account(), agent = browser();
  const send = async (url: string, payload: Record<string, unknown>, origin: string) => app.inject({ method: "POST", url, payload,
    headers: { authorization: `Bearer ${owner.token}`, "x-csrf-token": owner.csrf, origin } });
  const originalOrigin = "http://localhost:5173", changedOrigin = "http://localhost:3000";
  config.frontendOrigins.push(changedOrigin);
  const challenge = await send("/api/v1/mining/device/challenge", { device: agent.device }, originalOrigin);
  assert.equal(challenge.statusCode, 200, challenge.body);
  const issued = challenge.json() as { nonce: string; payload: string };
  const signed = { device: agent.device, nonce: issued.nonce, publicKeyJwk: agent.jwk,
    signature: sign("sha256", Buffer.from(issued.payload), { key: agent.pair.privateKey, dsaEncoding: "ieee-p1363" }).toString("base64url") };
  const changed = await send("/api/v1/mining/device/prove", signed, changedOrigin);
  assert.equal(changed.json().error.code, "mining_device_proof_rejected", changed.body);
  assert.equal((await send("/api/v1/mining/device/prove", signed, originalOrigin)).statusCode, 200);
  const startPayload = { device: agent.device, proofNonce: issued.nonce };
  assert.equal((await send("/api/v1/mining/start", startPayload, changedOrigin)).json().error.code, "mining_device_challenge_required");
  assert.equal((await send("/api/v1/mining/start", startPayload, originalOrigin)).statusCode, 200);
});

test("BROWSER: concurrent stops and settlement converge without rejecting legitimate rewards", async () => {
  const owner = await account();
  assert.equal((await start(owner, await proof(owner, browser()))).status, 200);
  const past = new Date(Date.now() - 60_000);
  await collections.miningSessions.updateOne({ ownerUserId: owner.id }, { $set: { startedAt: past, "browserAdmission.verifiedAt": past } });
  const results = await Promise.all([post("/api/v1/mining/stop", {}, owner), post("/api/v1/mining/stop", {}, owner), post("/api/v1/mining/settle", {}, owner)]);
  assert.ok(results.every(result => result.status === 200), JSON.stringify(results));
  assert.equal(await running(), 0);
  const session = (await collections.miningSessions.findOne({ ownerUserId: owner.id }))!;
  assert.equal((await loadWalletAndAccount(collections, owner.id)).walletAccount.balanceMinor, session.settledMinor);
});

test("BROWSER: a start/stop between risk assessment and commit requires renewed account verification", async (t) => {
  const owner = await account(), delayed = await proof(owner, browser()), other = await proof(owner, browser());
  let entered!: () => void, release!: () => void;
  const enteredGate = new Promise<void>(resolve => { entered = resolve; });
  const resumeGate = new Promise<void>(resolve => { release = resolve; });
  const original = collections.miningDeviceQuotas.insertOne.bind(collections.miningDeviceQuotas);
  let first = true;
  // Enrollment budget is after risk assessment and before the start transaction.
  const mock = t.mock.method(collections.miningDeviceQuotas, "insertOne", async (...args: Parameters<typeof original>) => {
    if (first) { first = false; entered(); await resumeGate; }
    return original(...args);
  });
  const waiting = start(owner, delayed);
  try {
    await Promise.race([enteredGate, new Promise((_, reject) => setTimeout(() => reject(new Error("risk barrier timeout")), 5000))]);
    assert.equal((await start(owner, other)).status, 200);
    assert.equal((await post("/api/v1/mining/stop", {}, owner)).status, 200);
    await post("/api/v1/mining/pools/join", { poolId: "low" }, owner);
  } finally { release(); }
  const result = await waiting;
  mock.mock.restore();
  t.diagnostic(`delayed-start status=${result.status}, code=${result.body.error?.code ?? "none"}`);
  assert.equal(result.body.error?.code, "mining_account_verification_required", JSON.stringify(result.body));
  assert.equal(await running(), 0);
});

test("BROWSER: exact legacy key revocation survives browser cutover", async () => {
  const owner = await account(), agent = browser(), key = randomUUID(), now = new Date();
  await collections.miningDevices.insertOne({ _id: new ObjectId(), publicId: key, deviceKeyHash: key, status: "blocked",
    browserKeyPublicKey: JSON.stringify(agent.jwk), firstSeenAt: now, lastSeenAt: now, createdAt: now, updatedAt: now,
    ...admissionEvidence({ browserKeyPublicKey: JSON.stringify(agent.jwk), machineKeyHash: null, featureProfile: null, featureSnapshot: null }, config.encryptionKey) } as never);
  assert.equal((await start(owner, await proof(owner, agent))).body.error?.code, "mining_device_unavailable");
  assert.equal(await running(), 0);
});

test("BROWSER: missing proof creates no enrollment, lease, session or reward; normal proof starts despite legacy switches", async () => {
  const owner = await account(), device = browser();
  assert.equal((await start(owner, { device: device.device })).body.error?.code, "mining_device_challenge_required");
  assert.equal(await collections.miningDevices.countDocuments(), 0);
  assert.equal(await collections.miningDeviceLeases.countDocuments(), 0);
  const response = await start(owner, await proof(owner, device));
  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.equal(await running(), 1);
  assert.equal((await collections.miningSessions.findOne({ ownerUserId: owner.id }))?.admissionPolicy, "browser-v1");
  assert.equal(await collections.miningDeviceNonces.countDocuments({ startUsedAt: { $type: "date" } }), 1);
});

test("BROWSER: shared NAT and identical hardware do not merge independent keys", async () => {
  const owners = [await account(), await account()];
  for (const owner of owners) {
    const result = await start(owner, await proof(owner, browser()), app, "10.70.0.1");
    assert.equal(result.status, 200, JSON.stringify(result.body));
  }
  assert.equal(await running(), 2);
  assert.equal(await collections.miningDevices.countDocuments(), 2);
  assert.equal(await collections.miningDeviceQuotas.countDocuments({ scope: "network" }), 0);
});

test("BROWSER: canonical key continuity survives edited traits, key JSON and network switching", async () => {
  const a = await account(), b = await account(), original = browser();
  assert.equal((await start(a, await proof(a, original))).status, 200);
  const variant = { ...original, device: { ...original.device, hardwareConcurrency: 32, colorGamut: "p3", canvasHash: "edited",
    browserKeyPublicKey: JSON.stringify({ y: `${original.jwk.y}=`, x: `${original.jwk.x}=`, crv: "P-256", kty: "EC" }) } };
  const response = await start(b, await proof(b, variant));
  assert.equal(response.body.error?.code, "mining_device_already_in_use");
  assert.equal(await running(), 1);
});

test("BROWSER: proof intent, account, expiry and start replay are enforced", async () => {
  const a = await account(), b = await account(), device = browser(), payload = await proof(a, device);
  assert.equal((await start(b, payload)).body.error?.code, "mining_device_challenge_required");
  assert.equal((await start(a, { ...payload, device: { ...device.device, hardwareConcurrency: 64 } })).body.error?.code, "mining_device_challenge_required");
  await collections.miningDeviceNonces.updateOne({ nonce: payload.proofNonce }, { $set: { expiresAt: new Date(0) } });
  assert.equal((await start(a, payload)).body.error?.code, "mining_device_challenge_required");
  const fresh = await proof(a, device);
  assert.equal((await start(a, fresh)).status, 200);
  assert.equal((await post("/api/v1/mining/stop", {}, a)).status, 200);
  await post("/api/v1/mining/pools/join", { poolId: "low" }, a);
  assert.equal((await start(a, fresh)).body.error?.code, "mining_device_challenge_required");
});

test("BROWSER: suspicious evidence requires account password before any enrollment or reward", async () => {
  const owner = await account(), device = browser(undefined, { integrity: { webdriver: true } }), payload = await proof(owner, device);
  assert.equal((await start(owner, payload)).body.error?.code, "mining_account_verification_required");
  assert.equal(await collections.miningDevices.countDocuments(), 0);
  assert.equal((await start(owner, { ...payload, verification: { password: "incorrect" } })).body.error?.code, "invalid_credentials");
  assert.equal(await running(), 0);
  const response = await start(owner, { ...payload, verification: { password } });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.equal((await collections.miningSessions.findOne({ ownerUserId: owner.id }))?.browserAdmission?.accountVerified, true);
});

test("BROWSER: correlated histories step up without merging or banning legitimate identities", async () => {
  const a = await account(), b = await account();
  assert.equal((await start(a, await proof(a, browser("same-rendering")))).status, 200);
  const payload = await proof(b, browser("same-rendering"));
  assert.equal((await start(b, payload)).body.error?.code, "mining_account_verification_required");
  assert.equal((await start(b, { ...payload, verification: { password } })).status, 200);
  assert.equal(await running(), 2);
});

test("BROWSER: reset recovery retains account quota and requires step-up", async () => {
  const owner = await account();
  assert.equal((await start(owner, await proof(owner, browser()))).status, 200);
  const before = await collections.miningSessions.findOne({ ownerUserId: owner.id });
  assert.equal((await post("/api/v1/mining/stop", {}, owner)).status, 200);
  await post("/api/v1/mining/pools/join", { poolId: "low" }, owner);
  const payload = await proof(owner, browser());
  assert.equal((await start(owner, payload)).body.error?.code, "mining_account_verification_required");
  assert.equal((await start(owner, { ...payload, verification: { password } })).status, 200);
  const active = await collections.miningSessions.findOne({ ownerUserId: owner.id, status: "active" });
  assert.equal(active?.accountWindowStart?.getTime(), before?.accountWindowStart?.getTime());
});

test("BROWSER: 50 simultaneous accounts across API instances have one proven-key owner and no partial sessions", async (t) => {
  const secondClient = await new MongoClient(uri).connect();
  const second = await buildApp({ config, collections: getCollections(secondClient.db(database)), mongoClient: secondClient, redis: disabledRedis(), logger: false });
  t.after(async () => { await second.close(); await secondClient.close(); });
  const device = browser(), owners: Account[] = [];
  for (let index = 0; index < 50; index++) owners.push(await account());
  const payloads: Awaited<ReturnType<typeof proof>>[] = [];
  for (const owner of owners) payloads.push(await proof(owner, device));
  const results = await Promise.all(owners.map((owner, index) => start(owner, payloads[index]!, index % 2 ? second : app)));
  assert.equal(results.filter(result => result.status === 200).length, 1, JSON.stringify(results.map(result => [result.status, result.body.error])));
  assert.ok(results.every(result => result.status === 200 || result.body.error?.code === "mining_device_already_in_use"), JSON.stringify(results.map(result => [result.status, result.body.error])));
  assert.equal(await running(), 1);
  assert.equal(await collections.miningDevices.countDocuments(), 1);
  assert.equal(await collections.miningDeviceLeases.countDocuments({ status: "active" }), 2);
  assert.equal(await collections.miningDeviceNonces.countDocuments({ startUsedAt: { $type: "date" } }), 1);
});

test("BROWSER: atomic attempt budgets survive rotating IP and two API callers", async () => {
  const owner = await account(), device = browser();
  const results = await Promise.all(Array.from({ length: 50 }, () => start(owner, { device: device.device })));
  assert.ok(results.filter(result => result.body.error?.code === "mining_device_challenge_required").length <= 12);
  assert.ok(results.some(result => result.status === 429));
  assert.equal(await collections.miningDevices.countDocuments(), 0);
});

test("BROWSER: lease insertion failure rolls back enrollment and proof use; retry recovers", async (t) => {
  const owner = await account(), payload = await proof(owner, browser());
  const mock = t.mock.method(collections.miningDeviceLeases, "insertMany", async () => { throw new Error("injected lease failure"); });
  const failed = await start(owner, payload);
  assert.notEqual(failed.status, 200);
  assert.equal(await running(), 0);
  assert.equal(await collections.miningDevices.countDocuments(), 0);
  assert.equal(await collections.miningDeviceNonces.countDocuments({ startUsedAt: { $type: "date" } }), 0);
  mock.mock.restore();
  assert.equal((await start(owner, payload)).status, 200);
});

test("BROWSER: expired proof rows cannot erase earned rewards; duplicate settlement posts once", async () => {
  const owner = await account();
  assert.equal((await start(owner, await proof(owner, browser()))).status, 200);
  await collections.miningDeviceNonces.deleteMany({});
  // Simulate elapsed server time only in this isolated DB; preserve admission/lease bindings.
  const past = new Date(Date.now() - 60_000);
  await collections.miningSessions.updateOne({ ownerUserId: owner.id }, { $set: { startedAt: past, "browserAdmission.verifiedAt": past } });
  const results = await Promise.all(Array.from({ length: 5 }, () => post("/api/v1/mining/settle", {}, owner)));
  assert.ok(results.every(result => result.status === 200), JSON.stringify(results));
  const session = await collections.miningSessions.findOne({ ownerUserId: owner.id });
  const headers = await collections.transactions.find({ miningSessionId: session!.publicId }).toArray();
  assert.equal(headers.length, 1);
  assert.ok(session!.settledMinor > 0);
  const { walletAccount } = await loadWalletAndAccount(collections, owner.id);
  assert.equal(walletAccount.balanceMinor, session!.settledMinor);
});

test("BROWSER: reward paths reject missing admission and forged internal rate without moving funds", async () => {
  const owner = await account();
  assert.equal((await start(owner, await proof(owner, browser()))).status, 200);
  const session = (await collections.miningSessions.findOne({ ownerUserId: owner.id }))!;
  const bound = await loadWalletAndAccount(collections, owner.id);
  await assert.rejects(settleSession({ collections, mongoClient: client, config, session: { ...session, rateUnits: session.rateUnits * 100, startedAt: new Date(Date.now() - 60_000) }, ...bound, correlationId: randomUUID() }), /eligibility/);
  await collections.miningSessions.updateOne({ _id: session._id }, { $unset: { browserAdmission: "", admissionPolicy: "" } });
  assert.equal((await post("/api/v1/mining/stop", {}, owner)).body.error?.code, "mining_reward_ineligible");
  assert.equal((await post("/api/v1/mining/settle", {}, owner)).body.error?.code, "mining_reward_ineligible");
  assert.equal((await loadWalletAndAccount(collections, owner.id)).walletAccount.balanceMinor, 0);
});

test("OPEN BROWSER: coherent forged evidence, separate keys and owned accounts remain indistinguishable from distinct users", async (t) => {
  for (let index = 0; index < 2; index++) {
    const owner = await account();
    assert.equal((await start(owner, await proof(owner, browser(undefined, { hardwareConcurrency: 8 * (index + 1) })))).status, 200);
  }
  assert.equal(await running(), 2);
  t.diagnostic("OPEN physical/Sybil boundary: independently generated browser keys plus coherent client evidence do not establish separate physical devices.");
});

test("BROWSER SCALE: 100000 indexed histories and a saturated risk bucket remain bounded", { skip: process.env["BROWSER_SCALE"] !== "1" }, async (t) => {
  const owner = await account(), device = browser();
  assert.equal((await start(owner, await proof(owner, device))).status, 200);
  const template = (await collections.miningDevices.findOne({ identityKind: "browser" }))!;
  const beforeMemory = process.memoryUsage(), beforeCpu = process.cpuUsage();
  for (let offset = 0; offset < 100_000; offset += 500) {
    await collections.miningDevices.insertMany(Array.from({ length: 500 }, (_, index) => {
      const key = `scale-${offset + index}`;
      const features = Object.fromEntries(Object.keys(template.featureSnapshot!).map(name => [name, randomBytes(16).toString("hex")]));
      const profile = learnFeatureProfile(null, features);
      return { ...template, _id: new ObjectId(), publicId: key, deviceKeyHash: key, anchorHash: key, browserKeyPublicKey: null,
        featureSnapshot: features, featureProfile: profile,
        ...admissionEvidence({ featureSnapshot: features, featureProfile: profile, browserKeyPublicKey: null, machineKeyHash: null }, config.encryptionKey) };
    }));
  }
  const fresh = await account(), freshBrowser = browser(), payload = await proof(fresh, freshBrowser), startAt = performance.now();
  const result = await start(fresh, payload);
  const elapsedMs = performance.now() - startAt;
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.ok(elapsedMs < 2000, `initial start ${elapsedMs}ms`);
  const token = `canvas:${browserIdentity(config.encryptionKey, freshBrowser.device).features["canvas"]}`;
  const explain = await collections.miningDevices.find({ admissionEvidenceTokens: token }).hint("mining_devices_evidence").explain("executionStats");
  assert.ok(explain["executionStats"].totalDocsExamined <= 1);
  t.diagnostic(JSON.stringify({ elapsedMs, docs: explain["executionStats"].totalDocsExamined, keys: explain["executionStats"].totalKeysExamined,
    cpu: process.cpuUsage(beforeCpu), rssBefore: beforeMemory.rss, rssAfter: process.memoryUsage().rss }));
  const collisionOwner = await account();
  await collections.miningDevices.updateMany({ publicId: /^scale-/ }, { $set: {
    featureSnapshot: template.featureSnapshot, featureProfile: template.featureProfile,
    ...admissionEvidence({ ...template, browserKeyPublicKey: null }, config.encryptionKey),
  } });
  const collision = await proof(collisionOwner, browser(String(device.device["canvasHash"]).replace("canvas-", "")));
  assert.equal((await start(collisionOwner, collision)).body.error?.code, "mining_account_verification_required");
  assert.equal((await start(collisionOwner, { ...collision, verification: { password } })).status, 200);
});

test("BROWSER LOAD: 256 independent accounts on one NAT, full signed requests and all-result latency", { skip: process.env["BROWSER_SCALE"] !== "1" }, async (t) => {
  const owners: Account[] = [], payloads: Awaited<ReturnType<typeof proof>>[] = [];
  for (let index = 0; index < 256; index++) {
    const owner = await account(); owners.push(owner); payloads.push(await proof(owner, browser()));
  }
  const cpu = process.cpuUsage(), rss = process.memoryUsage().rss, timings: number[] = [], outcomes: Record<string, number> = {};
  const operations: Record<string, number> = {};
  let transactionStarts = 0, writeConflicts = 0;
  client.on("commandStarted", event => { operations[event.commandName] = (operations[event.commandName] ?? 0) + 1; if (event.command["startTransaction"]) transactionStarts++; });
  client.on("commandFailed", event => { if ((event.failure as { code?: number }).code === 112) writeConflicts++; });
  for (let offset = 0; offset < owners.length; offset += 32) {
    await Promise.all(owners.slice(offset, offset + 32).map(async (owner, index) => {
      const began = performance.now(), result = await start(owner, payloads[offset + index]!, app, "10.80.0.1");
      timings.push(performance.now() - began);
      const code = result.body.error?.code ?? String(result.status); outcomes[code] = (outcomes[code] ?? 0) + 1;
    }));
  }
  timings.sort((a, b) => a - b);
  t.diagnostic(JSON.stringify({ accounts: 256, concurrency: 32, outcomes, p50: timings[127], p95: timings[243], p99: timings[253],
    operations, transactionStarts, writeConflicts, cpu: process.cpuUsage(cpu), rssBefore: rss, rssAfter: process.memoryUsage().rss }));
  assert.equal(outcomes["200"], 256, JSON.stringify(outcomes));
  assert.equal(await running(), 256);
  assert.equal(await collections.miningDevices.countDocuments(), 256);
  assert.equal(await collections.miningDeviceLeases.countDocuments({ status: "active" }), 512);
});
