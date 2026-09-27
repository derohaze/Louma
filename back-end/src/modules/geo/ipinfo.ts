import { z } from "zod";

/**
 * ipinfo.io is the backend's only third-party dependency. Nothing in this module sits on the
 * registration path: the account (and its IP) is stored first, and the lookup can only add fields
 * afterwards, so a missing token, a slow answer, or an outage has no way to fail a signup.
 */
export interface IpLocation {
  ipAddress: string;
  city: string | null;
  region: string | null;
  country: string | null;
  org: string | null;
  timezone: string | null;
}

const ipinfoResponseSchema = z.object({
  ip: z.string().min(1).max(45),
  city: z.string().max(128).optional(),
  region: z.string().max(128).optional(),
  country: z.string().length(2).optional(),
  org: z.string().max(256).optional(),
  timezone: z.string().max(64).optional(),
});

/**
 * Addresses a lookup service has nothing to say about: loopback, private, link-local, carrier-grade
 * NAT, documentation, multicast and reserved ranges. Local development always lands here, which is
 * the point — a reserved address is skipped instead of being sent to a metered lookup service. An
 * address that does not parse is treated the same way, because guessing would send garbage upstream.
 */
function isReservedIpv4(address: string): boolean {
  const octets = address.split(".").map((octet) => (/^\d{1,3}$/.test(octet) ? Number(octet) : NaN));
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return true;
  const [first = -1, second = -1, third = -1] = octets;
  if (first === 0 || first === 10 || first === 127) return true;
  if (first === 169 && second === 254) return true;
  if (first === 172 && second >= 16 && second <= 31) return true;
  if (first === 192 && second === 168) return true;
  if (first === 100 && second >= 64 && second <= 127) return true;
  if (first === 192 && second === 0 && third === 0) return true;
  if (first === 198 && (second === 18 || second === 19)) return true;
  // Documentation ranges: never a real client, and a lookup service answers them with a bogon.
  if (first === 192 && second === 0 && third === 2) return true;
  if (first === 198 && second === 51 && third === 100) return true;
  if (first === 203 && second === 0 && third === 113) return true;
  // 224.0.0.0/4 multicast and everything above it (reserved and broadcast) is never a client.
  return first >= 224;
}

export function isPublicIp(address: string): boolean {
  const value = address.trim().toLowerCase();
  // `::ffff:203.0.113.7` is an IPv4 address wearing an IPv6 prefix.
  const plain = value.startsWith("::ffff:") ? value.slice("::ffff:".length) : value;
  if (!plain.includes(":")) return !isReservedIpv4(plain);
  if (plain === "::" || plain === "::1") return false;
  // fc00::/7 unique-local, fe80::/10 link-local, 2001:db8::/32 documentation.
  if (plain.startsWith("fc") || plain.startsWith("fd")) return false;
  if (plain.startsWith("fe80")) return false;
  if (plain.startsWith("2001:db8")) return false;
  return true;
}

/**
 * Resolves one address. The token travels in the query string, so the request URL is never logged
 * and never attached to an error: a leaked URL would be a leaked token.
 */
export async function lookupIpLocation(input: {
  ipAddress: string;
  token: string;
  timeoutMs: number;
}): Promise<IpLocation> {
  const url = new URL(`https://ipinfo.io/${encodeURIComponent(input.ipAddress)}/json`);
  url.searchParams.set("token", input.token);
  const response = await fetch(url, {
    signal: AbortSignal.timeout(input.timeoutMs),
    headers: { accept: "application/json" },
  });
  if (!response.ok) throw new Error(`ipinfo lookup failed with status ${response.status}`);
  const payload: unknown = await response.json().catch(() => null);
  const parsed = ipinfoResponseSchema.safeParse(payload);
  if (!parsed.success) throw new Error("ipinfo lookup returned an unexpected payload");
  return {
    // The address the caller connected from stays authoritative; ipinfo only normalises what it saw.
    ipAddress: input.ipAddress,
    city: parsed.data.city ?? null,
    region: parsed.data.region ?? null,
    country: parsed.data.country ?? null,
    org: parsed.data.org ?? null,
    timezone: parsed.data.timezone ?? null,
  };
}
