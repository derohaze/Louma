import "@/shared/lib/platform";

import { consumeLastCapturedError } from "@/shared/lib/platform";
import { renderErrorPage } from "@/shared/lib/platform";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

/**
 * Same-origin API proxy.
 *
 * The customer app talks to the API at `/api/v1/...` on its own origin, which is what keeps the
 * refresh cookie first-party and needs no CORS. In development Vite's proxy supplies that origin,
 * but a deployed build (Vercel Function or a plain Node server) does not have a proxy of its own:
 * without one, `/api/*` falls through to this app's router and answers the 404 page — exactly the
 * failure that made `/auth/csrf` and `/auth/refresh` return 404 in production. This entry forwards
 * those requests to `DEFAULT_BACKEND_URL` (`BACKEND_URL` overrides it), so the routing works on any
 * host and the backend URL never has to be baked into the browser bundle.
 *
 * The response is rebuilt rather than returned as-is: `fetch` transparently decodes the body, so the
 * backend's `content-encoding`/`content-length` no longer describe what is being sent, and every
 * `Set-Cookie` header has to survive for the session cookies to work.
 */
const API_PREFIX = "/api/";

/**
 * Where the customer API actually lives. It is fixed for this deployment, but `BACKEND_URL` still
 * overrides it so a preview/staging build can point somewhere else without a code change.
 */
const DEFAULT_BACKEND_URL = "https://api.loumapay.com";

function backendBaseUrl(): string {
  const raw = typeof process === "undefined" ? undefined : process.env["BACKEND_URL"];
  const trimmed = raw?.trim();
  return (trimmed || DEFAULT_BACKEND_URL).replace(/\/+$/, "");
}

/**
 * Stamps the real client IP for the API to count and store.
 *
 * By the time a request reaches the API, its socket address is a shared Cloudflare/Vercel address,
 * so the backend cannot tell users apart by IP (login throttle, stored signup IP). The connecting
 * address this server saw is stamped into a header the backend only believes alongside the shared
 * secret (`PROXY_SHARED_SECRET`, set on both sides; without it nothing is stamped). Cloudflare
 * appends the true client address to `X-Forwarded-For`, so the LAST entry is the one no client
 * could have planted — anything before it may be spoofed. `set` overwrites any planted stamp or
 * secret on the way through rather than appending to it.
 */
const PROXY_CLIENT_IP_HEADER = "x-louma-client-ip";
const PROXY_SECRET_HEADER = "x-louma-proxy-secret";
const IP_LITERAL = /^(?:\d{1,3}(?:\.\d{1,3}){3}|[0-9a-fA-F:.]{2,45})$/;

function stampClientIp(request: Request, headers: Headers): void {
  const secret = process.env["PROXY_SHARED_SECRET"]?.trim();
  if (!secret) return;
  const forwarded = request.headers.get("x-forwarded-for");
  const last = forwarded
    ?.split(",")
    .map((part) => part.trim().replace(/^\[|\]$/g, ""))
    .filter(Boolean)
    .pop();
  const fromForwarded = last && IP_LITERAL.test(last) ? last : null;
  const fromCfDirect = request.headers.get("cf-connecting-ip")?.trim().replace(/^\[|\]$/g, "");
  const candidate = fromForwarded ?? (fromCfDirect && IP_LITERAL.test(fromCfDirect) ? fromCfDirect : null);
  if (!candidate) return;
  headers.set(PROXY_CLIENT_IP_HEADER, candidate);
  headers.set(PROXY_SECRET_HEADER, secret);
}

async function proxyApiRequest(request: Request, backend: string): Promise<Response> {
  const incoming = new URL(request.url);
  const target = new URL(`${incoming.pathname}${incoming.search}`, backend);
  const headers = new Headers(request.headers);
  // `Host` and `Content-Length` describe this origin/the original body; `fetch` sets them for the
  // backend itself, and forwarding the originals would make the backend see the wrong host.
  headers.delete("host");
  headers.delete("content-length");
  stampClientIp(request, headers);
  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  const response = await fetch(target, {
    method: request.method,
    headers,
    ...(hasBody ? ({ body: request.body, duplex: "half" } as RequestInit) : {}),
    redirect: "manual",
  });
  const responseHeaders = new Headers(response.headers);
  responseHeaders.delete("content-encoding");
  responseHeaders.delete("content-length");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders,
  });
}

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!isH3SwallowedErrorBody(body)) return response;

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function isH3SwallowedErrorBody(body: string): boolean {
  try {
    const payload = JSON.parse(body) as { unhandled?: unknown; message?: unknown };
    return payload.unhandled === true && payload.message === "HTTPError";
  } catch {
    return false;
  }
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      if (new URL(request.url).pathname.startsWith(API_PREFIX)) {
        return await proxyApiRequest(request, backendBaseUrl());
      }
      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      return await normalizeCatastrophicSsrResponse(response);
    } catch (error) {
      console.error(error);
      return new Response(renderErrorPage(), {
        status: 500,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
  },
};
