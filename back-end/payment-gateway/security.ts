import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { BlockList, isIP } from "node:net";
import { reject } from "./domain/money.js";
export const hash = (value: string): string =>
  createHash("sha256").update(value).digest("hex");
export const mac = (key: string, value: string): string =>
  createHmac("sha256", key).update(value).digest("hex");
export const secret = (): string => randomBytes(32).toString("base64url");
const AAD = Buffer.from("louma-webhook-v1");
export function encrypt(key: Buffer, plaintext: string): string {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(AAD);
  return Buffer.concat([
    nonce,
    cipher.update(plaintext, "utf8"),
    cipher.final(),
    cipher.getAuthTag(),
  ])
    .toString("base64")
    .replace(/=+$/, "");
}
export function decrypt(key: Buffer, value: string): string {
  if (!/^[A-Za-z0-9+/]+$/.test(value))
    throw new Error("Invalid encrypted secret");
  const bytes = Buffer.from(value, "base64");
  if (
    bytes.length < 28 ||
    bytes.toString("base64").replace(/=+$/, "") !== value
  )
    throw new Error("Invalid encrypted secret");
  const cipher = createDecipheriv("aes-256-gcm", key, bytes.subarray(0, 12));
  cipher.setAAD(AAD);
  cipher.setAuthTag(bytes.subarray(-16));
  return Buffer.concat([
    cipher.update(bytes.subarray(12, -16)),
    cipher.final(),
  ]).toString("utf8");
}
export function signature(key: string, body: string, now = Date.now()): string {
  const timestamp = String(Math.floor(now / 1000));
  return `t=${timestamp},v1=${mac(key, timestamp + "." + body)}`;
}
export function verifySignature(
  key: string,
  body: string,
  value: string,
  now = Date.now(),
): boolean {
  const parts = /^t=(\d{1,12}),v1=([a-f0-9]{64})$/.exec(value);
  if (!parts) return false;
  const timestamp = Number(parts[1]);
  if (
    timestamp < Math.floor(now / 1000) - 300 ||
    timestamp > Math.floor(now / 1000) + 30
  )
    return false;
  return timingSafeEqual(
    Buffer.from(parts[2]!, "hex"),
    Buffer.from(mac(key, parts[1] + "." + body), "hex"),
  );
}
export function returnUrl(raw: string, domains: string[], test: boolean): void {
  if (!raw) return;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return reject("invalid_return_url");
  }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  const authority = /^[a-z]+:\/\/([^/?#]+)/i.exec(raw)?.[1];
  if (
    raw.length > 2048 ||
    /[\r\n\\]/.test(raw) ||
    url.username ||
    url.password ||
    !authority ||
    !domains.includes(authority) ||
    (url.protocol !== "https:" && !(test && local && url.protocol === "http:"))
  )
    reject("invalid_return_url");
}
const blocked = new BlockList();
const blockedV6 = new BlockList();
for (const [network, bits] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const)
  blocked.addSubnet(network, bits, "ipv4");
for (const [network, bits] of [
  ["::", 96],
  ["::ffff:0:0", 96],
  ["64:ff9b::", 96],
  ["100::", 64],
  ["2001:db8::", 32],
  ["2001::", 32],
  ["2002::", 16],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const)
  blockedV6.addSubnet(network, bits, "ipv6");
export function publicIp(address: string): boolean {
  const family = isIP(address);
  return family === 4
    ? !blocked.check(address, "ipv4")
    : family === 6 &&
        !blockedV6.check(address, "ipv6") &&
        !blocked.check(address, "ipv6");
}
export function webhookUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return reject("invalid_webhook_url");
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.hash ||
    raw.length > 2048 ||
    (url.port && url.port !== "443") ||
    /[\r\n\\]/.test(raw)
  )
    return reject("invalid_webhook_url");
  if (isIP(host) && !publicIp(host))
    return reject("restricted_webhook_destination");
  return url;
}
/** Resolve every answer, validate all, pin the socket while TLS verifies the original hostname. */
export async function sendWebhook(
  raw: string,
  body: string,
  headers: Record<string, string>,
): Promise<number> {
  const url = webhookUrl(raw);
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const deadline = AbortSignal.timeout(8000);
  const addresses = await new Promise<Awaited<ReturnType<typeof lookup>>[]>(
    (resolve, rejectPromise) => {
      const abort = () => rejectPromise(new Error("Webhook DNS timeout"));
      deadline.addEventListener("abort", abort, { once: true });
      lookup(host, { all: true }).then(
        (rows) => {
          deadline.removeEventListener("abort", abort);
          resolve(rows);
        },
        (error) => {
          deadline.removeEventListener("abort", abort);
          rejectPromise(error);
        },
      );
    },
  );
  if (
    !addresses.length ||
    addresses.length > 16 ||
    addresses.some((row) => !publicIp(row.address))
  )
    throw new Error("Restricted webhook destination");
  const address = addresses[0]!;
  return new Promise<number>((resolve, rejectPromise) => {
    const req = request(
      url,
      {
        method: "POST",
        agent: false,
        signal: deadline,
        timeout: 3000,
        lookup: (_hostname, options, callback) => {
          if (options.all) callback(null, [address]);
          else callback(null, address.address, address.family);
        },
        headers: {
          ...headers,
          "Content-Type": "application/json",
          "Content-Length": String(Buffer.byteLength(body)),
        },
      },
      (response) => {
        const status = response.statusCode ?? 0;
        response.destroy();
        resolve(status);
      },
    );
    req.once("timeout", () => req.destroy(new Error("Webhook timeout")));
    req.once("error", rejectPromise);
    req.end(body);
  });
}
