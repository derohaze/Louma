/**
 * LMDG real-browser attack harness.
 *
 * Drives the system Chrome and Edge over raw CDP (no external automation dependency: the same
 * WebSocket protocol Playwright would use, one flat driver file), against the REAL frontend
 * (vite dev server, which proxies /api to the real backend) using the real mining UI flow:
 * signup -> /mining -> Start mining -> the real device-guard collector and evidence payload.
 *
 * Machine-readable before/after output: every scenario reports identity/cluster/lease/decision
 * outcomes with exact HTTP status + reason codes; `--out <file>` persists one JSON document.
 *
 * Run: bun run harness:lmdg        (backend :8000 + frontend :3000 must be up; see scripts)
 *      node --import tsx src/tests/lmdg-attack-harness.ts --out results.json
 */

import { writeFileSync } from "node:fs";
import http from "node:http";
import * as childProcess from "node:child_process";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const FRONTEND = process.env["HARNESS_FRONTEND"] ?? "http://127.0.0.1:3000";
const API = process.env["HARNESS_API"] ?? "http://127.0.0.1:8000";
const CHROME = process.env["HARNESS_CHROME"] ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const EDGE = process.env["HARNESS_EDGE"] ?? "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const RUN = process.env["HARNESS_RUN"] ?? `h${Date.now().toString(36)}`;

const args = process.argv.slice(2);
const outPath = args.includes("--out") ? (args[args.indexOf("--out") + 1] ?? "lmdg-harness-results.json") : null;

const PASSWORD = "Harness1234";

// ---------------------------------------------------------------------------
// Machine-readable result model
// ---------------------------------------------------------------------------

type Verdict = "ALLOWED" | "BLOCKED" | "CHALLENGE" | "ERROR" | "CONVERGED";

interface ScenarioResult {
  id: string;
  name: string;
  browser: string;
  context: string;
  account: string;
  identityOutcome: string;
  clusterOutcome: string;
  leaseOutcome: string;
  finalResult: Verdict;
  httpStatus: number | null;
  reasonCode: string | null;
  latencyMs: number | null;
  evidence: string;
  notes?: string;
}

const results: ScenarioResult[] = [];

function record(r: ScenarioResult): void {
  results.push(r);
  console.log(
    `[${r.id}] ${r.finalResult} (${r.httpStatus ?? "-"} ${r.reasonCode ?? "-"}) ${r.context} @ ${r.browser} :: ${r.identityOutcome} | ${r.evidence}`,
  );
}

function classifyStart(status: number | null, code: string | null): Verdict {
  if (status === 200) return "ALLOWED";
  if (status === null) return "ERROR";
  if (code === "mining_device_challenge_required") return "CHALLENGE";
  if (code === "mining_device_already_in_use" || code === "mining_device_rejected" || code === "mining_device_evidence_required" || code === "mining_device_challenge_required") return "BLOCKED";
  if (status >= 400 && status < 500) return "BLOCKED";
  return "ERROR";
}

// ---------------------------------------------------------------------------
// Raw CDP driver (Chrome DevTools Protocol over WebSocket, zero dependencies)
// ---------------------------------------------------------------------------

class Ws {
  private nextId = 0;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  private eventWaiters: { method: string; resolve: (params: any) => void }[] = [];
  private buffer = Buffer.alloc(0);
  private socket: import("node:net").Socket | null = null;
  private handshakeDone = false;

  async connect(port: number): Promise<void> {
    const target = await new Promise<{ webSocketDebuggerUrl: string }>((resolve, reject) => {
      const attempt = (retries: number): void => {
        const req = http.get({ host: "127.0.0.1", port, path: "/json/list" }, (res) => {
          let data = "";
          res.on("data", (c) => (data += c));
          res.on("end", () => {
            try {
              const pages = (JSON.parse(data) as { type: string; webSocketDebuggerUrl: string }[]).filter((t) => t.type === "page");
              resolve(pages[0]!);
            } catch (error) {
              if (retries > 0) setTimeout(() => attempt(retries - 1), 400);
              else reject(error as Error);
            }
          });
        });
        req.on("error", () => {
          if (retries > 0) setTimeout(() => attempt(retries - 1), 400);
          else reject(new Error("cdp http unreachable"));
        });
      };
      attempt(20);
    });
    const url = new URL(target.webSocketDebuggerUrl);
    const net = await import("node:net");
    const wsPort = Number(url.port);
    await new Promise<void>((resolve, reject) => {
      this.socket = net.connect({ port: wsPort, host: url.hostname }, () => {
        resolve();
      });
      this.socket!.on("error", reject);
    });
    const key = Buffer.from(Math.random().toString(36).slice(2) + Date.now().toString(36)).toString("base64");
    this.socket!.write(
      `GET ${url.pathname}${url.search} HTTP/1.1\r\nHost: ${url.host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`,
    );
    await new Promise<void>((resolve) => {
      const onDataWait = (chunk: Buffer): void => {
        if (this.handshakeDone) return;
        if (chunk.toString("latin1").includes("101")) {
          this.handshakeDone = true;
          this.socket!.removeListener("data", onDataWait);
          this.socket!.on("data", (c) => this.onData(c));
          // First chunk may already contain frames after the handshake header.
          const bodyStart = chunk.indexOf("\r\n\r\n") + 4;
          if (bodyStart > 3 && chunk.length > bodyStart) this.onData(chunk.subarray(bodyStart));
          resolve();
        } else {
          this.socket!.once("data", onDataWait);
        }
      };
      this.socket!.once("data", onDataWait);
    });
  }

