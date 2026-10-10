import { randomBytes, randomUUID } from "node:crypto";
import { createServer } from "node:net";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { MongoClient } from "mongodb";

const uri = process.env.GATEWAY_TEST_MONGODB_URI;
if (!/^mongodb:\/\/(?:127\.0\.0\.1|localhost|\[::1\]):\d+\/(?:\?[^#]*)?$/.test(uri ?? "")) throw new Error("Explicit loopback replica set required");
const database = `louma_gateway_test_${randomUUID()}`;
const listener = createServer();
await new Promise(resolve => listener.listen(0, "127.0.0.1", resolve));
const port = listener.address().port;
await new Promise(resolve => listener.close(resolve));
const client = new MongoClient(uri);
await client.connect();
const child = spawn(process.execPath, ["dist/src/server.js"], { windowsHide: true, stdio: ["ignore", "ignore", "pipe"], env: {
  NODE_ENV: "test", HOST: "127.0.0.1", LOUMA_API_PORT: String(port), MONGODB_URI: uri, MONGODB_DATABASE: database,
  ACCESS_TOKEN_SECRET: randomBytes(32).toString("base64"), APP_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
  GATEWAY_ENABLED: "true", GATEWAY_ENVIRONMENT: "test", GATEWAY_SERVICE_KEY: randomBytes(32).toString("hex"),
  GATEWAY_API_KEY_PEPPER: randomBytes(32).toString("hex"), GATEWAY_ENCRYPTION_KEY: randomBytes(32).toString("hex"), LOG_LEVEL: "silent",
  ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
} });
let startupError = "";
child.stderr.on("data", data => { if (startupError.length < 4096) startupError += data.toString(); });
const exited = once(child, "exit");
try {
  const url = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let attempt = 0; attempt < 150; attempt++) {
    if (child.exitCode !== null) throw new Error(`Compiled server exited: ${startupError}`);
    try { if ((await fetch(url + "/ready", { signal: AbortSignal.timeout(1000) })).ok) { ready = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  if (!ready) throw new Error("Compiled server readiness timed out");
  if (!(await fetch(url + "/health")).ok || (await fetch(url + "/v1/payments")).status !== 401 || (await fetch(url + "/internal/v1/approvals")).status !== 404) throw new Error("Compiled route boundary failed");
  if (!(await fetch(url + "/assets/louma-logo.png")).ok) throw new Error("Compiled checkout assets missing");
  console.log("Compiled Node server: readiness, shared listener, merchant authentication, private boundary and assets verified");
} finally {
  if (child.exitCode === null) child.kill();
  await exited;
  await client.db(database).dropDatabase(); await client.close();
}
