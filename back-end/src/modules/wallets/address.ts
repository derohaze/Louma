import { createHash, randomBytes } from "node:crypto";

const PREFIX = "LMA";
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const ADDRESS_PATTERN = /^LMA[0-7][0-9A-HJKMNP-TV-Z]{27}$/;

/** Encodes exactly 128 random bits as 26 Crockford Base32 symbols plus a two-symbol checksum. */
export function encodeWalletAddress(randomness: Uint8Array): string {
  if (randomness.byteLength !== 16) throw new RangeError("Wallet address randomness must contain 16 bytes");

  let payloadBits = 0n;
  for (const byte of randomness) payloadBits = (payloadBits << 8n) | BigInt(byte);

  let payload = "";
  for (let shift = 125n; shift >= 0n; shift -= 5n) {
    payload += ALPHABET.charAt(Number((payloadBits >> shift) & 31n));
  }

  const checksumInput = `${PREFIX}:1:${payload}`;
  const checksumBits = createHash("sha256").update(checksumInput, "ascii").digest().readUInt16BE(0) >>> 6;
  const checksum = ALPHABET.charAt((checksumBits >>> 5) & 31) + ALPHABET.charAt(checksumBits & 31);
  return `${PREFIX}${payload}${checksum}`;
}

export function generateWalletAddress(): string {
  return encodeWalletAddress(randomBytes(16));
}

export function normalizeWalletAddress(address: string): string {
  return address.trim().toUpperCase();
}

export function isValidWalletAddress(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const address = normalizeWalletAddress(value);
  if (!ADDRESS_PATTERN.test(address)) return false;

  const payload = address.slice(PREFIX.length, -2);
  const checksumInput = `${PREFIX}:1:${payload}`;
  const checksumBits = createHash("sha256").update(checksumInput, "ascii").digest().readUInt16BE(0) >>> 6;
  const expected = ALPHABET.charAt((checksumBits >>> 5) & 31) + ALPHABET.charAt(checksumBits & 31);
  return address.endsWith(expected);
}

