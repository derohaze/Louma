import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { createServer } from "node:http";
import { gatewayRequest, gatewaySignature } from "./client.js";
import { loadPaymentGatewayConfig } from "./config.js";

const serviceKey = "0123456789abcdef0123456789abcdef";

test("gateway signing binds owner, method, URI, nonce, timestamp, and exact body bytes", () => {
  const request = { serviceKey, timestamp: "1791400000", nonce: "b5b2aec8-4cb1-4dcd-bf86-d9060902cb47", method: "POST", requestUri: "/internal/v1/applications", ownerUserId: "e7f6954f-1731-40da-91b1-07e2bbf85dc2", rawBody: '{"name":"مكتب","wallet_id":"123"}' };
  const digest = createHash("sha256").update(request.rawBody).digest("hex");
  const expected = createHmac("sha256", serviceKey).update(`${request.timestamp}\n${request.nonce}\nPOST\n${request.requestUri}\n${request.ownerUserId}\n${digest}`).digest("hex");
  assert.equal(gatewaySignature(request), expected);
  for (const changed of [{ ownerUserId: "other" }, { method: "GET" }, { requestUri: "/internal/v1/applications?cursor=1" }, { rawBody: `${request.rawBody} ` }, { nonce: "reused" }, { timestamp: "1791400001" }]) assert.notEqual(gatewaySignature({ ...request, ...changed }), expected);
});

test("gateway config is disabled by default and rejects insecure or cross-environment configuration", () => {
  assert.deepEqual(loadPaymentGatewayConfig({}), { test: null, live: null });
  for (const url of ["http://example.com", "https://user:password@example.com", "https://example.com/path", "https://example.com?x=y", "https://example.com#secret"]) assert.throws(() => loadPaymentGatewayConfig({ PAYMENT_GATEWAY_LIVE_URL: url, PAYMENT_GATEWAY_LIVE_SERVICE_KEY: serviceKey }));
  assert.throws(() => loadPaymentGatewayConfig({ NODE_ENV: "production", PAYMENT_GATEWAY_TEST_URL: "http://localhost:8001", PAYMENT_GATEWAY_TEST_SERVICE_KEY: serviceKey }));
  assert.throws(() => loadPaymentGatewayConfig({ PAYMENT_GATEWAY_TEST_URL: "https://test.example.com" }));
  assert.throws(() => loadPaymentGatewayConfig({ PAYMENT_GATEWAY_TEST_URL: "https://test.example.com", PAYMENT_GATEWAY_TEST_SERVICE_KEY: serviceKey, PAYMENT_GATEWAY_LIVE_URL: "https://live.example.com", PAYMENT_GATEWAY_LIVE_SERVICE_KEY: serviceKey }));
  assert.equal(loadPaymentGatewayConfig({ PAYMENT_GATEWAY_TEST_URL: "http://127.0.0.1:8001", PAYMENT_GATEWAY_TEST_SERVICE_KEY: serviceKey }).test?.url, "http://127.0.0.1:8001");
});

test("gateway HTTP client signs bytes delivered to an actual local listener without forwarding customer credentials", async () => {
  const server = createServer(async (request, reply) => {
    let body = "";
    for await (const chunk of request) body += String(chunk);
    const timestamp = String(request.headers["x-louma-timestamp"]);
    const nonce = String(request.headers["x-louma-nonce"]);
    assert.match(nonce, /^[a-f0-9-]{36}$/);
    assert.equal(request.headers["authorization"], undefined);
    assert.equal(request.headers["cookie"], undefined);
    assert.equal(request.headers["x-louma-signature"], gatewaySignature({ serviceKey, timestamp, nonce, method: request.method!, requestUri: request.url!, ownerUserId: String(request.headers["x-louma-user"]), rawBody: body }));
    assert.equal(body, '{"name":"Merchant"}');
    reply.writeHead(201, { "Content-Type": "application/json" });
    reply.end('{"id":"created"}');
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    assert.deepEqual(await gatewayRequest({ connection: { url: `http://127.0.0.1:${address.port}`, serviceKey }, ownerUserId: "owner", method: "POST", path: "/internal/v1/applications", body: { name: "Merchant" } }), { id: "created" });
    await assert.rejects(gatewayRequest({ connection: null, ownerUserId: "owner", method: "GET", path: "/internal/v1/applications" }), /unavailable/);
  } finally { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
});
