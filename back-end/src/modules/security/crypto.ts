import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export function createOpaqueToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function hashRecoveryCode(code: string, key: Buffer): string {
  return createHmac("sha256", key).update(`louma-recovery-code:${code.replace(/-/g, "").toUpperCase()}`).digest("hex");
}

export function constantTimeEqual(first: string, second: string): boolean {
  const firstBuffer = Buffer.from(first);
  const secondBuffer = Buffer.from(second);
  return firstBuffer.length === secondBuffer.length && timingSafeEqual(firstBuffer, secondBuffer);
}

export function encryptSecret(plaintext: string, key: Buffer): {
  encryptedSecret: string;
  iv: string;
  authTag: string;
} {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encryptedSecret = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return {
    encryptedSecret: encryptedSecret.toString("base64url"),
    iv: iv.toString("base64url"),
    authTag: cipher.getAuthTag().toString("base64url"),
  };
}

export function decryptSecret(input: {
  encryptedSecret: string;
  iv: string;
  authTag: string;
}, key: Buffer): string {
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(input.iv, "base64url"));
  decipher.setAuthTag(Buffer.from(input.authTag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(input.encryptedSecret, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

export function generateRecoveryCodes(count = 8): string[] {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: count }, () => {
    const bytes = randomBytes(8);
    const code = [...bytes].map((byte) => alphabet[byte % alphabet.length]).join("");
    return `${code.slice(0, 4)}-${code.slice(4)}`;
  });
}