  private onData(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    for (;;) {
      if (this.buffer.length < 2) return;
      const first = this.buffer.readUInt8(1);
      const isMasked = (first & 0x80) !== 0;
      const len = first & 0x7f;
      let offset = 2;
      let length = len;
      if (len === 126) {
        if (this.buffer.length < 4) return;
        length = this.buffer.readUInt16BE(2);
        offset = 4;
      } else if (len === 127) {
        if (this.buffer.length < 10) return;
        length = Number(this.buffer.readBigUInt64BE(2));
        offset = 10;
      }
      const maskOffset = offset;
      if (isMasked) offset += 4;
      if (this.buffer.length < offset + length) return;
      const masked = this.buffer.subarray(offset, offset + length);
      const payload = Buffer.alloc(length);
      if (isMasked) {
        const mask = this.buffer.readUInt32BE(maskOffset);
        for (let i = 0; i < length; i++) payload[i] = masked[i]! ^ ((mask >> (8 * (3 - (i % 4)))) & 0xff);
      } else {
        masked.copy(payload);
      }
      this.buffer = this.buffer.subarray(offset + length);
      this.onMessage(payload.toString("utf8"));
    }
  }

  private onMessage(text: string): void {
    const msg = JSON.parse(text);
    if (msg.id !== undefined) {
      const p = this.pending.get(msg.id);
      if (p) {
        this.pending.delete(msg.id);
        if (msg.error) p.reject(new Error(msg.error.message)); 
        else p.resolve(msg.result);
      }
      return;
    }
    const w = this.eventWaiters.findIndex((x) => x.method === msg.method);
    if (w >= 0) {
      const [waiter] = this.eventWaiters.splice(w, 1);
      waiter?.resolve(msg.params);
    }
  }

  private sendFrame(obj: unknown): void {
    const payload = Buffer.from(JSON.stringify(obj));
    const mask = Buffer.from([0x12, 0x34, 0x56, 0x78]);
    const header = payload.length < 126 ? Buffer.from([0x81, 0x80 | payload.length]) : Buffer.from([0x81, 0x80 | 126, payload.length >> 8, payload.length & 0xff]);
    const masked = Buffer.alloc(payload.length);
    for (let i = 0; i < payload.length; i++) masked[i] = payload[i]! ^ mask[i % 4]!;
    this.socket!.write(Buffer.concat([header, mask, masked]));
  }

  call(method: string, params: Record<string, unknown> = {}): Promise<any> {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.sendFrame({ id, method, params });
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`CDP timeout: ${method}`));
        }
      }, 30_000);
    });
  }

  async evaluate<T = any>(expression: string): Promise<T> {
    const r = await this.call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? "page evaluation failed");
    return r.result.value as T;
  }

  async close(): Promise<void> {
    this.socket?.end();
  }
}

interface LaunchedBrowser {
  ws: Ws;
  proc: ChildProcessLike;
  port: number;
  label: string;
}

// Node globals typed loosely to keep the driver dependency-free and self-contained.
interface ChildProcessLike {
  kill: () => boolean;
}

