import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { MongoClient } from "mongodb";

// Usage: node src/tests/run-isolated-mining-audit.mjs /absolute/path/to/mongod [all|audit|regression|benchmark|scale]
// Starts its OWN loopback-only replica set. Never accepts a database URI or loads an application env file.
const [binary, suite = "all"] = process.argv.slice(2);
if (!binary || !["all", "audit", "regression", "benchmark", "scale"].includes(suite)) {
  throw new Error("Usage: node src/tests/run-isolated-mining-audit.mjs <mongod executable> [all|audit|regression|benchmark|scale]");
}
const cwd = fileURLToPath(new URL("../../", import.meta.url));
const directory = await mkdtemp(join(tmpdir(), "louma-mining-audit-"));
const listener = createServer();
await new Promise((ready, reject) => { listener.once("error", reject); listener.listen(0, "127.0.0.1", ready); });
const port = listener.address().port;
await new Promise(resolveClose => listener.close(resolveClose));
const uri = `mongodb://127.0.0.1:${port}/?replicaSet=louma_audit`;
const mongo = spawn(resolve(binary), [
  "--bind_ip", "127.0.0.1", "--port", String(port), "--dbpath", directory,
  "--replSet", "louma_audit", "--wiredTigerCacheSizeGB", "0.25", "--logpath", join(directory, "mongod.log"),
], { windowsHide: true, stdio: "ignore" });
let mongoError;
mongo.once("error", error => { mongoError = error; });
const mongoExited = new Promise(resolveExit => { mongo.once("exit", resolveExit); mongo.once("error", resolveExit); });
let connection;
const deadline = Date.now() + 30_000;
let failed = false;
console.log(`Isolated MongoDB artifacts: ${directory}`);

// Allowlist OS necessities only: inherited production secrets, service URLs, NODE_OPTIONS and
// provider credentials cannot reach the test process. All application configuration is synthetic.
const environment = {};
for (const [key, value] of Object.entries(process.env)) {
  if (["path", "systemroot", "windir", "temp", "tmp", "userprofile"].includes(key.toLowerCase())) environment[key] = value;
}
Object.assign(environment, {
  NODE_ENV: "test", MONGODB_URI: uri, MINING_AUDIT_URI: uri,
  ACCESS_TOKEN_SECRET: randomBytes(32).toString("base64"), APP_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
  FRONTEND_ORIGINS: "http://localhost:5173", REDIS_ENABLED: "false", LMDG_RISK_MODE: "enforce",
});

async function run(label, args, extra = {}) {
  const output = createWriteStream(join(directory, `${label}.log`));
  const child = spawn(process.execPath, args, {
    cwd, windowsHide: true, env: { ...environment, MONGODB_DATABASE: `louma_audit_${randomUUID().replaceAll("-", "")}`, ...extra },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", chunk => { process.stdout.write(chunk); output.write(chunk); });
  child.stderr.on("data", chunk => { process.stderr.write(chunk); output.write(chunk); });
  const code = await new Promise((done, reject) => { child.once("error", reject); child.once("exit", done); });
  await new Promise(done => output.end(done));
  if (code !== 0) failed = true;
  console.log(`${label}: exit ${code}`);
}

try {
  while (!connection && Date.now() < deadline) {
    if (mongoError) throw mongoError;
    if (mongo.exitCode !== null) throw new Error(`mongod exited ${mongo.exitCode}; see ${directory}`);
    const candidate = new MongoClient(`mongodb://127.0.0.1:${port}/?directConnection=true`, { serverSelectionTimeoutMS: 500 });
    try {
      await candidate.connect();
      const status = await candidate.db("admin").command({ serverStatus: 1 });
      if (status.pid !== mongo.pid) throw new Error("Port is owned by another server; refusing to initialize it");
      connection = candidate;
    } catch (error) {
      await candidate.close();
      if (error.message.includes("another server")) throw error;
      await delay(100);
    }
  }
  if (!connection) throw new Error("Isolated mongod did not start");
  await connection.db("admin").command({ replSetInitiate: { _id: "louma_audit", members: [{ _id: 0, host: `127.0.0.1:${port}` }] } });
  while (!(await connection.db("admin").command({ hello: 1 })).isWritablePrimary) {
    if (Date.now() > deadline) throw new Error("Replica set did not elect a primary");
    await delay(100);
  }
  const version = await connection.db("admin").command({ buildInfo: 1 });
  console.log(`MongoDB ${version.version}, single-node replica set, loopback only, Redis disabled`);
  if (suite === "all" || suite === "audit") {
    await run("adversarial", ["--import", "tsx", "--test", "src/tests/mining-adversarial.integration.test.ts"]);
  }
  if (suite === "scale") {
    await run("indexed-scale", ["--import", "tsx", "--test", "--test-name-pattern=INDEXED SCALE", "src/tests/mining-adversarial.integration.test.ts"]);
    await run("mining-scale-load", ["--import", "tsx", "src/tests/lmdg-load-benchmark.ts"], {
      BENCH_ALLOW_DESTRUCTIVE_CLEANUP: "1", BENCH_ACCOUNTS: "256", BENCH_LEVELS: "8,16,32", BENCH_OUT: join(directory, "mining-scale-load.json"),
    });
  }
  if (suite === "all" || suite === "regression") {
    for (const name of ["database", "mining", "mining-device", "mining-pool-race"]) {
      await run(name, ["--import", "tsx", "--test", `src/tests/${name}.integration.test.ts`]);
    }
  }
  if (suite === "all" || suite === "benchmark") {
    // The start benchmark seeds this database before the read-only architecture benchmark.
    const db = `louma_audit_${randomUUID().replaceAll("-", "")}`;
    await run("mining-start-benchmark", ["--import", "tsx", "src/tests/lmdg-start-benchmark.ts"], {
      MONGODB_DATABASE: db, BENCH_SAMPLES: "12", BENCH_ALLOW_DESTRUCTIVE_CLEANUP: "1", BENCH_OUT: join(directory, "mining-start-benchmark.json"),
    });
    await run("architecture-benchmark", ["--import", "tsx", "src/tests/architecture-benchmark.ts"], { MONGODB_DATABASE: db });
    await run("mining-load-benchmark", ["--import", "tsx", "src/tests/lmdg-load-benchmark.ts"], {
      BENCH_ALLOW_DESTRUCTIVE_CLEANUP: "1", BENCH_ACCOUNTS: "48", BENCH_LEVELS: "8,16", BENCH_OUT: join(directory, "mining-load-benchmark.json"),
    });
  }
} finally {
  if (connection) {
    try { await connection.db("admin").command({ shutdown: 1, force: true }); } catch { /* shutdown closes the socket */ }
    await connection.close();
  }
  if (mongo.exitCode === null) mongo.kill();
  await mongoExited;
  // Keep logs and the isolated data directory for inspection; no production paths are removed.
}
process.exitCode = failed ? 1 : 0;
