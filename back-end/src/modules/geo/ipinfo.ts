import { isIPv6 } from "node:net";
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

/**
 * Expands an IPv6 literal into its eight 16-bit groups, or null when it is not one. A zone index is
 * dropped and an embedded dotted-quad is folded into the last two groups, so the range checks below
 * compare real numbers instead of string prefixes.
 */
function expandIpv6(address: string): number[] | null {
  const zone = address.indexOf("%");
  const value = (zone >= 0 ? address.slice(0, zone) : address).toLowerCase();
  if (!isIPv6(value)) return null;

  const embedded = value.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  const trailing: number[] = [];
  let working = value;
  if (embedded?.[1]) {
    const octets = embedded[1].split(".").map(Number);
    if (octets.some((octet) => octet < 0 || octet > 255)) return null;
    trailing.push(((octets[0] ?? 0) << 8) | (octets[1] ?? 0), ((octets[2] ?? 0) << 8) | (octets[3] ?? 0));
    // The quad is preceded by the separator that joins it to the rest. A single colon has to go with
    // it — `::ffff:8.8.8.8` leaves `::ffff` — but a `::` compression does not, or `2001:4860::8.8.8.8`
    // would lose one of its two colons and stop parsing as a global address.
    const head = value.slice(0, value.length - embedded[1].length);
    working = head.endsWith("::") ? head : head.replace(/:$/, "");
  }

  const halves = working.split("::");
  if (halves.length > 2) return null;
  const parseGroups = (part: string): number[] | null => {
    if (part === "") return [];
    const groups = part.split(":").map((group) => (/^[0-9a-f]{1,4}$/.test(group) ? parseInt(group, 16) : -1));
    return groups.some((group) => group < 0) ? null : groups;
  };
  const head = parseGroups(halves[0] ?? "");
  const tail = halves.length === 2 ? parseGroups(halves[1] ?? "") : [];
  if (head === null || tail === null) return null;

  const groups = halves.length === 2
    ? [...head, ...new Array<number>(Math.max(0, 8 - head.length - tail.length - trailing.length)).fill(0), ...tail, ...trailing]
    : [...head, ...trailing];
  return groups.length === 8 ? groups : null;
}

/**
 * The IPv6 ranges a lookup service has nothing to say about. Parsing, not string prefixes, is what
 * gets this right: `feb0::1` is inside `fe80::/10` but does not start with `fe80`, so a prefix check
 * would have sent a non-routable address to the metered service.
 */
function isReservedIpv6(address: string): boolean {
  const groups = expandIpv6(address);
  if (!groups) return true;
  const [g0 = 0, g1 = 0, g2 = 0, g3 = 0, g4 = 0, g5 = 0, g6 = 0, g7 = 0] = groups;
  // ::ffff:0:0/96 IPv4-mapped: judge the embedded IPv4 address instead.
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0xffff) {
    return isReservedIpv4(`${g6 >> 8}.${g6 & 0xff}.${g7 >> 8}.${g7 & 0xff}`);
  }
  // All of 0000::/8 — unspecified, loopback, IPv4-compatible — is non-global.
  if (g0 === 0) return true;
  if ((g0 & 0xfe00) === 0xfc00) return true; // fc00::/7 unique-local
  if ((g0 & 0xffc0) === 0xfe80 || (g0 & 0xffc0) === 0xfec0) return true; // fe80::/10 link-local, fec0::/10 site-local
  if ((g0 & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  if (g0 === 0x2001 && (g1 === 0x0db8 || g1 === 0x0002)) return true; // documentation, benchmarking
  if (g0 === 0x0100 && g1 === 0 && g2 === 0 && g3 === 0) return true; // 100::/64 discard-only
  return false;
}

export function isPublicIp(address: string): boolean {
  const value = address.trim().toLowerCase();
  if (!value.includes(":")) return !isReservedIpv4(value);
  return !isReservedIpv6(value);
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
