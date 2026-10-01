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

import { rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import * as childProcess from "node:child_process";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const FRONTEND = process.env["HARNESS_FRONTEND"] ?? "http://127.0.0.1:3000";
const API = process.env["HARNESS_API"] ?? "http://127.0.0.1:8000";
const CHROME = process.env["HARNESS_CHROME"] ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const EDGE = process.env["HARNESS_EDGE"] ?? "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
// Optional genuinely different engine (e.g. Firefox). Chrome and Edge are both Chromium, so without
// this the harness never observes what a second engine actually collects — the Firefox-like HTTP
// simulation below measures server logic, not real-world observability.
const FIREFOX = process.env["HARNESS_FIREFOX"] ?? null;
const RUN = process.env["HARNESS_RUN"] ?? `h${Date.now().toString(36)}`;
/** Wall-clock start of this run: every destructive isolation write is scoped to rows from it on. */
const RUN_STARTED_MS = Date.now();
/**
 * The isolation helpers below rewrite rows the harness did not create (identity budgets, live
 * leases). Against a populated database that is data loss and protection removal, not test setup, so
 * they are refused unless the operator states the database is throwaway. Everything the harness
 * needs for its own accounts (releasing *its* leases, closing *its* sessions) stays scoped to those
 * accounts and needs no flag.
 */
const DESTRUCTIVE_CLEANUP_ALLOWED = (process.env["HARNESS_ALLOW_DESTRUCTIVE_CLEANUP"] ?? "").trim() === "1";

const args = process.argv.slice(2);
const outPath = args.includes("--out") ? (args[args.indexOf("--out") + 1] ?? "lmdg-harness-results.json") : null;

const PASSWORD = "Harness1234";

// ---------------------------------------------------------------------------
// Machine-readable result model
// ---------------------------------------------------------------------------

/**
 * A scenario verdict.
 *
 * `INCONCLUSIVE` and `BLOCKED-BY-TEST-SETUP` exist so a scenario that did not actually run its course
 * can never be read as a security result: the first means the case produced no decidable outcome (a
 * race where neither side won tells us nothing about whether it is race-safe), the second means the
 * test's own budget throttled the request.
 */
type Verdict = "ALLOWED" | "BLOCKED" | "CHALLENGE" | "ERROR" | "CONVERGED" | "INCONCLUSIVE" | "BLOCKED-BY-TEST-SETUP";

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
  // A reused RUN label must not inherit the previous run's browser state: a stale
  // `louma:has-session` flag makes the app skip the signup form, so every browser scenario fails on a
  // page it never actually reached (measured as a harness crash, not as a security result).
  rmSync(profileDir, { recursive: true, force: true });
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

// The mining-start route is limited to 10/min per IP and every harness caller shares one IP, so the
// direct-API suite (dozens of starts) would otherwise be refused by the limiter rather than by the
// device guard. Hold below the window edge exactly like registration; the budget of 8 leaves room
// for the browser flow's own challenge-and-retry start, which is not routed through apiCall.
const START_WINDOW_MS = 60_000;
const START_MAX_PER_WINDOW = 8;
const startTimes: number[] = [];

async function paceStart(): Promise<void> {
  for (;;) {
    const now = Date.now();
    while (startTimes.length > 0 && now - startTimes[0]! >= START_WINDOW_MS) startTimes.shift();
    if (startTimes.length < START_MAX_PER_WINDOW) break;
    const waitMs = START_WINDOW_MS - (now - startTimes[0]!) + REGISTER_PACE_MARGIN_MS;
    console.log(`[pace] start window full; holding ${Math.ceil(waitMs / 1000)}s`);
    await sleep(waitMs);
  }
  startTimes.push(Date.now());
}

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
  // A start press is a start call: count it against the same per-IP window as the direct-API suite.
  await paceStart();
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

async function apiCall(path: string, init: { method?: string; token?: string; csrf?: string; body?: unknown; origin?: string } = {}): Promise<{ status: number; code: string | null; body: any }> {
  if (path.includes("/mining/start")) await paceStart();
  const res = await fetch(API + path, {
    method: init.method ?? "GET",
    headers: {
      ...(init.body === undefined ? {} : { "content-type": "application/json" }),
      ...(init.token ? { authorization: `Bearer ${init.token}` } : {}),
      ...(init.csrf ? { "x-csrf-token": init.csrf } : {}),
      // The Origin header is what the browser attaches to a cross-origin request; sending it by hand
      // lets the harness exercise the server's origin binding (cross-origin proof replay).
      ...(init.origin ? { origin: init.origin } : {}),
    },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, code: body?.error?.code ?? null, body };
}

/**
 * Direct read-only probe into the database the LOCAL API is configured against.
 *
 * The API deliberately exposes no cluster internals, so "how many logical machine identities did
 * this run create?" is measured where the identities actually live. Returns null (never throws) when
 * the connection string is absent or unreachable: the harness must still run.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function dbProbe<T>(fn: (collections: Record<string, any>) => Promise<T>): Promise<T | null> {
  const uri = process.env["MONGODB_URI"] ?? "mongodb://127.0.0.1:27017";
  const dbName = process.env["MONGODB_DATABASE"] ?? "louma_lmdg_dev";
  try {
    const { MongoClient } = await import("mongodb");
    const client = new MongoClient(uri, { serverSelectionTimeoutMS: 3000 });
    await client.connect();
    try {
      const db = client.db(dbName);
      return await fn({
        devices: db.collection("mining_devices"),
        leases: db.collection("mining_device_leases"),
        observations: db.collection("mining_device_observations"),
        nonces: db.collection("mining_device_nonces"),
        events: db.collection("security_events"),
        sessions: db.collection("mining_sessions"),
        quotas: db.collection("mining_device_quotas"),
      });
    } finally {
      await client.close();
    }
  } catch {
    return null;
  }
}

/**
 * TEST-ONLY isolation: clear the enrollment budget counters.
 *
 * The whole harness talks to the API from one client address, so the per-network new-identity budget
 * (8/hour by default) is spent by the identity-churn scenarios long before the drift scenarios run.
 * A 403 from a spent *test budget* says nothing about drift protection, and crediting it as a pass
 * would be exactly the "green tests mean secure" mistake this harness exists to avoid. Phases that
 * measure something other than the budget therefore reset it first, and any 403 that still reaches a
 * scenario is reported as BLOCKED-BY-TEST-SETUP rather than as a verdict. Returns null when the probe
 * cannot reach the database — the harness must still run.
 */
async function resetEnrollmentBudget(): Promise<number | null> {
  if (!DESTRUCTIVE_CLEANUP_ALLOWED) {
    console.log("[isolation] enrollment budget reset skipped: set HARNESS_ALLOW_DESTRUCTIVE_CLEANUP=1 on a throwaway database");
    return null;
  }
  return await dbProbe(async (c) => {
    // The budget is global by design (it is per network), so "only the test's rows" cannot be
    // expressed as a filter without knowing every network hash involved; the guard above is the
    // isolation contract instead. The count is returned and logged, so the operator sees exactly how
    // many spent slots the run gave back.
    const result = await c["quotas"].deleteMany({});
    return result.deletedCount ?? 0;
  });
}

/**
 * TEST-ONLY isolation: release every live device lease.
 *
 * A race measured while an earlier scenario still holds the machine's lease is not a race, it is two
 * calls queueing behind a lease that was already taken (the original harness reported exactly that:
 * 409/409, neither side able to win). Releasing the leases first gives the round an unambiguous
 * starting state, so "exactly one wins" is a statement about the race.
 */
async function releaseAllLeases(): Promise<number | null> {
  if (!DESTRUCTIVE_CLEANUP_ALLOWED) {
    console.log("[isolation] lease release skipped: set HARNESS_ALLOW_DESTRUCTIVE_CLEANUP=1 on a throwaway database");
    return null;
  }
  return await dbProbe(async (c) => {
    // Scoped to leases this run took: releasing someone else's live lease would remove their
    // protection and let a second cycle open on a machine that is still mining.
    const result = await c["leases"].updateMany(
      { status: "active", leasedAt: { $gte: new Date(RUN_STARTED_MS) } },
      { $set: { status: "released", updatedAt: new Date() } },
    );
    return result.modifiedCount ?? 0;
  });
}

/**
 * Releases only the leases one harness account holds. Always safe: the rows are the test's own, and
 * the scenario needs the state an attacker claims to be in ("trust earned, nothing running").
 */
async function releaseOwnLeases(ownerUserId: string): Promise<number | null> {
  return await dbProbe(async (c) => {
    const result = await c["leases"].updateMany(
      { ownerUserId, status: "active" },
      { $set: { status: "released", updatedAt: new Date() } },
    );
    return result.modifiedCount ?? 0;
  });
}

/**
 * Closes one harness account's active cycles the way an expired window is closed, so the account can
 * start again. Only ever called for accounts this run created: it posts no settlement, which would
 * strand the rewards of a real customer.
 */
async function settleOwnSessions(ownerUserId: string): Promise<number | null> {
  return await dbProbe(async (c) => {
    const result = await c["sessions"].updateMany(
      { ownerUserId, status: "active" },
      { $set: { status: "settled", updatedAt: new Date() } },
    );
    return result.modifiedCount ?? 0;
  });
}

/** One device cluster's server-owned state, read where it is written (null when the probe is down). */
async function deviceState(webglFingerprintHash: string): Promise<Record<string, any> | null> {
  return await dbProbe(async (c) => c["devices"].findOne(
    { webglFingerprintHash },
    { projection: { publicId: 1, admissionCount: 1, proofCount: 1, trustState: 1, networkTrusts: 1 } },
  )) as Record<string, any> | null;
}

/** Live leases / active cycles in the database the API is configured against. */
async function liveStateCounts(): Promise<{ leases: number | null; sessions: number | null }> {
  const counts = await dbProbe(async (c) => ({
    leases: await c["leases"].countDocuments({ status: "active" }),
    sessions: await c["sessions"].countDocuments({ status: "active" }),
  }));
  return counts ?? { leases: null, sessions: null };
}

/**
 * A verdict the harness must never read as a security result: the scenario could not run its course
 * because the test setup itself (a spent budget, an unreachable probe) stopped it.
 */
const BLOCKED_BY_TEST_SETUP: Verdict = "BLOCKED-BY-TEST-SETUP";

/** What the drift phase actually isolated, so the report can show it rather than assert it. */
const driftIsolation: { leasesReleased: number | null; quotaRowsCleared: number | null } = { leasesReleased: null, quotaRowsCleared: null };

/** True when a start was refused by the identity budget rather than by a device rule. */
const isBudgetRefusal = (code: string | null): boolean => code === "mining_device_enrollment_limited";

/** Machine identities (device records) created at or after a wall-clock instant. */
async function clustersSince(sinceMs: number): Promise<number | null> {
  return dbProbe(async (c) => c["devices"].countDocuments({ firstSeenAt: { $gte: new Date(sinceMs) } }));
}

async function directAccount(label: string): Promise<{ email: string; token: string; csrf: string; userId: string }> {
  await paceRegister();
  const csrf0 = await apiCall("/api/v1/auth/csrf");
  const email = `${RUN}.${label}.${Math.random().toString(36).slice(2)}@example.test`;
  const reg = await apiCall("/api/v1/auth/register", { method: "POST", csrf: csrf0.body?.csrfToken, body: { email, password: PASSWORD, displayName: `H ${label}` } });
  if (reg.status !== 201) throw new Error(`direct register failed: ${reg.status} ${JSON.stringify(reg.body)}`);
  const token = String(reg.body.accessToken ?? "");
  // The account id is only needed to plant an expired nonce row in the database probe; the access
  // token is a JWT and its payload carries it. Decoded, never verified — this is a test client.
  let userId = "";
  try {
    const part = token.split(".")[1] ?? "";
    userId = (JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as { sub?: string }).sub ?? "";
  } catch {
    userId = "";
  }
  return { email, token, csrf: reg.body.csrfToken, userId };
}

// ---------------------------------------------------------------------------
// Scenario suite
// ---------------------------------------------------------------------------

/**
 * Derived security metrics. Deliberately explicit about which scenario verdicts feed each figure:
 * a rate the harness cannot observe (a false merge, for instance) is reported as null, never
 * guessed.
 */
async function computeMetrics(runStartedAt: number): Promise<Record<string, unknown>> {
  const byId = new Map(results.map((r) => [r.id, r]));
  const verdict = (id: string): Verdict | "NOT RUN" => byId.get(id)?.finalResult ?? "NOT RUN";
  const blockedOver = (ids: string[]): { blocked: number; total: number; rate: number | null } => {
    const present = ids.map((id) => byId.get(id)).filter((r): r is ScenarioResult => r !== undefined);
    const blocked = present.filter((r) => r.finalResult === "BLOCKED").length;
    return { blocked, total: present.length, rate: present.length > 0 ? Math.round((blocked / present.length) * 100) / 100 : null };
  };
  // Scenarios in which a second account (or a replayed/forged caller) must NOT obtain a cycle:
  // they are all attempts on a machine identity that is already known or already leased.
  const sameMachineIds = ["BASELINE-A2", "STORAGE-WIPE", "UA-SWITCH", "CROSS-BROWSER", "CROSS-ENGINE", "API-KEY-REPLACEMENT", "API-IDENTITY-STOCKPILE"];
  const proofAttacks = ["PROOF-REPLAY", "PROOF-WRONG-ACCOUNT", "PROOF-WRONG-KEY", "PROOF-MALFORMED-JWK", "PROOF-ALTERED-CHALLENGE", "PROOF-BARE-NONCE", "PROOF-CROSS-ORIGIN", "PROOF-EXPIRED-SIMULATED"];
  const clusterCount = await clustersSince(runStartedAt);
  return {
    runStartedAt: new Date(runStartedAt).toISOString(),
    clustersCreatedDuringRun: clusterCount,
    sameMachine: blockedOver(sameMachineIds),
    proofAttacks: blockedOver(proofAttacks),
    verdicts: Object.fromEntries(results.map((r) => [r.id, r.finalResult])),
    secondAccountBlockRate: blockedOver(["BASELINE-A2", "STORAGE-WIPE", "UA-SWITCH", "CROSS-BROWSER", "API-KEY-REPLACEMENT", "API-IDENTITY-STOCKPILE"]).rate,
    sameMachineRecognitionRate: blockedOver(sameMachineIds).rate,
    falseSplitRate: blockedOver(sameMachineIds).rate === null ? null : 1 - (blockedOver(sameMachineIds).rate ?? 0),
    falseMergeRate: null,
    identityCreationSuccess: { attempts: 19, clustersCreated: clusterCount, note: "12 rotation + 6 account rotation + 1 first forge; clusters counted from firstSeenAt >= run start" },
    identityPoisoningSuccessCount: verdict("API-KEY-REPLACEMENT") === "ALLOWED" ? 1 : 0,
    browserKeyReplacementSuccessCount: verdict("API-KEY-REPLACEMENT") === "ALLOWED" ? 1 : 0,
    replaySuccessCount: ["PROOF-REPLAY", "PROOF-CROSS-ORIGIN", "PROOF-EXPIRED-SIMULATED"].filter((id) => verdict(id) !== "BLOCKED" && verdict(id) !== "NOT RUN").length,
    // A race "success" for an attacker is two winners. An INCONCLUSIVE round (neither side won) is
    // not a success and is not protection either — the rate below says out loud which it was.
    concurrentLeaseRaceSuccessCount: ["RACE-2-BROWSERS", "API-CONCURRENT-10"].filter((id) => verdict(id) === "ALLOWED").length,
    concurrentLeaseRaceInconclusive: ["RACE-2-BROWSERS", "API-CONCURRENT-10"].filter((id) => verdict(id) === "INCONCLUSIVE").length,
    concurrentSessionCreationSuccessCount: verdict("API-CONCURRENT-10") === "ALLOWED" ? 1 : 0,
    // Any scenario the test's own setup throttled, listed by id so it can never be read as a security
    // verdict: these are re-run with an isolated budget before they mean anything.
    blockedByTestSetup: results.filter((r) => r.finalResult === "BLOCKED-BY-TEST-SETUP").map((r) => r.id),
    inconclusive: results.filter((r) => r.finalResult === "INCONCLUSIVE").map((r) => r.id),
    // Drift tolerance is the property the SIM-* phase exists to measure, with its isolation recorded
    // alongside it (the phase releases live leases and clears the spent identity budget first).
    driftIsolation: { leasesReleased: driftIsolation.leasesReleased, quotaRowsCleared: driftIsolation.quotaRowsCleared },
    proofBypassCount: proofAttacks.filter((id) => verdict(id) !== "BLOCKED" && verdict(id) !== "NOT RUN").length,
    // A direct-API spoof "succeeds" when a caller invents a machine and ends up mining on it. The
    // forge scenario is the one that measures exactly that (rotation stays BLOCKED for other reasons,
    // so reading this metric off rotation — as this harness originally did — reported 0 while the
    // real bypass was open). `API-FORGE-NEW-MACHINE` answers every challenge the server issues before
    // it is judged, so its verdict cannot be an intermediate "we asked them to verify".
    directApiSpoofSuccessCount:
      ["API-FORGE-NEW-MACHINE", "API-IDENTITY-ROTATION", "API-ACCOUNT-ROTATION"].filter((id) => verdict(id) === "ALLOWED").length,
    directApiSpoofVerdicts: {
      "API-FORGE-NEW-MACHINE": verdict("API-FORGE-NEW-MACHINE"),
      "API-IDENTITY-ROTATION": verdict("API-IDENTITY-ROTATION"),
      "API-ACCOUNT-ROTATION": verdict("API-ACCOUNT-ROTATION"),
    },
    // The "earn trust while no cycle runs, then run beside a victim" bypass, in its two shapes: an
    // identity whose trust came from a burst of assessed requests, and one that is globally trusted
    // but never mined on this network. ALLOWED in either of the first two means the bypass is open;
    // the third is the honest second device and must stay ALLOWED (a refusal there is a false deny).
    bootstrapThenParallel: {
      "API-BOOTSTRAP-THEN-PARALLEL": verdict("API-BOOTSTRAP-THEN-PARALLEL"),
      "API-GLOBAL-TRUST-PARALLEL": verdict("API-GLOBAL-TRUST-PARALLEL"),
      "API-NETWORK-RESIDENT-PARALLEL": verdict("API-NETWORK-RESIDENT-PARALLEL"),
    },
    bootstrapBypassSuccessCount: ["API-BOOTSTRAP-THEN-PARALLEL", "API-GLOBAL-TRUST-PARALLEL"].filter((id) => verdict(id) === "ALLOWED").length,
    networkResidentFalseDenialCount: verdict("API-NETWORK-RESIDENT-PARALLEL") === "BLOCKED" ? 1 : 0,
  };
}

async function main(): Promise<void> {
  const runStartedAt = RUN_STARTED_MS;
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
    // CROSS-BROWSER: real Edge profile on the same physical machine.
    // Edge is Chromium, i.e. the SAME engine as Chrome with a different profile — this covers a
    // second profile/vendor build, not a second engine. A genuinely different engine is covered by
    // the Firefox run below (requires HARNESS_FIREFOX); without it no second-engine claim is made.
    // ------------------------------------------------------------------
    const emailE = `${RUN}.e.${Math.random().toString(36).slice(2)}@example.test`;
    await signup(edgeWs, emailE);
    outcome = await pressStart(edgeWs);
    record({
      id: "CROSS-BROWSER", name: "second real browser (Edge, same Chromium engine) on same machine", browser: "edge", context: "different profile, same engine",
      account: emailE, identityOutcome: "machine-key-correlated", clusterOutcome: "same-cluster", leaseOutcome: "conflict",
      finalResult: classifyStart(outcome.httpStatus, outcome.code), httpStatus: outcome.httpStatus, reasonCode: outcome.code,
      latencyMs: outcome.latencyMs, evidence: outcome.evidence,
      notes: "Edge is Chromium: same-engine coverage only. Set HARNESS_FIREFOX for the second-engine run.",
    });

    // ------------------------------------------------------------------
    // CROSS-ENGINE: a genuinely different browser engine on the same machine (opt-in via
    // HARNESS_FIREFOX, e.g. a Firefox binary). Without a second engine binary this step is
    // skipped openly — it must never be reported as covered by the Chromium pair above.
    // ------------------------------------------------------------------
    if (FIREFOX) {
      const firefox = launchBrowser(FIREFOX, "firefox", `${process.env["TEMP"] ?? "/tmp"}/lmdg-h-${RUN}-firefox`);
      try {
        const firefoxWs = await connectBrowser(firefox);
        const emailFx = `${RUN}.fx.${Math.random().toString(36).slice(2)}@example.test`;
        await signup(firefoxWs, emailFx);
        outcome = await pressStart(firefoxWs);
        record({
          id: "CROSS-ENGINE", name: "genuinely different engine (Firefox) on same machine", browser: "firefox", context: "different engine+profile",
          account: emailFx, identityOutcome: "machine-key-correlated", clusterOutcome: "same-cluster", leaseOutcome: "conflict",
          finalResult: classifyStart(outcome.httpStatus, outcome.code), httpStatus: outcome.httpStatus, reasonCode: outcome.code,
          latencyMs: outcome.latencyMs, evidence: outcome.evidence,
        });
      } finally {
        await shutdown(firefox).catch(() => undefined);
      }
    } else {
      console.log("HARNESS: HARNESS_FIREFOX is unset — no genuine second-engine run; CROSS-BROWSER covers Chromium only.");
    }

    // ------------------------------------------------------------------
    // RACE: two browsers starting at the same wall-clock moment
    // ------------------------------------------------------------------
    // Repeated, on an isolated state each round. The original single attempt inherited the lease a
    // previous scenario had already taken on this machine and reported 409/409 — neither side able to
    // win, which is not a race result at all. Each round now releases the live leases and the spent
    // identity budget first, uses two brand-new accounts, fires both starts in the same tick, and
    // records the winner, the loser and the resulting lease/session state.
    const raceRounds: Record<string, unknown>[] = [];
    const RACE_ROUNDS = 3;
    let raceLatency = 0;
    for (let round = 0; round < RACE_ROUNDS; round += 1) {
      const released = await releaseAllLeases();
      await resetEnrollmentBudget();
      const emailF = `${RUN}.race${round}f.${Math.random().toString(36).slice(2)}@example.test`;
      const emailG = `${RUN}.race${round}g.${Math.random().toString(36).slice(2)}@example.test`;
      await freshBrowserSession(edgeWs);
      await gotoAndSettle(edgeWs, "/signup");
      await signup(edgeWs, emailF);
      await freshBrowserSession(chromeWs);
      await gotoAndSettle(chromeWs, "/signup");
      await signup(chromeWs, emailG);
      // Same tick, both directions: the second argument is what makes them simultaneous rather than
      // two sequential requests that happen to look concurrent in the report.
      const [raceF, raceG] = await Promise.all([pressStart(edgeWs), pressStart(chromeWs)]);
      const allowances = [raceF, raceG].map((r) => classifyStart(r.httpStatus, r.code));
      const allowed = allowances.filter((v) => v === "ALLOWED").length;
      const after = await liveStateCounts();
      raceLatency = Math.max(raceLatency, raceF.latencyMs ?? 0, raceG.latencyMs ?? 0);
      raceRounds.push({
        round, releasedLeases: released, winner: allowed === 1 ? (allowances[0] === "ALLOWED" ? "edge" : "chrome") : null,
        statuses: `${raceF.httpStatus}/${raceG.httpStatus}`, codes: `${raceF.code ?? "-"} | ${raceG.code ?? "-"}`,
        allowed, activeLeasesAfter: after.leases, activeSessionsAfter: after.sessions,
      });
    }
    const decisive = raceRounds.filter((r) => r["allowed"] === 1).length;
    const doubleWin = raceRounds.filter((r) => r["allowed"] === 2).length;
    record({
      id: "RACE-2-BROWSERS", name: "two browsers racing start simultaneously (isolated, repeated)", browser: "chrome+edge", context: "concurrent",
      account: `${RACE_ROUNDS} rounds, two fresh accounts each`, identityOutcome: "same-machine", clusterOutcome: "same-cluster",
      leaseOutcome: doubleWin > 0 ? "two-winners" : decisive === RACE_ROUNDS ? "exactly-one" : "no-decisive-winner",
      // BLOCKED means the race behaved (exactly one cycle); ALLOWED means both accounts won, which is
      // the bypass; INCONCLUSIVE means neither side won and therefore nothing about the race was
      // measured. The last two must never be reported as race protection.
      finalResult: doubleWin > 0 ? "ALLOWED" : decisive === RACE_ROUNDS ? "BLOCKED" : "INCONCLUSIVE",
      httpStatus: null, reasonCode: raceRounds.map((r) => String(r["statuses"])).join(" "),
      latencyMs: raceLatency,
      evidence: `rounds=${RACE_ROUNDS} exactly-one=${decisive} two-winners=${doubleWin} ${JSON.stringify(raceRounds)}`,
      notes: "BLOCKED = exactly one lease/session; INCONCLUSIVE = neither side won, so race safety is UNPROVEN",
    });

    // ------------------------------------------------------------------
    // PROOF ATTACKS (direct API, exact HTTP semantics; real ECDSA keys via WebCrypto)
    // ------------------------------------------------------------------
    await proofAttacks();

    // ------------------------------------------------------------------
    // DIRECT-API IDENTITY ATTACKS: forged machines, identity rotation, stockpiling, races
    // ------------------------------------------------------------------
    await directIdentityAttacks();

    // ------------------------------------------------------------------
    // BOOTSTRAP-THEN-PARALLEL: trust built while nothing is mining, then used next to a victim
    // ------------------------------------------------------------------
    await bootstrapThenParallelScenario();

    // ------------------------------------------------------------------
    // DRIFT + NETWORK + FINGERPRINT-RANDOMIZATION (SIMULATED at the HTTP boundary)
    // ------------------------------------------------------------------
    await simulatedScenarios();
  } finally {
    await shutdown(chrome).catch(() => undefined);
    await shutdown(edge).catch(() => undefined);
  }

  const metrics = await computeMetrics(runStartedAt);
  console.log(`== metrics == ${JSON.stringify(metrics)}`);
  if (outPath) {
    writeFileSync(outPath, JSON.stringify({ run: RUN, generatedAt: new Date().toISOString(), frontend: FRONTEND, api: API, metrics, results }, null, 2));
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
  // A mismatched pair: signed by a different key than the presented JWK. (Signing with the wrong
  // key *and* presenting its matching public key is a valid proof, not an attack — it verifies by
  // construction and would wrongly record an error here.)
  const wrongKeyProof = await apiCall("/api/v1/mining/device/prove", { method: "POST", token: acct.token, csrf: acct.csrf, body: { nonce: ch3.body.nonce, signature: await sig(ch3.body.payload, wrongKey.privateKey), publicKeyJwk: jwk } });
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

  // Cross-origin replay: the challenge is answered on the legitimate origin, then the same signed
  // payload is presented with a foreign Origin — the origin the browser itself attaches is part of
  // the signed payload, so the signature verifies nowhere.
  const ch4 = await apiCall("/api/v1/mining/device/challenge", { method: "POST", token: acct.token, csrf: acct.csrf, body: {}, origin: FRONTEND });
  const ch4Signature = await sig(ch4.body.payload);
  const crossOrigin = await apiCall("/api/v1/mining/device/prove", {
    method: "POST", token: acct.token, csrf: acct.csrf, origin: "https://evil.example",
    body: { nonce: ch4.body.nonce, signature: ch4Signature, publicKeyJwk: jwk },
  });
  record({
    id: "PROOF-CROSS-ORIGIN", name: "proof answered on one origin, replayed from another", browser: "direct-api", context: "origin binding",
    account: acct.email, identityOutcome: "-", clusterOutcome: "-", leaseOutcome: "-",
    finalResult: crossOrigin.status === 401 ? "BLOCKED" : "ERROR", httpStatus: crossOrigin.status, reasonCode: crossOrigin.code, latencyMs: null, evidence: "api",
  });

  // Expired nonce: the expiry is written into the nonce record by the server, so the harness plants
  // an already-expired nonce for this account and presents it (SIMULATED expiry; the wall-clock wait
  // for a real 60s expiry is not spent here).
  const expiredInserted = await dbProbe(async (c) => {
    await c["nonces"].insertOne({
      publicId: `expired-${RUN}`, ownerUserId: acct.userId, deviceKeyHash: null, nonce: `expired-nonce-${RUN}`,
      issuedAt: new Date(Date.now() - 10 * 60_000), expiresAt: new Date(Date.now() - 5 * 60_000), consumedAt: null,
    });
    return true;
  });
  const expired = expiredInserted
    ? await apiCall("/api/v1/mining/device/prove", { method: "POST", token: acct.token, csrf: acct.csrf, body: { nonce: `expired-nonce-${RUN}`, signature: await sig("anything"), publicKeyJwk: jwk } })
    : null;
  record({
    id: "PROOF-EXPIRED-SIMULATED", name: "SIMULATED: already-expired nonce presented", browser: "direct-api", context: "nonce expiry",
    account: acct.email, identityOutcome: "-", clusterOutcome: "-", leaseOutcome: "-",
    finalResult: expired === null ? "ERROR" : expired.status === 401 ? "BLOCKED" : "ERROR", httpStatus: expired?.status ?? null, reasonCode: expired?.code ?? null, latencyMs: null, evidence: "api + planted-db-row",
    notes: "the nonce row is planted directly in MongoDB with a past expiry; no server behaviour is stubbed",
  });
}

/**
 * Direct-API identity attacks: the suite that measures whether a caller who skips the frontend can
 * MINT machine identities.
 *
 * Every payload here is a syntactically valid, internally consistent synthetic fingerprint with a
 * fresh browser key — i.e. exactly what a direct caller who is willing to lie looks like. The point
 * is not "can the caller get one device" (a brand-new real device must also be admitted) but "can
 * the caller get an unlimited supply of them".
 */

interface ForgeVariant {
  label: string;
  hardwareConcurrency: number;
  maxTouchPoints: number;
  audioSampleRate: number;
  audioChannels: number;
  colorGamut: string;
  hdr: boolean;
  screenColorDepth: number;
}

/** 12 distinct machine cores (the exact inputs the server hashes into a machine identity). */
function forgeVariants(): ForgeVariant[] {
  const cores = [2, 4, 8, 16, 32];
  const touchers = [0, 1, 5, 10];
  const rates = [44100, 48000, 96000];
  const gamuts = ["srgb", "p3", "rec2020"];
  const depths = [24, 30, 32];
  const out: ForgeVariant[] = [];
  for (let i = 0; i < 12; i++) {
    out.push({
      label: `v${i + 1}`,
      hardwareConcurrency: cores[i % cores.length]!,
      maxTouchPoints: touchers[Math.floor(i / cores.length) % touchers.length]!,
      audioSampleRate: rates[i % rates.length]!,
      audioChannels: (i % 2) + 1,
      colorGamut: gamuts[i % gamuts.length]!,
      hdr: i % 2 === 0,
      screenColorDepth: depths[i % depths.length]!,
    });
  }
  return out;
}

/** A complete synthetic device payload, consistent with itself and unique per call. */
function forgedEvidence(variant: ForgeVariant, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    visitorId: `fp-${RUN}-${variant.label}-${Math.random().toString(36).slice(2)}`,
    fingerprintConfidence: 0.99,
    fingerprintVersion: "v5",
    platform: "Win32",
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    platformVersion: "10.0.0",
    architecture: "x86",
    bitness: "64",
    screenWidth: 1920,
    screenHeight: 1080,
    screenAvailWidth: 1920,
    screenAvailHeight: 1040,
    screenColorDepth: variant.screenColorDepth,
    pixelRatio: 1,
    hardwareConcurrency: variant.hardwareConcurrency,
    deviceMemory: 8,
    maxTouchPoints: variant.maxTouchPoints,
    webglVendor: `vendor-${RUN}-${variant.label}`,
    webglRenderer: `ANGLE (${variant.label})`,
    webglLimitsHash: `limits-${RUN}-${variant.label}`,
    webglExtensionsHash: `ext-${RUN}-${variant.label}`,
    webgpuHash: `webgpu-${RUN}-${variant.label}`,
    audioSampleRate: variant.audioSampleRate,
    audioChannels: variant.audioChannels,
    colorGamut: variant.colorGamut,
    hdr: variant.hdr,
    canvasHash: `canvas-${RUN}-${variant.label}`,
    audioHash: `audio-${RUN}-${variant.label}`,
    fontsHash: `fonts-${RUN}-${variant.label}`,
    webglHash: `webgl-${RUN}-${variant.label}`,
    speechVoicesHash: `voices-${RUN}-${variant.label}`,
    timezone: "Europe/Berlin",
    timezoneOffsetMinutes: -60,
    locale: "de-DE",
    languages: "de-DE,de,en",
    language: "de-DE",
    mediaAudioInputs: 1,
    mediaVideoInputs: 1,
    storageQuotaBytes: 2 ** 32,
    pluginsHash: `plugins-${RUN}-${variant.label}`,
    mimeTypesHash: `mime-${RUN}-${variant.label}`,
    codecsHash: `codecs-${RUN}-${variant.label}`,
    keyboardLayoutHash: `kbd-${RUN}-${variant.label}`,
    pdfViewerEnabled: true,
    browserKeyPublicKey: JSON.stringify({ kty: "EC", crv: "P-256", x: `x-${RUN}-${variant.label}-${Math.random().toString(36).slice(2)}`, y: `y-${RUN}-${variant.label}`, ext: true }),
    integrity: { webdriver: false, headlessHint: false, impossibleUaPlatform: false, missingCapabilities: false },
    ...over,
  };
}

async function directIdentityAttacks(): Promise<void> {
  const variants = forgeVariants();

  // 1. One forged, internally consistent machine from one brand-new account.
  //
  // The forged machine carries a REAL browser key the attacker holds, and the scenario completes the
  // challenge when the server issues one. Recording only the first refusal would be dishonest: a
  // `mining_device_challenge_required` answer is not a denial, it is an invitation to prove
  // possession of a key this attacker generated moments ago. The verdict below is therefore the
  // FINAL start attempt, after every challenge the server asked for has been answered.
  const forgeAccount = await directAccount("forge");
  const forgeKp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const forgeJwk = await crypto.subtle.exportKey("jwk", forgeKp.publicKey);
  const forgeEvidence = forgedEvidence(variants[0]!, { browserKeyPublicKey: JSON.stringify(forgeJwk) });
  let forgeResult = await apiCall("/api/v1/mining/start", { method: "POST", token: forgeAccount.token, csrf: forgeAccount.csrf, body: { device: forgeEvidence } });
  const forgeSteps = [`start=${forgeResult.status}:${forgeResult.code ?? "-"}`];
  if (forgeResult.status === 409 && forgeResult.code === "mining_device_challenge_required") {
    const ch = await apiCall("/api/v1/mining/device/challenge", { method: "POST", token: forgeAccount.token, csrf: forgeAccount.csrf, body: { device: forgeEvidence } });
    forgeSteps.push(`challenge=${ch.status}`);
    if (ch.status === 200) {
      const signature = Buffer.from(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, forgeKp.privateKey, new TextEncoder().encode(String(ch.body.payload)))).toString("base64url");
      const proof = await apiCall("/api/v1/mining/device/prove", { method: "POST", token: forgeAccount.token, csrf: forgeAccount.csrf, body: { nonce: ch.body.nonce, signature, publicKeyJwk: forgeJwk, device: forgeEvidence } });
      forgeSteps.push(`prove=${proof.status}`);
      forgeResult = await apiCall("/api/v1/mining/start", { method: "POST", token: forgeAccount.token, csrf: forgeAccount.csrf, body: { device: forgeEvidence } });
      forgeSteps.push(`retry=${forgeResult.status}:${forgeResult.code ?? "-"}`);
    }
  }
  // The assertion that matters is not the status code but the state it left behind: a refused start
  // that still created an active lease would be a bypass wearing a 4xx. Read it where leases and
  // cycles actually live.
  const forgeLeases = await dbProbe(async (c) => await c["leases"].countDocuments({ ownerUserId: forgeAccount.userId, status: "active" }));
  const forgeSessions = await dbProbe(async (c) => await c["sessions"].countDocuments({ ownerUserId: forgeAccount.userId, status: "active" }));
  record({
    id: "API-FORGE-NEW-MACHINE", name: "direct API invents a new machine identity, then answers every challenge", browser: "direct-api", context: "forged consistent fingerprint + self-generated key",
    account: forgeAccount.email, identityOutcome: "new-cluster", clusterOutcome: forgeResult.status === 200 ? "enrolled-and-mining" : "enrolled-untrusted",
    leaseOutcome: forgeResult.status === 200 ? "active" : (forgeLeases === null ? "unknown" : `none(leases=${forgeLeases} sessions=${forgeSessions ?? "?"})`),
    finalResult: classifyStart(forgeResult.status, forgeResult.code), httpStatus: forgeResult.status, reasonCode: forgeResult.code, latencyMs: null,
    evidence: `api | ${forgeSteps.join(" ")} | active-leases=${forgeLeases ?? "?"} active-sessions=${forgeSessions ?? "?"}`,
    notes: "regression for the measured bypass: proof of a key the caller generated must not clear the network lock nor leave an active lease",
  });

  // 2. IDENTITY ROTATION: one account, 12 different forged machines, fresh browser key each time.
  // Measures the classic "keep generating new identities" attack.
  const rotationStart = Date.now();
  const rotation: { status: number; code: string | null }[] = [];
  for (const variant of variants) {
    const res = await apiCall("/api/v1/mining/start", { method: "POST", token: forgeAccount.token, csrf: forgeAccount.csrf, body: { device: forgedEvidence(variant) } });
    rotation.push({ status: res.status, code: res.code });
  }
  const rotationAllowed = rotation.filter((r) => r.status === 200).length;
  const rotationBlocked = rotation.filter((r) => r.status >= 400).length;
  const rotationClusters = await clustersSince(rotationStart);
  const rotationCodes = [...new Set(rotation.map((r) => `${r.status}:${r.code ?? "-"}`))].join(" ");
  record({
    id: "API-IDENTITY-ROTATION", name: "one account rotates 12 forged machine identities", browser: "direct-api", context: "identity churn",
    account: forgeAccount.email, identityOutcome: `new-clusters=${rotationClusters ?? "?"}`, clusterOutcome: `allowed=${rotationAllowed} blocked=${rotationBlocked}`, leaseOutcome: "-",
    finalResult: rotationBlocked === 0 ? "ALLOWED" : "BLOCKED", httpStatus: null, reasonCode: rotationCodes, latencyMs: null,
    evidence: `api | allowed=${rotationAllowed}/12 blocked=${rotationBlocked}/12 new-machine-identities=${rotationClusters ?? "?"}`,
    notes: "success = the count of NEW trusted machine identities stays bounded, not 12",
  });

  // 3. ACCOUNT ROTATION: three fresh accounts, two forged machines each — the multi-account version.
  const acctRotationStart = Date.now();
  const acctRotation: { status: number; code: string | null }[] = [];
  for (let a = 0; a < 3; a++) {
    const acct = await directAccount(`rot${a}`);
    for (const variant of [variants[(a * 2) % variants.length]!, variants[(a * 2 + 1) % variants.length]!]) {
      const res = await apiCall("/api/v1/mining/start", { method: "POST", token: acct.token, csrf: acct.csrf, body: { device: forgedEvidence(variant) } });
      acctRotation.push({ status: res.status, code: res.code });
    }
  }
  const acctAllowed = acctRotation.filter((r) => r.status === 200).length;
  const acctClusters = await clustersSince(acctRotationStart);
  record({
    id: "API-ACCOUNT-ROTATION", name: "three accounts each forge two machine identities", browser: "direct-api", context: "multi-account identity churn",
    account: "3 fresh accounts", identityOutcome: `new-clusters=${acctClusters ?? "?"}`, clusterOutcome: `allowed=${acctAllowed}/6`, leaseOutcome: "-",
    finalResult: acctAllowed >= 6 ? "ALLOWED" : "BLOCKED", httpStatus: null, reasonCode: [...new Set(acctRotation.map((r) => `${r.status}:${r.code ?? "-"}`))].join(" "), latencyMs: null,
    evidence: `api | allowed=${acctAllowed}/6 new-machine-identities=${acctClusters ?? "?"}`,
  });

  // 4. Inconsistent claims: contradictory UA/platform plus absurd hardware values.
  const inconsistent = await directAccount("inconsistent");
  const bogus = await apiCall("/api/v1/mining/start", {
    method: "POST", token: inconsistent.token, csrf: inconsistent.csrf,
    body: {
      device: forgedEvidence(variants[1]!, {
        platform: "MacIntel",
        userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
        hardwareConcurrency: 4096,
        deviceMemory: 4096,
        maxTouchPoints: 999,
        screenColorDepth: 999,
        hdr: true,
        colorGamut: "rec2020",
        pixelRatio: 99,
        timezoneOffsetMinutes: -99999,
        languages: "",
        integrity: { webdriver: true, headlessHint: true, impossibleUaPlatform: true, missingCapabilities: true },
      }),
    },
  });
  record({
    id: "API-INCONSISTENT-CLAIMS", name: "internally contradictory / impossible evidence", browser: "direct-api", context: "consistency engine",
    account: inconsistent.email, identityOutcome: "inconsistent", clusterOutcome: "-", leaseOutcome: "-",
    finalResult: classifyStart(bogus.status, bogus.code), httpStatus: bogus.status, reasonCode: bogus.code, latencyMs: null, evidence: "api",
    notes: "expected after hardening: challenge or denial, never a silent trusted allow",
  });

  // 5. Malformed + missing evidence (must stay refused).
  const malformedAcct = await directAccount("malformed");
  const malformed = await apiCall("/api/v1/mining/start", {
    method: "POST", token: malformedAcct.token, csrf: malformedAcct.csrf,
    body: { device: { hardwareConcurrency: "many", maxTouchPoints: {}, platform: 42, integrity: "yes" } },
  });
  record({
    id: "API-MALFORMED-EVIDENCE", name: "malformed evidence payload", browser: "direct-api", context: "type confusion",
    account: malformedAcct.email, identityOutcome: "-", clusterOutcome: "-", leaseOutcome: "-",
    finalResult: malformed.status >= 400 ? "BLOCKED" : "ERROR", httpStatus: malformed.status, reasonCode: malformed.code, latencyMs: null, evidence: "api",
  });
  const missing = await apiCall("/api/v1/mining/start", { method: "POST", token: malformedAcct.token, csrf: malformedAcct.csrf, body: {} });
  record({
    id: "API-MISSING-EVIDENCE", name: "start with no device evidence at all", browser: "direct-api", context: "evidence omission",
    account: malformedAcct.email, identityOutcome: "-", clusterOutcome: "-", leaseOutcome: "-",
    finalResult: missing.status >= 400 ? "BLOCKED" : "ERROR", httpStatus: missing.status, reasonCode: missing.code, latencyMs: null, evidence: "api",
  });

  // 6. Key replacement against a machine identity already seen, from a second account.
  const keyA = await directAccount("keyrot-a");
  const keyB = await directAccount("keyrot-b");
  const sharedMachine = variants[3]!;
  const machineStart = await apiCall("/api/v1/mining/start", { method: "POST", token: keyA.token, csrf: keyA.csrf, body: { device: forgedEvidence(sharedMachine) } });
  const replacedKey = await apiCall("/api/v1/mining/start", {
    method: "POST", token: keyB.token, csrf: keyB.csrf,
    body: { device: forgedEvidence(sharedMachine, { userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36", platform: "MacIntel" }) },
  });
  record({
    id: "API-KEY-REPLACEMENT", name: "new key + rewritten presentation on an already-known machine", browser: "direct-api", context: "key replacement + trait rewrite",
    account: keyB.email, identityOutcome: machineStart.status === 200 ? "machine-established-by-A" : "-", clusterOutcome: "-", leaseOutcome: replacedKey.status === 409 ? "conflict" : "-",
    finalResult: classifyStart(replacedKey.status, replacedKey.code), httpStatus: replacedKey.status, reasonCode: replacedKey.code, latencyMs: null, evidence: "api",
    notes: "expected: the machine identity is not replaced and the second account does not start",
  });

  // 7. Concurrent enrollment race: ten simultaneous starts, one forged machine, two accounts.
  const raceA = await directAccount("conc-a");
  const raceB = await directAccount("conc-b");
  const raceVariant = variants[5]!;
  const raceEvidence = forgedEvidence(raceVariant);
  const attempts = await Promise.all([
    ...Array.from({ length: 5 }, () => apiCall("/api/v1/mining/start", { method: "POST", token: raceA.token, csrf: raceA.csrf, body: { device: raceEvidence } })),
    ...Array.from({ length: 5 }, () => apiCall("/api/v1/mining/start", { method: "POST", token: raceB.token, csrf: raceB.csrf, body: { device: raceEvidence } })),
  ]);
  const raceClusters = await clustersSince(raceVariant.label === "" ? Date.now() : Date.now() - 60_000);
  const activeLeases = await dbProbe(async (c) => c["leases"].countDocuments({ status: "active", leaseEndsAt: { $gt: new Date() } }));
  const raceAllowedA = attempts.slice(0, 5).filter((r) => r.status === 200).length;
  const raceAllowedB = attempts.slice(5).filter((r) => r.status === 200).length;
  record({
    id: "API-CONCURRENT-10", name: "10 concurrent starts on one forged device, two accounts", browser: "direct-api", context: "concurrency",
    account: `${raceA.email} + ${raceB.email}`, identityOutcome: `recent-clusters=${raceClusters ?? "?"}`, clusterOutcome: `accountA-200s=${raceAllowedA}/5 accountB-200s=${raceAllowedB}/5`, leaseOutcome: `active-leases-total=${activeLeases ?? "?"}`,
    // A double win is the measured attack succeeding, not an instrument error: reading it as ERROR
    // (as this scenario originally did) hid the bypass in the count that exists to report it.
    finalResult: raceAllowedA >= 1 && raceAllowedB >= 1 ? "ALLOWED" : "BLOCKED", httpStatus: null, reasonCode: [...new Set(attempts.map((r) => `${r.status}:${r.code ?? "-"}`))].join(" "), latencyMs: null,
    evidence: `api | A=${raceAllowedA}/5 B=${raceAllowedB}/5`, notes: "expected: only ONE account obtains the cycle on this machine identity; ALLOWED = both did (the bypass)",
  });

  // 8. Identity stockpiling: mint identities from many accounts while a lease is active, then check
  //    whether a later account can mine on one of those pre-created identities.
  const stockpileTarget = variants[9]!;
  const stockpileStart = await apiCall("/api/v1/mining/start", { method: "POST", token: forgeAccount.token, csrf: forgeAccount.csrf, body: { device: forgedEvidence(stockpileTarget) } });
  const stockpileB = await directAccount("stockpile-b");
  const stockpileUse = await apiCall("/api/v1/mining/start", { method: "POST", token: stockpileB.token, csrf: stockpileB.csrf, body: { device: forgedEvidence(stockpileTarget) } });
  record({
    id: "API-IDENTITY-STOCKPILE", name: "pre-minted identity reused by a second account", browser: "direct-api", context: "identity stockpiling",
    account: stockpileB.email, identityOutcome: stockpileStart.status === 200 ? "minted" : "refused", clusterOutcome: "-", leaseOutcome: stockpileUse.status === 409 ? "conflict" : "-",
    finalResult: classifyStart(stockpileUse.status, stockpileUse.code), httpStatus: stockpileUse.status, reasonCode: stockpileUse.code, latencyMs: null, evidence: "api",
    notes: "expected: a second account cannot open a second cycle on a pre-minted identity",
  });
}

/** The machine traits that separate one simulated machine from another (the machine-key inputs). */
interface MachineCore {
  hardwareConcurrency: number;
  maxTouchPoints: number;
  audioSampleRate: number;
  audioChannels: number;
  colorGamut: string;
  hdr: boolean;
  screenColorDepth: number;
}

/** A victim machine and forged attackers that share no core trait (never one machine's twin). */
const VICTIM_CORE: MachineCore = { hardwareConcurrency: 8, maxTouchPoints: 0, audioSampleRate: 44100, audioChannels: 1, colorGamut: "srgb", hdr: false, screenColorDepth: 24 };
const FORGED_CORE: MachineCore = { hardwareConcurrency: 32, maxTouchPoints: 10, audioSampleRate: 96000, audioChannels: 2, colorGamut: "rec2020", hdr: true, screenColorDepth: 32 };

/**
 * Presses start and answers any risk challenge the server asks for, up to a bounded number of
 * rounds. A `mining_device_challenge_required` answer is an invitation to prove, not a refusal, so
 * a scenario that stops there would report a state the server never reached.
 */
async function startAnsweringChallenges(
  account: { token: string; csrf: string },
  evidence: Record<string, unknown>,
  keyPair: CryptoKeyPair,
  jwk: Record<string, unknown>,
  rounds = 2,
): Promise<{ final: { status: number; code: string | null }; steps: string[] }> {
  const steps: string[] = [];
  let result = await apiCall("/api/v1/mining/start", { method: "POST", token: account.token, csrf: account.csrf, body: { device: evidence } });
  steps.push(`start=${result.status}:${result.code ?? "-"}`);
  for (let round = 0; round < rounds && result.status === 409 && result.code === "mining_device_challenge_required"; round += 1) {
    const challenge = await apiCall("/api/v1/mining/device/challenge", { method: "POST", token: account.token, csrf: account.csrf, body: { device: evidence } });
    steps.push(`challenge=${challenge.status}`);
    if (challenge.status !== 200) break;
    const signature = Buffer.from(
      await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, keyPair.privateKey, new TextEncoder().encode(String(challenge.body?.payload ?? ""))),
    ).toString("base64url");
    const proof = await apiCall("/api/v1/mining/device/prove", {
      method: "POST", token: account.token, csrf: account.csrf,
      body: { nonce: challenge.body?.nonce, signature, publicKeyJwk: jwk, device: evidence },
    });
    steps.push(`prove=${proof.status}`);
    result = await apiCall("/api/v1/mining/start", { method: "POST", token: account.token, csrf: account.csrf, body: { device: evidence } });
    steps.push(`retry=${result.status}:${result.code ?? "-"}`);
  }
  return { final: { status: result.status, code: result.code }, steps };
}

/**
 * The bootstrap-then-parallel bypass: earn trust for a forged identity while nothing is mining, then
 * use it beside another account's live cycle on the same network.
 *
 * Three shapes are measured with their own account and forged machine each, all on the harness's one
 * client address (the network lock's unit):
 *
 *   1. `API-BOOTSTRAP-THEN-PARALLEL` — the cheap bootstrap: a burst of concurrent starts that only
 *      one committed cycle can win (the earlier code credited one admission per *request*, which is
 *      what made three simultaneous requests enough to look established).
 *   2. `API-GLOBAL-TRUST-PARALLEL` — the identity is trusted (`established`) but has never mined on
 *      this network: trust earned elsewhere/earlier must not surface here.
 *   3. `API-NETWORK-RESIDENT-PARALLEL` — trusted *and* credited on this network: the honest second
 *      device, which must stay ALLOWED (its refusal would be a false denial).
 *
 * The forged device records are created before the victim starts (while the network is free — an
 * identity cannot be enrolled behind an occupied network by design), then this run's leases and
 * cycles for those accounts are released/closed so the state under test really is "trust earned,
 * nothing running". Only then does the victim start, and the parallel attempts are measured against
 * its live lease.
 */
async function bootstrapThenParallelScenario(): Promise<void> {
  const victimCore = { ...VICTIM_CORE };
  const forgedCore = { ...FORGED_CORE };
  const machine = (core: MachineCore): Record<string, unknown> => ({
    hardwareConcurrency: core.hardwareConcurrency, maxTouchPoints: core.maxTouchPoints,
    audioSampleRate: core.audioSampleRate, audioChannels: core.audioChannels,
    colorGamut: core.colorGamut, hdr: core.hdr, screenColorDepth: core.screenColorDepth,
  });
  const keyFor = async () => {
    const keyPair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
    const jwk = (await crypto.subtle.exportKey("jwk", keyPair.publicKey)) as Record<string, unknown>;
    return { keyPair, jwk };
  };
  /** One forged machine: its own core traits, its own rendering hashes, its own browser key. */
  const evidenceWithCore = (label: string, core: MachineCore, jwk: Record<string, unknown>): Record<string, unknown> =>
    forgedEvidence(forgeVariants()[0]!, {
      ...machine(core),
      webglHash: `webgl-${RUN}-${label}`,
      webglRenderer: `ANGLE (${label})`,
      canvasHash: `canvas-${RUN}-${label}`,
      browserKeyPublicKey: JSON.stringify(jwk),
    });
  // Distinct machine cores per identity (the machine key must not merge them): the forged devices are
  // given cores that differ from each other and from the victim in every trait that forms the key.
  const forgedCores: MachineCore[] = [
    forgedCore,
    { ...forgedCore, hardwareConcurrency: 16, maxTouchPoints: 1, audioSampleRate: 44100, screenColorDepth: 30, colorGamut: "p3", hdr: false },
    { ...forgedCore, hardwareConcurrency: 4, maxTouchPoints: 5, audioSampleRate: 48000, screenColorDepth: 24, colorGamut: "srgb", hdr: true },
  ];
  const attackAccount = await directAccount("bp-main");
  const globalAccount = await directAccount("bp-global");
  const residentAccount = await directAccount("bp-resident");
  const victimAccount = await directAccount("bp-victim");
  const attackKey = await keyFor();
  const globalKey = await keyFor();
  const residentKey = await keyFor();
  const victimKey = await keyFor();
  const attackerLabels = ["bp-main", "bp-global", "bp-resident"];
  const attackerEvidence = [attackerLabels[0]!, attackerLabels[1]!, attackerLabels[2]!].map((label, index) =>
    evidenceWithCore(label, forgedCores[index]!, [attackKey, globalKey, residentKey][index]!.jwk),
  );
  // The victim is a different *machine*, not only different core counts: its platform, display,
  // memory, locale and network timezone are all its own, so the correlation matcher has no reason to
  // fold it into a forged cluster (which would make every measurement below meaningless).
  const victimEvidence = {
    ...evidenceWithCore("bp-victim", victimCore, victimKey.jwk),
    platform: "MacIntel",
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    screenWidth: 2560, screenHeight: 1440, screenAvailWidth: 2560, screenAvailHeight: 1370,
    deviceMemory: 16, pixelRatio: 2,
    timezone: "America/New_York", timezoneOffsetMinutes: 300, locale: "en-US", languages: "en-US,en", language: "en-US",
  };

  // Isolation: the phases above leave live leases and spend the per-network identity budget, and a
  // victim that cannot start (or a forged enrollment refused by a spent *test* budget) says nothing
  // about the rule under test. Both writes need `HARNESS_ALLOW_DESTRUCTIVE_CLEANUP=1`; without it the
  // scenario still runs, but a refusal caused by the inherited state is reported as INCONCLUSIVE
  // rather than as a block.
  const releasedBefore = await releaseAllLeases();
  const budgetBefore = await resetEnrollmentBudget();
  console.log(`[bootstrap-then-parallel] isolation: released_leases=${releasedBefore} quota_rows_cleared=${budgetBefore}`);

  // --- Phase 1: create the three forged identities while nothing is mining.
  // The main attacker uses the shape the bypass used: three simultaneous starts, one of which can
  // commit a cycle. The other two are ordinary single enrollments (a control needs a record, not a
  // burst).
  const burst = await Promise.all(
    Array.from({ length: 3 }, () => apiCall("/api/v1/mining/start", { method: "POST", token: attackAccount.token, csrf: attackAccount.csrf, body: { device: attackerEvidence[0] } })),
  );
  const burstStatuses = burst.map((entry) => `${entry.status}:${entry.code ?? "-"}`).join(" ");
  const attackBootstrap = await deviceState(`webgl-${RUN}-${attackerLabels[0]}`);
  const globalBootstrap = await startAnsweringChallenges(globalAccount, attackerEvidence[1]!, globalKey.keyPair, globalKey.jwk);
  const residentBootstrap = await startAnsweringChallenges(residentAccount, attackerEvidence[2]!, residentKey.keyPair, residentKey.jwk);

  // --- Phase 2: the state the attacker claims — trust earned, nothing running.
  await releaseOwnLeases(attackAccount.userId);
  await releaseOwnLeases(globalAccount.userId);
  await releaseOwnLeases(residentAccount.userId);
  await settleOwnSessions(attackAccount.userId);
  await settleOwnSessions(globalAccount.userId);
  await settleOwnSessions(residentAccount.userId);

  // --- Phase 3: the victim mines on this network. Everything below is measured beside its lease.
  const victimOutcome = await startAnsweringChallenges(victimAccount, victimEvidence, victimKey.keyPair, victimKey.jwk);
  const victimVerdict = classifyStart(victimOutcome.final.status, victimOutcome.final.code);
  const victimLeases = await liveStateCounts();
  const networkHash = ((attackBootstrap?.["networkTrusts"] ?? []) as { ipHash?: string }[])[0]?.ipHash ?? `network-${RUN}`;
  const forgedCoreState = (state: Record<string, any> | null): string =>
    state
      ? `admissions=${state["admissionCount"] ?? "?"} trust=${state["trustState"] ?? "?"} networkCredits=${Array.isArray(state["networkTrusts"]) ? (state["networkTrusts"] as unknown[]).length : 0}`
      : "unread";

  const recordParallel = (id: string, name: string, outcome: { final: { status: number; code: string | null }; steps: string[] }, state: Record<string, any> | null, notes: string): void => {
    record({
      id, name, browser: "direct-api", context: "bootstrap-then-parallel",
      account: `${RUN} forged identity beside a live victim cycle`,
      identityOutcome: forgedCoreState(state),
      clusterOutcome: "forged-identity",
      leaseOutcome: outcome.final.status === 200 ? "active" : "none",
      finalResult: victimVerdict === "ALLOWED" ? classifyStart(outcome.final.status, outcome.final.code) : "INCONCLUSIVE",
      httpStatus: outcome.final.status, reasonCode: outcome.final.code, latencyMs: null,
      evidence: `api | victim=${victimOutcome.final.status}:${victimOutcome.final.code ?? "-"} bootstrap=[${outcome.steps.join(" ")}] network-active=${JSON.stringify(victimLeases)}`,
      notes: victimVerdict === "ALLOWED" ? notes : `victim could not mine on this network (${victimOutcome.final.status}:${victimOutcome.final.code ?? "-"}) — no parallel state to measure`,
    });
  };

  // 1. The cheap bootstrap: trust from a burst of assessed requests, then used beside the victim.
  const attackParallel = await startAnsweringChallenges(attackAccount, attackerEvidence[0]!, attackKey.keyPair, attackKey.jwk);
  const afterParallel = await liveStateCounts();
  recordParallel(
    "API-BOOTSTRAP-THEN-PARALLEL",
    "forged identity whose trust came from concurrent starts, then used beside a live cycle",
    { final: attackParallel.final, steps: [`burst=[${burstStatuses}]`, ...attackParallel.steps] },
    attackBootstrap,
    "BLOCKED = the burst did not establish the identity and the network lock held; ALLOWED = the identity mined beside the victim",
  );

  // 2. Globally trusted, never mined here: trust must not travel between networks.
  const globalState = await deviceState(`webgl-${RUN}-${attackerLabels[1]}`);
  if (globalState) {
    await dbProbe(async (c) => c["devices"].updateOne(
      { publicId: globalState["publicId"] },
      { $set: { trustState: "established", establishedAt: new Date(), admissionCount: 3 } },
    ));
  }
  const globalParallel = await startAnsweringChallenges(globalAccount, attackerEvidence[1]!, globalKey.keyPair, globalKey.jwk);
  recordParallel(
    "API-GLOBAL-TRUST-PARALLEL",
    "globally established identity that never mined on this network, used beside a live cycle",
    globalParallel,
    await deviceState(`webgl-${RUN}-${attackerLabels[1]}`),
    "BLOCKED = trust is scoped to the network it was earned on; ALLOWED = a global flag still exempts a stranger here",
  );

  // 3. Trusted *and* credited on this network (scaffolded from the real credit the committed cycle
  // wrote, with the identity budget the server would have earned over admitted cycles): the honest
  // second device must not be refused.
  const residentState = await deviceState(`webgl-${RUN}-${attackerLabels[2]}`);
  const residentCredits = (residentState?.["networkTrusts"] ?? []) as { ipHash?: string }[];
  const residentNetwork = residentCredits[0]?.ipHash ?? networkHash;
  if (residentState) {
    await dbProbe(async (c) => c["devices"].updateOne(
      { publicId: residentState["publicId"] },
      {
        $set: {
          trustState: "established",
          establishedAt: new Date(),
          admissionCount: 3,
          networkTrusts: [{ ipHash: residentNetwork, admissions: 3, proofs: 0, firstAt: new Date(Date.now() - 60_000), lastAt: new Date() }],
        },
      },
    ));
  }
  const residentParallel = await startAnsweringChallenges(residentAccount, attackerEvidence[2]!, residentKey.keyPair, residentKey.jwk);
  recordParallel(
    "API-NETWORK-RESIDENT-PARALLEL",
    "identity credited on this network (the honest second device), used beside a live cycle",
    residentParallel,
    await deviceState(`webgl-${RUN}-${attackerLabels[2]}`),
    "ALLOWED = a device that has mined here is still admitted; BLOCKED = the rule denies an honest second device (false denial)",
  );
  const finalState = await liveStateCounts();
  console.log(`[bootstrap-then-parallel] burst=[${burstStatuses}] attacker=${forgedCoreState(attackBootstrap)} global-bootstrap=${globalBootstrap.final.status} resident-bootstrap=${residentBootstrap.final.status} active-after=${JSON.stringify(afterParallel)} active-final=${JSON.stringify(finalState)}`);
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

  // Isolation: this phase measures drift tolerance, and the suites above have already spent the
  // per-network identity budget and taken live leases on this machine. Release both, so a refusal
  // here means "drift was caught" and a 403 from a spent test budget can never masquerade as one.
  // `SIM-BASELINE` then enrolls and takes its own lease, which is the lease the drift cases below are
  // supposed to collide with.
  const releasedForDrift = await releaseAllLeases();
  const resetForDrift = await resetEnrollmentBudget();
  driftIsolation.leasesReleased = releasedForDrift;
  driftIsolation.quotaRowsCleared = resetForDrift;
  console.log(`[isolation] drift phase: released_leases=${releasedForDrift} quota_budget_cleared=${resetForDrift}`);
  // A refusal is a refusal; a refusal caused by the test's own spent budget is not a result.
  const driftVerdict = (status: number, code: string | null): Verdict => {
    if (isBudgetRefusal(code)) return BLOCKED_BY_TEST_SETUP;
    if (status === 200) return "ALLOWED";
    if (status >= 400 && status < 500) return "BLOCKED";
    return "ERROR";
  };

  const acctA = await directAccount("sim-a");
  const start1 = await apiCall("/api/v1/mining/start", { method: "POST", token: acctA.token, csrf: acctA.csrf, body: { device: evidence() } });
  record({
    id: "SIM-BASELINE", name: "SIMULATED: first enrollment of synthetic machine", browser: "simulated-http", context: "http-boundary",
    account: acctA.email, identityOutcome: "enrolled", clusterOutcome: "created", leaseOutcome: start1.status === 200 ? "active" : "-",
    finalResult: start1.status === 200 ? "ALLOWED" : isBudgetRefusal(start1.code) ? BLOCKED_BY_TEST_SETUP : "ERROR",
    httpStatus: start1.status, reasonCode: start1.code, latencyMs: null, evidence: "simulated",
    notes: "setup for the drift cases: it must be admitted for their conflicts to be meaningful",
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
    finalResult: driftVerdict(drift.status, drift.code), httpStatus: drift.status, reasonCode: drift.code, latencyMs: null, evidence: "simulated",
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
    finalResult: driftVerdict(randomized.status, randomized.code), httpStatus: randomized.status, reasonCode: randomized.code, latencyMs: null, evidence: "simulated",
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
    finalResult: driftVerdict(vpn.status, vpn.code), httpStatus: vpn.status, reasonCode: vpn.code, latencyMs: null, evidence: "simulated",
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
    finalResult: driftVerdict(impossible.status, impossible.code), httpStatus: impossible.status, reasonCode: impossible.code, latencyMs: null,
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
    finalResult: driftVerdict(automated.status, automated.code), httpStatus: automated.status, reasonCode: automated.code, latencyMs: null,
    evidence: "simulated", notes: "expected: CHALLENGE (risk>=55) rather than silent allow",
  });
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("HARNESS FAILURE:", error);
    process.exit(1);
  });
