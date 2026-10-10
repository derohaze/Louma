import { test } from "node:test";
import assert from "node:assert/strict";
import { createCipheriv, randomBytes } from "node:crypto";
import {
  calculateFee,
  formatMoney,
  MAX_AMOUNT,
  parseMoney,
} from "../domain/money.js";
import { period } from "../infrastructure/billing.js";
import {
  decrypt,
  encrypt,
  publicIp,
  returnUrl,
  signature,
  verifySignature,
  webhookUrl,
} from "../security.js";
import { fingerprint } from "../service.js";
test("decimal money and fees stay exact at the ceiling and reject ambiguous values", () => {
  for (const value of ["0", "0.0001", "1.25", "900719925474.0000"]) {
    const minor = parseMoney(value);
    assert.equal(parseMoney(formatMoney(minor)), minor);
  }
  assert.equal(parseMoney("900719925474.0000"), MAX_AMOUNT);
  for (const value of [
    "01",
    "-1",
    "1e3",
    " 1",
    "1.00001",
    "900719925474.0001",
    "NaN",
    "Infinity",
  ])
    assert.throws(() => parseMoney(value));
  for (const total of [1, 100, 10001, MAX_AMOUNT])
    assert.equal(
      calculateFee(total, { version: "v1", basisPoints: 100 }),
      Number((BigInt(total) * 100n + 5000n) / 10000n),
    );
  assert.throws(() => calculateFee(1, { version: "v1", basisPoints: 9999 }));
});
test("calendar renewal preserves the original day, time and leap-year anchor", () => {
  const anchor = new Date("2024-01-31T12:34:56.789Z");
  assert.equal(
    period(anchor, "month", 1).toISOString(),
    "2024-02-29T12:34:56.789Z",
  );
  assert.equal(
    period(anchor, "month", 2).toISOString(),
    "2024-03-31T12:34:56.789Z",
  );
  assert.equal(
    period(new Date("2024-02-29T00:00:00Z"), "year", 1).toISOString(),
    "2025-02-28T00:00:00.000Z",
  );
  assert.throws(() => period(anchor, "week", 1));
  assert.throws(() => period(anchor, "month", 1201));
});
test("webhook ciphertext reads the existing nonce/ciphertext/tag format and rejects tampering", () => {
  const key = randomBytes(32),
    nonce = Buffer.alloc(12, 7),
    cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(Buffer.from("louma-webhook-v1"));
  const legacy = Buffer.concat([
    nonce,
    cipher.update("existing-secret"),
    cipher.final(),
    cipher.getAuthTag(),
  ])
    .toString("base64")
    .replace(/=+$/, "");
  assert.equal(decrypt(key, legacy), "existing-secret");
  assert.equal(decrypt(key, encrypt(key, "سر")), "سر");
  assert.throws(() => decrypt(randomBytes(32), legacy));
  assert.throws(() => decrypt(key, legacy.slice(0, -1) + "!"));
});
test("webhook signatures enforce raw bytes, bounded time skew and constant-length MACs", () => {
  const now = 1700000000000,
    body = '{"id":"event"}',
    key = "test";
  const signed = signature(key, body, now);
  assert.equal(verifySignature(key, body, signed, now + 300000), true);
  assert.equal(verifySignature(key, body, signed, now + 301000), false);
  assert.equal(verifySignature(key, body, signed, now - 31000), false);
  assert.equal(verifySignature(key, body + " ", signed, now), false);
  assert.equal(verifySignature(key, body, signed + "\n", now), false);
});
test("webhook destinations block private, mapped, metadata, reserved and transition ranges", () => {
  for (const ip of [
    "127.0.0.1",
    "10.0.0.1",
    "169.254.169.254",
    "100.64.0.1",
    "192.168.1.1",
    "192.0.2.1",
    "198.18.0.1",
    "224.0.0.1",
    "::1",
    "fd00::1",
    "fe80::1",
    "::ffff:127.0.0.1",
    "64:ff9b::a00:1",
    "2002:7f00:1::",
    "2001:db8::1",
  ])
    assert.equal(publicIp(ip), false, ip);
  for (const ip of ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"])
    assert.equal(publicIp(ip), true, ip);
  for (const url of [
    "http://example.com",
    "https://127.0.0.1",
    "https://2130706433",
    "https://[::1]",
    "https://user:pass@example.com",
    "https://example.com:8443",
    "https://example.com/#x",
  ])
    assert.throws(() => webhookUrl(url));
});
test("return URLs require exact registered hosts and reject credential tricks", () => {
  returnUrl("https://shop.example/order", ["shop.example"], false);
  for (const url of [
    "https://shop.example.evil/order",
    "https://shop.example@evil.test/",
    "https://evil.test@shop.example/",
    "http://shop.example/",
    "//shop.example/",
  ])
    assert.throws(() => returnUrl(url, ["shop.example"], false));
});
test("fingerprinting retains Go JSON escaping for legacy durable replay", () => {
  assert.equal(
    fingerprint({ Name: "<merchant>&", Wallet: "x", Domains: [] }),
    "5eb0799da5573238695cbd6ecd946c7c9b072e23bfe3833ee022a912754c5a3d",
  );
  assert.notEqual(fingerprint({ value: 1 }), fingerprint({ value: 2 }));
});
