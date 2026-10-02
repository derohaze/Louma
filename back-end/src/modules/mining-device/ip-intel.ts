import type { AppConfig } from "../../config/env.js";
import { isPublicIp, lookupIpLocation } from "../geo/ipinfo.js";
import { lookupProxyCheckIntel, type ProxyCheckIntel } from "../geo/proxycheck.js";

export interface IpIntel {
  asn: string | null;
  country: string | null;
  /** proxycheck detections; all false/unknown when the provider is disabled or degraded. */
  vpn: boolean;
  proxy: boolean;
  tor: boolean;
  hosting: boolean;
  anonymous: boolean;
  providerRisk: number | null;
}

const ipIntelCache = new Map<string, { intel: IpIntel; cachedAtMs: number }>();

/**
 * Bounded in-process cache: the TTL alone stops reuse of stale intelligence but never removes
 * entries, so a long-running service resolving continually changing public IPs would grow without
 * end. Inserts evict expired entries first, then the oldest, keeping the map at a fixed ceiling.
 */
const IP_INTEL_CACHE_MAX_ENTRIES = 1000;

function cacheIpIntel(ip: string, intel: IpIntel, nowMs: number, ttlMs: number): void {
  ipIntelCache.set(ip, { intel, cachedAtMs: nowMs });
  if (ipIntelCache.size <= IP_INTEL_CACHE_MAX_ENTRIES) return;
  for (const [key, entry] of ipIntelCache) {
    if (ipIntelCache.size <= IP_INTEL_CACHE_MAX_ENTRIES) break;
    if (nowMs - entry.cachedAtMs >= ttlMs) ipIntelCache.delete(key);
  }
  while (ipIntelCache.size > IP_INTEL_CACHE_MAX_ENTRIES) {
    const oldest = ipIntelCache.keys().next();
    if (oldest.done) break;
    ipIntelCache.delete(oldest.value);
  }
}

function parseAsn(org: string | null): string | null {
  if (!org) return null;
  const match = /AS(\d+)/i.exec(org);
  return match?.[1] ? `AS${match[1].toUpperCase()}` : org.slice(0, 64).toUpperCase();
}

const UNKNOWN_INTEL: IpIntel = { asn: null, country: null, vpn: false, proxy: false, tor: false, hosting: false, anonymous: false, providerRisk: null };

export async function resolveIpIntel(input: {
  config: Pick<AppConfig, "ipinfoToken" | "ipinfoTimeoutMs" | "proxycheckKey" | "proxycheckTimeoutMs" | "lmdg">;
  ip: string | null;
}): Promise<IpIntel> {
  const ip = (input.ip ?? "").slice(0, 45);
  if (!ip || !isPublicIp(ip)) return { ...UNKNOWN_INTEL };
  const ttlMs = input.config.lmdg.ipIntelTtlSeconds * 1000;
  const cached = ipIntelCache.get(ip);
  if (cached && Date.now() - cached.cachedAtMs < ttlMs) return cached.intel;
  // Mining path prefers proxycheck (VPN/proxy/Tor/hosting + ASN/country in one answer).
  // ipinfo remains the fallback for ASN/country so its signup role is untouched.
  let proxy: ProxyCheckIntel | null = null;
  if (input.config.proxycheckKey) {
    proxy = await lookupProxyCheckIntel({ ipAddress: ip, key: input.config.proxycheckKey, timeoutMs: input.config.proxycheckTimeoutMs });
    if (proxy) {
      const intel: IpIntel = {
        asn: proxy.asn,
        country: proxy.country,
        vpn: proxy.vpn,
        proxy: proxy.proxy,
        tor: proxy.tor,
        hosting: proxy.hosting,
        anonymous: proxy.anonymous,
        providerRisk: proxy.risk,
      };
      cacheIpIntel(ip, intel, Date.now(), ttlMs);
      return intel;
    }
  }
  if (input.config.ipinfoToken) {
    try {
      const location = await lookupIpLocation({ ipAddress: ip, token: input.config.ipinfoToken, timeoutMs: input.config.ipinfoTimeoutMs });
      const intel: IpIntel = { ...UNKNOWN_INTEL, asn: parseAsn(location.org), country: location.country };
      cacheIpIntel(ip, intel, Date.now(), ttlMs);
      return intel;
    } catch {
      // Degraded mode: third-party outage never fails mining.
    }
  }
  const stale = ipIntelCache.get(ip);
  if (stale) return stale.intel;
  return { ...UNKNOWN_INTEL };
}

/** Test hook: clears the in-process IP cache. */
export function clearIpIntelCacheForTests(): void {
  ipIntelCache.clear();
}
