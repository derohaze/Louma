import { z } from "zod";
import { isPublicIp } from "./ipinfo.js";

/**
 * proxycheck.io v3 — IP intelligence for the mining path ONLY.
 *
 * Signup geolocation stays on ipinfo (see modules/auth/service.ts). This module feeds LMDG with
 * richer network evidence: ASN, country, and plan-independent VPN/proxy/Tor/hosting detections
 * that the free IPinfo Lite plan does not provide.
 *
 * Degraded by design: a missing key, a reserved IP, a timeout, or an outage returns null and the
 * caller falls back to cached values or unknown network signals. Mining never depends on this
 * provider being online. The API key travels in the query string, so the URL is never logged.
 */

export interface ProxyCheckIntel {
  ipAddress: string;
  asn: string | null;
  country: string | null;
  vpn: boolean;
  proxy: boolean;
  tor: boolean;
  hosting: boolean;
  anonymous: boolean;
  /** 0..100 provider risk score, or null when absent. Evidence only, never a verdict. */
  risk: number | null;
}

const detectionsSchema = z.object({
  proxy: z.boolean().nullish(),
  vpn: z.boolean().nullish(),
  tor: z.boolean().nullish(),
  hosting: z.boolean().nullish(),
  anonymous: z.boolean().nullish(),
  risk: z.number().nullish(),
});

const entrySchema = z.object({
  network: z.object({ asn: z.string().max(32).nullish() }).nullish(),
  location: z.object({ country_code: z.string().length(2).nullish() }).nullish(),
  detections: detectionsSchema.nullish(),
});

const responseSchema = z.object({
  status: z.string(),
}).catchall(z.unknown());

function normalizeAsn(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const match = /AS(\d+)/i.exec(raw.trim());
  return match?.[1] ? `AS${match[1].toUpperCase()}` : raw.trim().slice(0, 32).toUpperCase();
}

export function parseProxyCheckResponse(ipAddress: string, payload: unknown): ProxyCheckIntel | null {
  const base = responseSchema.safeParse(payload);
  if (!base.success) return null;
  if (base.data.status !== "ok" && base.data.status !== "warning") return null;
  const record = (payload as Record<string, unknown>)[ipAddress];
  const entry = entrySchema.safeParse(record);
  if (!entry.success) return null;
  const detections = entry.data.detections;
  return {
    ipAddress,
    asn: normalizeAsn(entry.data.network?.asn),
    country: entry.data.location?.country_code ?? null,
    vpn: detections?.vpn === true,
    proxy: detections?.proxy === true,
    tor: detections?.tor === true,
    hosting: detections?.hosting === true,
    anonymous: detections?.anonymous === true,
    risk:
      typeof detections?.risk === "number" && Number.isFinite(detections.risk)
        ? Math.min(100, Math.max(0, Math.round(detections.risk)))
        : null,
  };
}

export async function lookupProxyCheckIntel(input: {
  ipAddress: string;
  key: string;
  timeoutMs: number;
}): Promise<ProxyCheckIntel | null> {
  if (!isPublicIp(input.ipAddress)) return null;
  const url = new URL(`https://proxycheck.io/v3/${encodeURIComponent(input.ipAddress)}`);
  url.searchParams.set("key", input.key);
  let response: Response;
  try {
    response = await fetch(url, {
      signal: AbortSignal.timeout(input.timeoutMs),
      headers: { accept: "application/json" },
    });
  } catch {
    return null;
  }
  if (!response.ok) return null;
  const payload: unknown = await response.json().catch(() => null);
  return parseProxyCheckResponse(input.ipAddress, payload);
}
