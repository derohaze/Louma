import assert from "node:assert/strict";
import { test } from "node:test";
import { encodeWalletAddress, generateWalletAddress, isValidWalletAddress, normalizeWalletAddress } from "./address.js";
import { withWalletAddressCollisionRetry } from "./service.js";

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

test("canonical wallet addresses use 128 random bits, the restricted alphabet, and a checksum", () => {
  const address = generateWalletAddress();
  assert.equal(address.length, 31);
  assert.match(address, /^LMA[0-7][0-9A-HJKMNP-TV-Z]{27}$/);
  assert.ok([...address.slice(3)].every((character) => ALPHABET.includes(character)));
  assert.ok(isValidWalletAddress(address));
  assert.equal(isValidWalletAddress(address.toLowerCase()), true);
});

test("address normalization and checksum reject altered or malformed input", () => {
  const address = generateWalletAddress();
  assert.equal(normalizeWalletAddress(` ${address.toLowerCase()} `), address);
  const replacement = address.at(-1) === "0" ? "1" : "0";
  assert.equal(isValidWalletAddress(`${address.slice(0, -1)}${replacement}`), false);
  for (const invalid of ["LMB" + address.slice(3), address.slice(0, -1), address.slice(0, 3) + "I" + address.slice(4), "LMA-0000-0000-0000"]) {
    assert.equal(isValidWalletAddress(invalid), false, `${invalid} is rejected`);
  }
});

test("the 128-bit encoder has a deterministic, version-bound test vector", () => {
  const randomness = Uint8Array.from({ length: 16 }, (_value, index) => index);
  assert.equal(encodeWalletAddress(randomness), "LMA00041061050R3GG28A1C60T3GFEG");
});

test("wallet creation retries only a duplicate canonical address and returns the next candidate", async () => {
  const candidates = ["taken", "fresh"];
  const accepted = new Set(["taken"]);
  let attempts = 0;
  const result = await withWalletAddressCollisionRetry(async () => {
    const candidate = candidates[attempts++]!;
    if (accepted.has(candidate)) throw { code: 11000, keyPattern: { addressNormalized: 1 } };
    accepted.add(candidate);
    return candidate;
  });
  assert.equal(result, "fresh");
  assert.equal(attempts, 2);
});

test("wallet creation does not retry other unique-index failures and bounds address collisions", async () => {
  let attempts = 0;
  const otherDuplicate = { code: 11000, keyPattern: { publicId: 1 } };
  await assert.rejects(withWalletAddressCollisionRetry(async () => {
    attempts += 1;
    throw otherDuplicate;
  }), (error: unknown) => error === otherDuplicate);
  assert.equal(attempts, 1);

  attempts = 0;
  const finalCollision = { code: 11000, keyPattern: { addressNormalized: 1 } };
  await assert.rejects(withWalletAddressCollisionRetry(async () => {
    attempts += 1;
    throw finalCollision;
  }), (error: unknown) => error === finalCollision);
  assert.equal(attempts, 3);
});
