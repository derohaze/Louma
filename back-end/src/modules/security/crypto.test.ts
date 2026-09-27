import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import {
  constantTimeEqual,
  createOpaqueToken,
  decryptSecret,
  encryptSecret,
  generateRecoveryCodes,
  hashRecoveryCode,
  hashToken,
} from "./crypto.js";

const key = randomBytes(32);

test("opaque tokens are long, URL-safe, and never repeat", () => {
  const first = createOpaqueToken();
  const second = createOpaqueToken();
  assert.notEqual(first, second);
  assert.ok(first.length >= 40);
  assert.match(first, /^[A-Za-z0-9_-]+$/);
});

test("a refresh token is only ever stored as its hash", () => {
  const token = createOpaqueToken();
  const hash = hashToken(token);
  assert.equal(hash, hashToken(token));
  assert.notEqual(hash, token);
  assert.match(hash, /^[0-9a-f]{64}$/);
  assert.notEqual(hash, hashToken(createOpaqueToken()));
});

test("encrypted secrets round-trip and never store the plaintext", () => {
  const secret = "JBSWY3DPEHPK3PXP";
  const encrypted = encryptSecret(secret, key);
  assert.notEqual(encrypted.encryptedSecret, secret);
  assert.equal(decryptSecret(encrypted, key), secret);
});

test("the same secret encrypts to different ciphertext every time", () => {
  const secret = "JBSWY3DPEHPK3PXP";
  const first = encryptSecret(secret, key);
  const second = encryptSecret(secret, key);
  assert.notEqual(first.encryptedSecret, second.encryptedSecret);
  assert.notEqual(first.iv, second.iv);
  assert.equal(decryptSecret(first, key), decryptSecret(second, key));
});

test("a tampered ciphertext, IV, or auth tag is rejected", () => {
  const secret = "JBSWY3DPEHPK3PXP";
  const encrypted = encryptSecret(secret, key);
  // Byte-level tampering: changing the last base64 character can leave the decoded bytes
  // untouched (padding bits), which would make the test pass for the wrong reason.
  const flip = (value: string) => {
    const bytes = Buffer.from(value, "base64url");
    bytes[0] = ((bytes[0] ?? 0) + 1) % 256;
    return bytes.toString("base64url");
  };
  assert.throws(() => decryptSecret({ ...encrypted, encryptedSecret: flip(encrypted.encryptedSecret) }, key));
  assert.throws(() => decryptSecret({ ...encrypted, iv: flip(encrypted.iv) }, key));
  assert.throws(() => decryptSecret({ ...encrypted, authTag: flip(encrypted.authTag) }, key));
});

test("a different key cannot decrypt the secret", () => {
  const encrypted = encryptSecret("JBSWY3DPEHPK3PXP", key);
  assert.throws(() => decryptSecret(encrypted, randomBytes(32)));
});

test("recovery codes are unique, single-use shaped, and hashed with a key", () => {
  const codes = generateRecoveryCodes();
  assert.equal(codes.length, 8);
  assert.equal(new Set(codes).size, 8);
  for (const code of codes) assert.match(code, /^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
});

test("a recovery code hash ignores case and dashes but not a different key", () => {
  const code = "ABCD-2345";
  assert.equal(hashRecoveryCode(code, key), hashRecoveryCode("abcd2345", key));
  assert.notEqual(hashRecoveryCode(code, key), hashRecoveryCode("ABCD-2346", key));
  assert.notEqual(hashRecoveryCode(code, key), hashRecoveryCode(code, randomBytes(32)));
});

test("constant-time comparison matches only identical strings", () => {
  assert.equal(constantTimeEqual("token-value", "token-value"), true);
  assert.equal(constantTimeEqual("token-value", "token-valu3"), false);
  assert.equal(constantTimeEqual("short", "much-longer-value"), false);
});
