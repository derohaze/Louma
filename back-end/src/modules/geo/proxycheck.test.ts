import { test } from "node:test";
import assert from "node:assert/strict";
import { lookupProxyCheckIntel, parseProxyCheckResponse } from "./proxycheck.js";

/**
 * proxycheck.io is mining-path-only intel (ipinfo stays on signup). These tests pin the parsing of
 * the provider's v3 schema and the degraded-mode contract: anything the provider does wrong (or
 * any reserved IP) yields null so mining keeps working, never a throw.
 */

const EXAMPLE_PAYLOAD = {
  status: "ok",
  "172.105.244.47": {
    network: { asn: "AS63949", range: "172.105.244.0/22", hostname: null, provider: "Akamai Technologies, Inc.", organisation: "Linode", type: "Hosting" },
    location: {
      continent_name: "Europe", continent_code: "EU", country_name: "Germany", country_code: "DE",
      region_name: "Hesse", region_code: "HE", city_name: "Frankfurt am Main", postal_code: "60313",
      latitude: 50.1109, longitude: 8.6821, timezone: "Europe/Berlin",
      currency: { name: "Euro", code: "EUR", symbol: "€" },
    },
    device_estimate: { address: 0, subnet: 38 },
    detections: {
      proxy: false, vpn: false, compromised: false, scraper: false, tor: false,
      hosting: true, anonymous: false, risk: 33, confidence: 100,
      first_seen: null, last_seen: null, times_seen: null,
    },
    detection_history: null, attack_history: null, operator: null, last_updated: "2026-09-29T16:03:29Z",
  },
  query_time: 3,
};

test("parses a hosting IP with its detections, ASN, and country", () => {
  const intel = parseProxyCheckResponse("172.105.244.47", EXAMPLE_PAYLOAD);
  assert.ok(intel);
  assert.equal(intel.asn, "AS63949");
  assert.equal(intel.country, "DE");
  assert.equal(intel.vpn, false);
  assert.equal(intel.proxy, false);
  assert.equal(intel.tor, false);
  assert.equal(intel.hosting, true);
  assert.equal(intel.anonymous, false);
  assert.equal(intel.risk, 33);
});

test("flags a VPN exit as evidence, not as a verdict", () => {
  const payload = {
    status: "ok",
    "5.6.7.8": {
      network: { asn: "AS123" },
      location: { country_code: "NL" },
      detections: { proxy: true, vpn: true, tor: false, hosting: false, anonymous: true, risk: 81 },
    },
  };
  const intel = parseProxyCheckResponse("5.6.7.8", payload);
  assert.ok(intel);
  assert.equal(intel.vpn, true);
  assert.equal(intel.proxy, true);
  assert.equal(intel.risk, 81);
});

test("denied, malformed, and mismatched payloads degrade to null", () => {
  assert.equal(parseProxyCheckResponse("1.2.3.4", { status: "denied", message: "over quota" }), null);
  assert.equal(parseProxyCheckResponse("1.2.3.4", null), null);
  assert.equal(parseProxyCheckResponse("1.2.3.4", { status: "ok" }), null);
  assert.equal(parseProxyCheckResponse("1.2.3.4", { status: "ok", "9.9.9.9": {} }), null);
});

test("reserved IPs never reach the provider and failures never throw", async () => {
  let calls = 0;
  const realFetch = globalThis.fetch;
  (globalThis as Record<string, unknown>)["fetch"] = async () => {
    calls += 1;
    throw new Error("must not be called");
  };
  try {
    assert.equal(await lookupProxyCheckIntel({ ipAddress: "10.0.0.5", key: "k", timeoutMs: 100 }), null);
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = realFetch;
  }

  (globalThis as Record<string, unknown>)["fetch"] = async () => {
    throw new Error("network down");
  };
  try {
    assert.equal(await lookupProxyCheckIntel({ ipAddress: "8.8.8.8", key: "k", timeoutMs: 100 }), null);
  } finally {
    globalThis.fetch = realFetch;
  }

  (globalThis as Record<string, unknown>)["fetch"] = async () =>
    ({ ok: false, status: 429, json: async () => ({}) }) as Response;
  try {
    assert.equal(await lookupProxyCheckIntel({ ipAddress: "8.8.8.8", key: "k", timeoutMs: 100 }), null);
  } finally {
    globalThis.fetch = realFetch;
  }
});
