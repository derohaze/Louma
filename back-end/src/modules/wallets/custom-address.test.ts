import { test } from "node:test";
import assert from "node:assert/strict";
import { isValidCustomAddress } from "./custom-address.js";
import { parseRecipientAddress } from "../transfers/intent.js";
import { generateWalletAddress } from "./address.js";

test("custom addresses accept 3–16 ASCII letters/digits with a leading letter", () => {
  for (const value of ["Ali", "a12", "ALI123", "Lma", "A".repeat(16)]) {
    assert.equal(isValidCustomAddress(value), true, value);
    assert.equal(parseRecipientAddress(value), value.toLowerCase());
  }
  for (const value of ["", "ab", "a".repeat(17), "12a", "@Ali", "ali_moh", "ali-moh", "ali moh", " Ali", "Ali ", "Ali\n", "علي", "éabc", "Ａli", "a１２", "a!b"]) {
    assert.equal(isValidCustomAddress(value), false, value);
    assert.throws(() => parseRecipientAddress(value), { code: "invalid_recipient" }, value);
  }
  assert.equal(isValidCustomAddress(null), false);
  assert.equal(isValidCustomAddress(123), false);
  const canonical = generateWalletAddress();
  assert.equal(parseRecipientAddress(canonical.toLowerCase()), canonical);
});
