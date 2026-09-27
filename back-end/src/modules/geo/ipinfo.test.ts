import { after, test } from "node:test";
import assert from "node:assert/strict";
import { isPublicIp, lookupIpLocation } from "./ipinfo.js";

const originalFetch = globalThis.fetch;

after(() => {
  globalThis.fetch = originalFetch;
});

/** Answers every lookup with one canned response, so the module can be tested without a network. */
function stubFetch(response: () => Response): string[] {
  const urls: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    urls.push(String(input));
    return response();
  }) as typeof fetch;
  return urls;
}

const jsonResponse = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });

test("keeps the address the caller connected from, and only adds what ipinfo knows", async () => {
  const urls = stubFetch(() =>
    jsonResponse({
      ip: "8.8.8.8",
      city: "Mountain View",
      region: "California",
      country: "US",
      org: "AS15169 Google LLC",
      timezone: "America/Los_Angeles",
    }),
  );
  const location = await lookupIpLocation({ ipAddress: "8.8.8.8", token: "test-token", timeoutMs: 1000 });
  assert.deepEqual(location, {
    ipAddress: "8.8.8.8",
    city: "Mountain View",
    region: "California",
    country: "US",
    org: "AS15169 Google LLC",
    timezone: "America/Los_Angeles",
  });
  const [url = ""] = urls;
  assert.match(url, /^https:\/\/ipinfo\.io\/8\.8\.8\.8\/json\?token=test-token$/);
});

test("a partial or unexpected payload becomes nulls, never undefined fields", async () => {
  stubFetch(() => jsonResponse({ ip: "1.1.1.1" }));
  assert.deepEqual(await lookupIpLocation({ ipAddress: "1.1.1.1", token: "test-token", timeoutMs: 1000 }), {
    ipAddress: "1.1.1.1",
    city: null,
    region: null,
    country: null,
    org: null,
    timezone: null,
  });
});

test("an error payload or a failing status is an error the caller can log", async () => {
  stubFetch(() => jsonResponse({ error: { title: "Rate limit exceeded" } }));
  await assert.rejects(lookupIpLocation({ ipAddress: "1.1.1.1", token: "test-token", timeoutMs: 1000 }));

  stubFetch(() => jsonResponse({}, 429));
  await assert.rejects(
    lookupIpLocation({ ipAddress: "1.1.1.1", token: "test-token", timeoutMs: 1000 }),
    /status 429/,
  );
});

test("a hostile address cannot climb out of the lookup path", async () => {
  const urls = stubFetch(() => jsonResponse({ ip: "1.1.1.1" }));
  await lookupIpLocation({ ipAddress: "8.8.8.8/../secret", token: "test-token", timeoutMs: 1000 });
  const [url = ""] = urls;
  assert.equal(new URL(url).pathname, "/8.8.8.8%2F..%2Fsecret/json");
});

test("only routable addresses are looked up", () => {
  for (const address of [
    "8.8.8.8",
    "1.1.1.1",
    "::ffff:8.8.8.8",
    "2001:4860:4860::8888",
  ]) {
    assert.equal(isPublicIp(address), true, address);
  }
  for (const address of [
    "127.0.0.1",
    "::1",
    "::",
    "0.0.0.0",
    "10.0.0.5",
    "172.16.3.1",
    "192.168.1.10",
    "169.254.10.10",
    "100.64.0.1",
    "192.0.2.10",
    "198.51.100.4",
    "203.0.113.7",
    "224.0.0.1",
    "255.255.255.255",
    "fc00::1",
    "fd12:3456::1",
    "fe80::1",
    "2001:db8::1",
    "::ffff:10.0.0.1",
    "not-an-ip",
    "10.0.0.256",
  ]) {
    assert.equal(isPublicIp(address), false, address);
  }
});
