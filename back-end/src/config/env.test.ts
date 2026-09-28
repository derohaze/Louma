import { test } from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "./env.js";

/**
 * `TRUST_PROXY` decides whether `request.ip` is the socket address or a header a client controls,
 * and registration stores that address while the rate limiter counts by it. The parser is therefore
 * tested through `loadConfig`, which is the only way the setting reaches the server.
 */
const base = {
  MONGODB_URI: "mongodb://127.0.0.1:27017/louma",
  MONGODB_DATABASE: "louma",
  ACCESS_TOKEN_SECRET: Buffer.alloc(32, 1).toString("base64"),
  APP_ENCRYPTION_KEY: Buffer.alloc(32, 2).toString("base64"),
};

test("proxy trust is off unless a proxy is named", () => {
  assert.equal(loadConfig({ ...base }).trustProxy, false);
  assert.equal(loadConfig({ ...base, TRUST_PROXY: "false" }).trustProxy, false);
  assert.equal(loadConfig({ ...base, TRUST_PROXY: "  " }).trustProxy, false);
});

test("named addresses and CIDRs become the trusted-proxy list", () => {
  assert.deepEqual(loadConfig({ ...base, TRUST_PROXY: "10.0.0.0/8, 192.168.1.7" }).trustProxy, [
    "10.0.0.0/8",
    "192.168.1.7",
  ]);
  assert.deepEqual(loadConfig({ ...base, TRUST_PROXY: "2001:db8::/32" }).trustProxy, ["2001:db8::/32"]);
});

test("a setting that believes every hop is refused", () => {
  // `0.0.0.0/0` and `::/0` are `*` written as a range, so they cannot be the way in either.
  for (const value of ["true", "*", "0.0.0.0/0", "::/0", "10.0.0.0/8,0.0.0.0/0", "not-an-ip"]) {
    assert.throws(() => loadConfig({ ...base, TRUST_PROXY: value }), /TRUST_PROXY/, value);
  }
});
