import { test } from "node:test";
import assert from "node:assert/strict";
import { generate, generateSecret } from "otplib";
import { verifyTotpToken } from "./totp.js";

const otherSecret = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";

test("accepts a code generated from the same secret", async () => {
  const secret = generateSecret();
  assert.equal(await verifyTotpToken(secret, await generate({ secret })), true);
});

test("rejects a code from another secret", async () => {
  const secret = generateSecret();
  assert.equal(await verifyTotpToken(secret, await generate({ secret: otherSecret })), false);
});

test("answers false for anything that is not six digits, instead of throwing", async () => {
  const secret = generateSecret();
  // Recovery codes and malformed input reach the same function: it must not throw, because the
  // caller falls through to its recovery-code check on `false`.
  for (const token of ["ABCD-2345", "abcd2345", "12345", "1234567", "12345a", "", "   ", "123456\n"]) {
    assert.equal(await verifyTotpToken(secret, token), false, JSON.stringify(token));
  }
});