function launchBrowser(exe: string, label: string, profileDir: string, extraArgs: string[] = []): LaunchedBrowser {
  const { spawn } = childProcess as { spawn: (exe: string, args: string[], opts: Record<string, unknown>) => ChildProcessLike };
  const port = 9222 + Math.floor(Math.random() * 500);
  const edgeFirstRun = label === "edge" ? ["--disable-features=msEdgeWelcomePage,msImplicitSignin,EdgeSyncIntro", "--disable-sync"] : ["--disable-features=DialMediaRouteProvider"];
  const proc: ChildProcessLike = spawn(
    exe,
    [
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profileDir}`,
      "--no-first-run",
      "--no-default-browser-check",
      ...edgeFirstRun,
      "--window-size=1400,900",
      ...extraArgs,
      "about:blank",
    ],
    { stdio: "ignore", detached: false },
  );
  return { ws: new Ws(), proc, port, label };
}

async function connectBrowser(b: LaunchedBrowser): Promise<Ws> {
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      await b.ws.connect(b.port);
      return b.ws;
    } catch {
      await sleep(250);
    }
  }
  throw new Error(`could not reach ${b.label} CDP endpoint`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function shutdown(b: LaunchedBrowser): Promise<void> {
  try {
    await b.ws.call("Browser.close");
  } catch {
    /* already gone */
  }
  await sleep(500);
  try {
    b.proc.kill();
  } catch {
    /* already gone */
  }
}

// ---------------------------------------------------------------------------
// In-page flow helpers (run inside the real page: the real UI, real collectors)
// ---------------------------------------------------------------------------

async function gotoAndSettle(ws: Ws, path: string): Promise<void> {
  const onApp = await ws.evaluate<boolean>(`location.origin.startsWith('http')`).catch(() => false);
  if (onApp) {
    // Inside the SPA: the app's own nav link is the router-native path. TanStack Start renders its
    // Link `to=` as the `href`, so this is exactly the click a user makes; a hard Page.navigate
    // inside a hydrated session gets bounced back to '/' by the route guard.
    for (let attempt = 0; attempt < 3; attempt++) {
      const state = await ws.evaluate<{ clicked: boolean; pathname: string }>(`(() => ({
        pathname: location.pathname,
        clicked: (() => {
          // A real in-app link whose rendered href is the target; sidebar entries and rail icons
          // surface them in different shells.
          const l = [...document.querySelectorAll('a')].filter((a) => a.getAttribute('href') === '${path}').at(-1);
          if (l) { l.click(); return true; }
          return false;
        })(),
      }))()`);
      if (state.pathname === path) return;
      await sleep(1500);
      if (attempt === 2 && state.pathname === "/") {
        // Last resort: a fresh document load. The guard only bounces an ALREADY-hydrated session.
        await ws.call("Page.enable");
        await ws.call("Page.navigate", { url: FRONTEND + path });
        await sleep(2500);
      }
    }
    return;
  }
  // First entry into this tab: a hard navigation is the only way in (about:blank has no router).
  await ws.call("Page.enable");
  await ws.call("Page.navigate", { url: FRONTEND + path });
  await sleep(2200); // SPA settle
}

/**
 * A real fresh browser session: clears the cookie jar (the httpOnly refresh cookie included) and
 * every origin store, exactly what a new browser profile or a storage wipe hands an attacker.
 * Without this the next signup page sees the previous account's session and redirects away.
 */
async function freshBrowserSession(ws: Ws): Promise<void> {
  await ws.call("Network.enable");
  await ws.call("Network.clearBrowserCookies");
  await ws.call("Storage.clearDataForOrigin", { origin: FRONTEND, storageTypes: "local_storage,session_storage,indexeddb,cache_storage" });
  await sleep(200);
  // Land on the logged-out app shell (home renders public): the next gotoAndSettle's in-app link
  // click is then router-native, with no auth redirect racing it.
  await ws.call("Page.enable");
  await ws.call("Page.navigate", { url: FRONTEND + "/" });
  await sleep(1800);
}

// ---------------------------------------------------------------------------
// Register pacing. The auth routes rate-limit to 5/min per IP and every harness
// browser shares one IP, so the sixth register inside a 60s window would be
// refused with 429 — and a refused attempt STILL counts against the limit.
// Track every register submission and hold below the window edge instead.
// ---------------------------------------------------------------------------

const REGISTER_WINDOW_MS = 60_000;
const REGISTER_MAX_PER_WINDOW = 5;
const REGISTER_PACE_MARGIN_MS = 2_000; // submit just past the sliding-window edge
const registerTimes: number[] = [];

async function paceRegister(): Promise<void> {
  for (;;) {
    const now = Date.now();
    while (registerTimes.length > 0 && now - registerTimes[0]! >= REGISTER_WINDOW_MS) registerTimes.shift();
    if (registerTimes.length < REGISTER_MAX_PER_WINDOW) break;
    const waitMs = REGISTER_WINDOW_MS - (now - registerTimes[0]!) + REGISTER_PACE_MARGIN_MS;
    console.log(`[pace] register window full; holding ${Math.ceil(waitMs / 1000)}s`);
    await sleep(waitMs);
  }
  registerTimes.push(Date.now());
}

/** Registers through the real signup form, ends signed-in on the mining page. */
async function signup(ws: Ws, email: string): Promise<void> {
  await gotoAndSettle(ws, "/signup");
  // Hold below the 5/min register limit before the form submits — the run's
  // pacing is bounded here, never the scenario's semantics.
  await paceRegister();
  await ws.evaluate(`(async () => {
    const set = (el, v) => {
      if (!el) return;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(el, v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    const inputs = [...document.querySelectorAll('input')];
    const byType = (t) => inputs.find((i) => i.type === t);
    set(byType('text'), 'Harness ${RUN}');
    set(byType('email'), '${email}');
    set(byType('password'), '${PASSWORD}');
    document.querySelector('form button[type=submit]')?.click();
    return true;
  })()`);
  await waitForAuthenticated(ws);
  // Signup lands on the authenticated overview; every scenario runs on the mining page.
  await gotoAndSettle(ws, "/mining");
}

async function waitForAuthenticated(ws: Ws, timeoutMs = 75_000): Promise<void> {
  const start = Date.now();
  for (;;) {
    const authed = await ws.evaluate(
      `Boolean(window.localStorage.getItem('louma:has-session') === '1' && !document.querySelector('form input[type=email]'))`,
    );
    if (authed) return;
    if (Date.now() - start > timeoutMs) throw new Error("signup/login did not complete in time");
    await sleep(300);
  }
}

interface StartOutcome {
  httpStatus: number | null;
  code: string | null;
  latencyMs: number | null;
  evidence: string;
  raw: string;
}

/** Presses the REAL Start-mining button and captures the exact API outcome via a fetch tap. */
async function pressStart(ws: Ws): Promise<StartOutcome> {
  await ws.evaluate(`(async () => {
    window.__lmdgTap = [];
    const orig = window.fetch;
    window.__origFetch = orig;
    window.fetch = async (...a) => {
      const t0 = performance.now();
      const url = typeof a[0] === 'string' ? a[0] : a[0]?.url ?? '';
      try {
        const res = await orig(...a);
        if (String(url).includes('/api/')) {
          let body = null;
          try { body = await res.clone().json(); } catch {}
          window.__lmdgTap.push({ url: String(url), status: res.status, code: body?.error?.code ?? null, ms: Math.round(performance.now() - t0) });
        }
        return res;
      } catch (e) {
        if (String(url).includes('/api/')) {
          window.__lmdgTap.push({ url: String(url), status: 0, code: 'fetch_error:' + String(e).slice(0, 60), ms: Math.round(performance.now() - t0) });
        }
        throw e;
      }
    };
    return true;
  })()`);
  const clicked = await ws.evaluate(`(() => {
    const buttons = [...document.querySelectorAll('button')];
    const b = buttons.find((x) => /start mining/i.test(x.textContent ?? ''));
    if (!b) return false;
    b.click();
    return true;
  })()`);
  if (!clicked) {
    // Diagnostics: what the page actually shows, so a locator mismatch is visible in the log.
    const pageState = await ws.evaluate<string>(`(() => ({
      url: location.href,
      buttons: [...document.querySelectorAll('button')].map((b) => b.textContent?.trim().slice(0, 30)).slice(0, 12),
      text: document.body.innerText.slice(0, 300),
      hasEmailInput: document.querySelector('input[type=email]') !== null,
      readyState: document.readyState,
      bodyChildren: document.body.children.length,
    }))()`);
    throw new Error(`Start mining button not found on /mining :: ${JSON.stringify(pageState)}`);
  }
  const start = Date.now();
  for (;;) {
    const done = await ws.evaluate<boolean>(`(window.__lmdgTap ?? []).some((e) => String(e.url).includes('/mining/start'))`);
    const busy = await ws.evaluate<boolean>(`document.querySelector('button[aria-disabled=true]') !== null`);
    if (done && !busy) break;
    if (Date.now() - start > 70_000) break;
    await sleep(300);
  }
  const outcome = await ws.evaluate<StartOutcome | null>(`(() => {
    const tap = (window.__lmdgTap ?? []).filter((e) => String(e.url).includes('/mining/start'));
    const last = tap.at(-1) ?? null;
    const blocked = /already active on this device|cannot start/i.test(document.body.innerText);
    return last ? { ...last, evidence: 'api-tap+ui', raw: document.body.innerText.slice(0, 400) } : (blocked ? { status: null, code: 'ui_blocked', ms: null, evidence: 'ui-text', raw: document.body.innerText.slice(0, 400) } : null);
  })()`);
  await ws.evaluate(`{ window.fetch = window.__origFetch; }`);
  if (!outcome) throw new Error("no start outcome captured");
  const tap = outcome as unknown as Record<string, unknown>;
  return { httpStatus: (tap["status"] as number | null) ?? null, code: (tap["code"] as string | null) ?? null, latencyMs: (tap["ms"] as number | null) ?? null, evidence: String(tap["evidence"] ?? ""), raw: String(tap["raw"] ?? "") };
}

/** Machine-identity forking UA: the only channel a real extension can rewrite. */
async function spoofUa(ws: Ws, cluster: string, variant: number): Promise<void> {
  await ws.evaluate(`(() => {
    const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 norm.${cluster}.${variant}.';
    Object.defineProperty(navigator, 'userAgent', { get: () => ua, configurable: true });
    return true;
  })()`);
}

// ---------------------------------------------------------------------------
// Direct-API helper (for proof-attack scenarios: exact HTTP semantics)
// ---------------------------------------------------------------------------

async function apiCall(path: string, init: { method?: string; token?: string; csrf?: string; body?: unknown } = {}): Promise<{ status: number; code: string | null; body: any }> {
  const res = await fetch(API + path, {
    method: init.method ?? "GET",
    headers: {
      ...(init.body === undefined ? {} : { "content-type": "application/json" }),
      ...(init.token ? { authorization: `Bearer ${init.token}` } : {}),
      ...(init.csrf ? { "x-csrf-token": init.csrf } : {}),
    },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, code: body?.error?.code ?? null, body };
}

async function directAccount(label: string): Promise<{ email: string; token: string; csrf: string }> {
  await paceRegister();
  const csrf0 = await apiCall("/api/v1/auth/csrf");
  const email = `${RUN}.${label}.${Math.random().toString(36).slice(2)}@example.test`;
  const reg = await apiCall("/api/v1/auth/register", { method: "POST", csrf: csrf0.body?.csrfToken, body: { email, password: PASSWORD, displayName: `H ${label}` } });
  if (reg.status !== 201) throw new Error(`direct register failed: ${reg.status} ${JSON.stringify(reg.body)}`);
  return { email, token: reg.body.accessToken, csrf: reg.body.csrfToken };
}

// ---------------------------------------------------------------------------
// Scenario suite
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log(`== LMDG attack harness == run=${RUN}`);
  const chrome = launchBrowser(CHROME, "chrome", `${process.env["TEMP"] ?? "/tmp"}/lmdg-h-${RUN}-chrome`);
  const edge = launchBrowser(EDGE, "edge", `${process.env["TEMP"] ?? "/tmp"}/lmdg-h-${RUN}-edge`);
  try {
    const chromeWs = await connectBrowser(chrome);
    const edgeWs = await connectBrowser(edge);

    // ------------------------------------------------------------------
    // BASELINE: same browser+profile, two accounts
    // ------------------------------------------------------------------
    const emailA = `${RUN}.a.${Math.random().toString(36).slice(2)}@example.test`;
    await signup(chromeWs, emailA);
    let outcome = await pressStart(chromeWs);
    record({
      id: "BASELINE-A1", name: "browser A profile 1, account 1 starts", browser: "chrome", context: "normal profile",
      account: emailA, identityOutcome: "enrolled", clusterOutcome: "created", leaseOutcome: "active",
      finalResult: classifyStart(outcome.httpStatus, outcome.code), httpStatus: outcome.httpStatus, reasonCode: outcome.code,
      latencyMs: outcome.latencyMs, evidence: outcome.evidence,
    });
    await chromeWs.evaluate(`window.localStorage.clear()`); // sign out session hint only
    const emailB = `${RUN}.b.${Math.random().toString(36).slice(2)}@example.test`;
    await freshBrowserSession(chromeWs);
    await gotoAndSettle(chromeWs, "/signup");
    await signup(chromeWs, emailB);
    outcome = await pressStart(chromeWs);
    record({
      id: "BASELINE-A2", name: "same browser+profile, second account starts", browser: "chrome", context: "same profile",
      account: emailB, identityOutcome: "correlated-to-A-machine", clusterOutcome: "same-cluster", leaseOutcome: "conflict",
      finalResult: classifyStart(outcome.httpStatus, outcome.code), httpStatus: outcome.httpStatus, reasonCode: outcome.code,
      latencyMs: outcome.latencyMs, evidence: outcome.evidence,
    });

    // ------------------------------------------------------------------
    // UA MANIPULATION + EXTENSION-LIKE MUTATION (second account, spoofed UA)
    // ------------------------------------------------------------------
    await freshBrowserSession(chromeWs);
    await gotoAndSettle(chromeWs, "/signup");
    await spoofUa(chromeWs, "uaspoof", 7);
    const emailC = `${RUN}.c.${Math.random().toString(36).slice(2)}@example.test`;
    await signup(chromeWs, emailC);
    outcome = await pressStart(chromeWs);
    record({
      id: "UA-SWITCH", name: "UA-switcher extension mutation, second account", browser: "chrome", context: "spoofed navigator.userAgent",
      account: emailC, identityOutcome: "machine-key-unchanged", clusterOutcome: "same-cluster", leaseOutcome: "conflict",
      finalResult: classifyStart(outcome.httpStatus, outcome.code), httpStatus: outcome.httpStatus, reasonCode: outcome.code,
      latencyMs: outcome.latencyMs, evidence: outcome.evidence, notes: "UA spoofed before signup+start; device collectors see the forged UA",
    });

    // ------------------------------------------------------------------
    // STORAGE WIPE + FRESH ORIGIN (same machine, cleared everything)
    // ------------------------------------------------------------------
    await freshBrowserSession(chromeWs);
    await gotoAndSettle(chromeWs, "/signup");
    const emailD = `${RUN}.d.${Math.random().toString(36).slice(2)}@example.test`;
    await signup(chromeWs, emailD);
    outcome = await pressStart(chromeWs);
    record({
      id: "STORAGE-WIPE", name: "cookies+localStorage+IndexedDB wiped, new account", browser: "chrome", context: "fresh origin storage",
      account: emailD, identityOutcome: "new-key-no-visitor", clusterOutcome: "machine-key-correlated", leaseOutcome: "conflict",
      finalResult: classifyStart(outcome.httpStatus, outcome.code), httpStatus: outcome.httpStatus, reasonCode: outcome.code,
      latencyMs: outcome.latencyMs, evidence: outcome.evidence,
    });

    // ------------------------------------------------------------------
    // CROSS-BROWSER: real Edge profile on the same physical machine
    // ------------------------------------------------------------------
    const emailE = `${RUN}.e.${Math.random().toString(36).slice(2)}@example.test`;
    await signup(edgeWs, emailE);
    outcome = await pressStart(edgeWs);
    record({
      id: "CROSS-BROWSER", name: "second real browser (Edge) on same machine", browser: "edge", context: "different engine+profile",
      account: emailE, identityOutcome: "machine-key-correlated", clusterOutcome: "same-cluster", leaseOutcome: "conflict",
      finalResult: classifyStart(outcome.httpStatus, outcome.code), httpStatus: outcome.httpStatus, reasonCode: outcome.code,
      latencyMs: outcome.latencyMs, evidence: outcome.evidence,
    });

    // ------------------------------------------------------------------
    // RACE: two browsers starting at the same wall-clock moment
    // ------------------------------------------------------------------
    const emailF = `${RUN}.f.${Math.random().toString(36).slice(2)}@example.test`;
    const emailG = `${RUN}.g.${Math.random().toString(36).slice(2)}@example.test`;
    // Fresh sessions for both: two brand-new accounts on the same machine racing a start.
    await freshBrowserSession(edgeWs);
    await gotoAndSettle(edgeWs, "/signup");
    await signup(edgeWs, emailF);
    await freshBrowserSession(chromeWs);
    await gotoAndSettle(chromeWs, "/signup");
    await signup(chromeWs, emailG);
    const [raceF, raceG] = await Promise.all([pressStart(edgeWs), pressStart(chromeWs)]);
    const allowed = [raceF, raceG].filter((r) => classifyStart(r.httpStatus, r.code) === "ALLOWED").length;
    record({
      id: "RACE-2-BROWSERS", name: "two browsers racing start simultaneously", browser: "chrome+edge", context: "concurrent",
      account: `${emailF} + ${emailG}`, identityOutcome: "same-machine", clusterOutcome: "same-cluster",
      leaseOutcome: allowed === 1 ? "exactly-one" : "invalid", finalResult: allowed === 1 ? "ALLOWED" : "ERROR",
      httpStatus: raceF.httpStatus, reasonCode: `${raceF.code ?? "-"} | ${raceG.code ?? "-"}`,
      latencyMs: Math.max(raceF.latencyMs ?? 0, raceG.latencyMs ?? 0), evidence: `allowed=${allowed} statuses=${raceF.httpStatus}/${raceG.httpStatus}`,
    });

    // ------------------------------------------------------------------
    // PROOF ATTACKS (direct API, exact HTTP semantics; real ECDSA keys via WebCrypto)
    // ------------------------------------------------------------------
    await proofAttacks();

    // ------------------------------------------------------------------
    // DRIFT + NETWORK + FINGERPRINT-RANDOMIZATION (SIMULATED at the HTTP boundary)
    // ------------------------------------------------------------------
    await simulatedScenarios();
  } finally {
    await shutdown(chrome).catch(() => undefined);
    await shutdown(edge).catch(() => undefined);
  }

  if (outPath) {
    writeFileSync(outPath, JSON.stringify({ run: RUN, generatedAt: new Date().toISOString(), frontend: FRONTEND, api: API, results }, null, 2));
    console.log(`results written: ${outPath}`);
  }
}

/** Proof attacks: replay, expired, wrong key, wrong account, malformed JWK, altered challenge. */
async function proofAttacks(): Promise<void> {
  const acct = await directAccount("proof");
  const ch = await apiCall("/api/v1/mining/device/challenge", { method: "POST", token: acct.token, csrf: acct.csrf, body: {} });
  const { nonce, payload } = ch.body;
  const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const jwk = await crypto.subtle.exportKey("jwk", kp.publicKey);
  const sig = async (data: string, key: CryptoKey = kp.privateKey) => Buffer.from(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(data))).toString("base64url");

  const good = await apiCall("/api/v1/mining/device/prove", { method: "POST", token: acct.token, csrf: acct.csrf, body: { nonce, signature: await sig(payload), publicKeyJwk: jwk } });
  record({
    id: "PROOF-VALID", name: "bound-payload proof accepted", browser: "direct-api", context: "challenge/prove",
    account: acct.email, identityOutcome: "key-verified", clusterOutcome: "-", leaseOutcome: "-",
    finalResult: good.status === 200 ? "ALLOWED" : "ERROR", httpStatus: good.status, reasonCode: good.code, latencyMs: null, evidence: "api",
  });
  const replay = await apiCall("/api/v1/mining/device/prove", { method: "POST", token: acct.token, csrf: acct.csrf, body: { nonce, signature: await sig(payload), publicKeyJwk: jwk } });
  record({
    id: "PROOF-REPLAY", name: "same nonce+signature replayed", browser: "direct-api", context: "replay",
    account: acct.email, identityOutcome: "-", clusterOutcome: "-", leaseOutcome: "-",
    finalResult: replay.status === 401 ? "BLOCKED" : "ERROR", httpStatus: replay.status, reasonCode: replay.code, latencyMs: null, evidence: "api",
  });

  // Fresh challenge, wrong account presents it.
  const acct2 = await directAccount("proof2");
  const ch2 = await apiCall("/api/v1/mining/device/challenge", { method: "POST", token: acct.token, csrf: acct.csrf, body: {} });
  const wrongAccount = await apiCall("/api/v1/mining/device/prove", { method: "POST", token: acct2.token, csrf: acct2.csrf, body: { nonce: ch2.body.nonce, signature: await sig(ch2.body.payload), publicKeyJwk: jwk } });
  record({
    id: "PROOF-WRONG-ACCOUNT", name: "valid proof submitted by another account", browser: "direct-api", context: "cross-account",
    account: acct2.email, identityOutcome: "-", clusterOutcome: "-", leaseOutcome: "-",
    finalResult: wrongAccount.status === 401 ? "BLOCKED" : "ERROR", httpStatus: wrongAccount.status, reasonCode: wrongAccount.code, latencyMs: null, evidence: "api",
  });

  const ch3 = await apiCall("/api/v1/mining/device/challenge", { method: "POST", token: acct.token, csrf: acct.csrf, body: {} });
  const wrongKey = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const wrongKeyProof = await apiCall("/api/v1/mining/device/prove", { method: "POST", token: acct.token, csrf: acct.csrf, body: { nonce: ch3.body.nonce, signature: await sig(ch3.body.payload, wrongKey.privateKey), publicKeyJwk: await crypto.subtle.exportKey("jwk", wrongKey.publicKey) } });
  record({
    id: "PROOF-WRONG-KEY", name: "signature by a different key than the presented JWK", browser: "direct-api", context: "key-confusion",
    account: acct.email, identityOutcome: "-", clusterOutcome: "-", leaseOutcome: "-",
    finalResult: wrongKeyProof.status === 401 ? "BLOCKED" : "ERROR", httpStatus: wrongKeyProof.status, reasonCode: wrongKeyProof.code, latencyMs: null, evidence: "api",
  });

  const malformed = await apiCall("/api/v1/mining/device/prove", { method: "POST", token: acct.token, csrf: acct.csrf, body: { nonce: ch3.body.nonce, signature: await sig(ch3.body.payload), publicKeyJwk: { kty: "EC", crv: "P-521", x: "AA", y: "BB" } } });
  record({
    id: "PROOF-MALFORMED-JWK", name: "malformed JWK (wrong curve, truncated coords)", browser: "direct-api", context: "jwk-validation",
    account: acct.email, identityOutcome: "-", clusterOutcome: "-", leaseOutcome: "-",
    finalResult: malformed.status === 401 ? "BLOCKED" : "ERROR", httpStatus: malformed.status, reasonCode: malformed.code, latencyMs: null, evidence: "api",
  });

  const altered = await apiCall("/api/v1/mining/device/prove", { method: "POST", token: acct.token, csrf: acct.csrf, body: { nonce: ch3.body.nonce, signature: await sig(ch3.body.payload.replace("mining", "minting")), publicKeyJwk: jwk } });
  record({
    id: "PROOF-ALTERED-CHALLENGE", name: "signature over an altered challenge payload", browser: "direct-api", context: "payload-binding",
    account: acct.email, identityOutcome: "-", clusterOutcome: "-", leaseOutcome: "-",
    finalResult: altered.status === 401 ? "BLOCKED" : "ERROR", httpStatus: altered.status, reasonCode: altered.code, latencyMs: null, evidence: "api",
  });

  const bareNonce = await apiCall("/api/v1/mining/device/prove", { method: "POST", token: acct.token, csrf: acct.csrf, body: { nonce: ch3.body.nonce, signature: await sig(ch3.body.nonce), publicKeyJwk: jwk } });
  record({
    id: "PROOF-BARE-NONCE", name: "legacy bare-nonce signature (pre-binding)", browser: "direct-api", context: "payload-binding",
    account: acct.email, identityOutcome: "-", clusterOutcome: "-", leaseOutcome: "-",
    finalResult: bareNonce.status === 401 ? "BLOCKED" : "ERROR", httpStatus: bareNonce.status, reasonCode: bareNonce.code, latencyMs: null, evidence: "api",
  });
}

/**
 * Drift / network / randomization at the HTTP boundary.
 *
 * Labelled SIMULATED: the browser signals are synthesized exactly the way the integration fixtures
 * build them (same normalization contract), but no real second display, GPU, or VPN route exists in
 * this environment. They measure the server's identity logic, not real-world observability.
 */
async function simulatedScenarios(): Promise<void> {
  // Self-contained instead: build evidence through the same normalization the fixtures use.
  const { sanitizeEvidence, normalizeSignals } = await import("../modules/mining-device/signals.js");
  const { buildFeatureMap } = await import("../modules/mining-device/identity.js");

  const machine = {
    platform: "Win32",
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
    screenWidth: 1920, screenHeight: 1080, screenAvailWidth: 1920, screenAvailHeight: 1040, screenColorDepth: 24,
    pixelRatio: 1, hardwareConcurrency: 8, deviceMemory: 8, maxTouchPoints: 0,
    webglVendor: `vendor-${RUN}`, webglRenderer: `renderer-${RUN}`, webglLimitsHash: `limits-${RUN}`, webglExtensionsHash: `ext-${RUN}`,
    webgpuHash: `webgpu-${RUN}`, audioSampleRate: 48000, audioChannels: 2, colorGamut: "srgb", hdr: false,
    fontsHash: `fonts-${RUN}`, codecsHash: `codecs-${RUN}`, mimeTypesHash: `mime-${RUN}`,
    timezone: "Africa/Cairo", timezoneOffsetMinutes: -180, language: "en-US", locale: "en-US", languages: "en-US,en",
    mediaAudioInputs: 1, mediaVideoInputs: 1, storageQuotaBytes: 2 ** 32,
    fingerprintConfidence: 0.95, fingerprintVersion: "v5",
    integrity: { webdriver: false, headlessHint: false, impossibleUaPlatform: false, missingCapabilities: false },
  };
  const evidence = (over: Record<string, unknown> = {}) => ({
    ...machine, ...over,
    visitorId: `visitor-${RUN}-${Math.random().toString(36).slice(2)}`,
    browserKeyPublicKey: `key-${RUN}-${Math.random().toString(36).slice(2)}`,
  });
  const digestsOf = (ev: Record<string, unknown>) => buildFeatureMap(normalizeSignals(sanitizeEvidence(ev)));

  const acctA = await directAccount("sim-a");
  const start1 = await apiCall("/api/v1/mining/start", { method: "POST", token: acctA.token, csrf: acctA.csrf, body: { device: evidence() } });
  record({
    id: "SIM-BASELINE", name: "SIMULATED: first enrollment of synthetic machine", browser: "simulated-http", context: "http-boundary",
    account: acctA.email, identityOutcome: "enrolled", clusterOutcome: "created", leaseOutcome: "active",
    finalResult: start1.status === 200 ? "ALLOWED" : "ERROR", httpStatus: start1.status, reasonCode: start1.code, latencyMs: null, evidence: "simulated",
  });

  // Rendering drift: GPU strings + digests move (driver update), machine traits stable.
  const acctB = await directAccount("sim-b");
  const drift = await apiCall("/api/v1/mining/start", {
    method: "POST", token: acctB.token, csrf: acctB.csrf,
    body: { device: evidence({ webglVendor: `vendor2-${RUN}`, webglRenderer: `renderer2-${RUN}`, webglLimitsHash: `limits2-${RUN}`, webglExtensionsHash: `ext2-${RUN}`, webgpuHash: `webgpu2-${RUN}` }) },
  });
  record({
    id: "SIM-DRIFT-GPU", name: "SIMULATED: rendering/GPU drift on same machine", browser: "simulated-http", context: "driver-update drift",
    account: acctB.email, identityOutcome: digestsOf(machine)["gpu"] !== digestsOf({ ...machine, webglVendor: `vendor2-${RUN}`, webglRenderer: `renderer2-${RUN}` })["gpu"] ? "gpu-digested" : "?", clusterOutcome: "machine-key-stable", leaseOutcome: "conflict-expected",
    finalResult: drift.status === 409 ? "BLOCKED" : drift.status === 200 ? "ALLOWED" : "ERROR", httpStatus: drift.status, reasonCode: drift.code, latencyMs: null, evidence: "simulated",
  });

  // Fingerprint randomization: every rendering digest + visitorId randomized (privacy-browser style).
  const acctC = await directAccount("sim-c");
  const randomized = await apiCall("/api/v1/mining/start", {
    method: "POST", token: acctC.token, csrf: acctC.csrf,
    body: {
      device: evidence({
        canvasHash: `canvas-r${Math.random()}`, audioHash: `audio-r${Math.random()}`, webglHash: `webgl-r${Math.random()}`,
        speechVoicesHash: `voices-r${Math.random()}`, fontsHash: `fonts-r${Math.random()}`,
        screenWidth: 1680, screenHeight: 1050, screenAvailWidth: 1680, screenAvailHeight: 1010,
      }),
    },
  });
  record({
    id: "SIM-FP-RANDOM", name: "SIMULATED: fingerprint randomization (privacy browser style)", browser: "simulated-http", context: "randomized rendering+geometry",
    account: acctC.email, identityOutcome: "randomized-browser-traits", clusterOutcome: "machine-key-stable", leaseOutcome: "conflict-expected",
    finalResult: randomized.status === 409 ? "BLOCKED" : randomized.status === 200 ? "ALLOWED" : "ERROR", httpStatus: randomized.status, reasonCode: randomized.code, latencyMs: null, evidence: "simulated",
  });

  // VPN: IP change only (no key, no visitorId), same machine traits — SIMULATED network metadata.
  const acctD = await directAccount("sim-d");
  const vpn = await apiCall("/api/v1/mining/start", {
    method: "POST", token: acctD.token, csrf: acctD.csrf,
    body: { device: evidence({ visitorId: null, browserKeyPublicKey: null }) },
  });
  record({
    id: "SIM-VPN-IP-CHANGE", name: "SIMULATED: VPN/IP change, no browser identity left", browser: "simulated-http", context: "network-only change",
    account: acctD.email, identityOutcome: "network-only", clusterOutcome: "machine-key-stable", leaseOutcome: "conflict-expected",
    finalResult: vpn.status === 409 ? "BLOCKED" : vpn.status === 200 ? "ALLOWED" : "ERROR", httpStatus: vpn.status, reasonCode: vpn.code, latencyMs: null, evidence: "simulated",
  });

  // Impossible UA/platform pair (announced integrity + server-side detection).
  const acctE = await directAccount("sim-e");
  const impossible = await apiCall("/api/v1/mining/start", {
    method: "POST", token: acctE.token, csrf: acctE.csrf,
    body: { device: evidence({ platform: "iPhone", userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) ... Chrome/126.0 Safari/537.36" }) },
  });
  record({
    id: "SIM-IMPOSSIBLE-UA", name: "SIMULATED: impossible UA/platform pair", browser: "simulated-http", context: "integrity evidence",
    account: acctE.email, identityOutcome: "integrity-flagged", clusterOutcome: "new-cluster", leaseOutcome: "-",
    finalResult: impossible.status === 200 ? "ALLOWED" : classifyStart(impossible.status, impossible.code), httpStatus: impossible.status, reasonCode: impossible.code, latencyMs: null,
    evidence: "simulated", notes: "expected: ALLOWED (evidence, not verdict) or BLOCKED/CHALLENGE under aggressive policy",
  });

  // Headless/automation indicators.
  const acctF2 = await directAccount("sim-f");
  const automated = await apiCall("/api/v1/mining/start", {
    method: "POST", token: acctF2.token, csrf: acctF2.csrf,
    body: { device: evidence({ integrity: { webdriver: true, headlessHint: true, impossibleUaPlatform: false, missingCapabilities: false } }) },
  });
  record({
    id: "SIM-AUTOMATION", name: "SIMULATED: webdriver+headless automation indicators", browser: "simulated-http", context: "integrity evidence",
    account: acctF2.email, identityOutcome: "integrity-flagged", clusterOutcome: "new-cluster", leaseOutcome: "-",
    finalResult: classifyStart(automated.status, automated.code), httpStatus: automated.status, reasonCode: automated.code, latencyMs: null,
    evidence: "simulated", notes: "expected: CHALLENGE (risk>=55) rather than silent allow",
  });
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("HARNESS FAILURE:", error);
    process.exit(1);
  });
