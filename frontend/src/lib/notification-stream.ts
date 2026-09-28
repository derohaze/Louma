import { openNotificationStream } from "@/lib/api";

/**
 * The realtime notification channel.
 *
 * The server pushes one content-free frame when a notice is written for the signed-in account (see
 * `back-end/src/modules/security/notification-stream.ts`). A frame never carries a notice: it tells
 * its listeners that the account's notifications page changed, and the reader of that page goes
 * through the API's own authorization, projection, and cursor paging. The push channel therefore
 * cannot become a second source of truth for anything a customer sees.
 *
 * The connection belongs to the session, not to a component. Every wallet route mounts its own
 * provider, so a component-owned connection would open and close on every navigation; here the
 * channel is started once a session is known and stopped when it ends. Reconnect, keep-alive
 * accounting, and the degraded mode live in this module so no screen has to think about them.
 *
 * If the endpoint cannot serve a stream at all (the API answers 503 when its change stream cannot
 * start), the channel degrades to a slower reconnect cadence that still refreshes on each attempt,
 * so a repaired server is picked up without a reload and the badge never freezes.
 */

type NotificationChangeListener = () => void;

/** The one event name the server pushes. Anything else on the wire is a keep-alive comment. */
const CHANGE_EVENT = "notifications";
const DEFAULT_RETRY_MS = 5_000;
const MAX_RETRY_MS = 30_000;
/**
 * A stream that produces no frame for this long is treated as dead. The server keep-alives every
 * twenty seconds, so silence means the connection is gone even though the socket never errored —
 * which is exactly how a browser learns about a dropped mobile network or a reaped proxy.
 */
const SILENCE_TIMEOUT_MS = 75_000;
/**
 * How long the client waits before re-attempting the stream while the API reports it cannot serve
 * realtime. The badge is refreshed on each attempt, so a degraded channel is still a slow one rather
 * than a dead one.
 */
const DEGRADED_RETRY_MS = 60_000;
/** Several changes in one burst become one refresh for the listeners. */
const COALESCE_MS = 250;

const listeners = new Set<NotificationChangeListener>();

let running = false;
/** Incremented by every new attempt, so a superseded attempt can never touch shared state. */
let generation = 0;
let activeController: AbortController | null = null;
let reconnectTimer: number | null = null;
let silenceTimer: number | null = null;
let coalesceTimer: number | null = null;
let attempt = 0;
/** True while the API is answering 503, so the degradation is reported once rather than every minute. */
let degraded = false;
let retryBaseMs = DEFAULT_RETRY_MS;

function isAbort(cause: unknown): boolean {
  return (
    typeof cause === "object" &&
    cause !== null &&
    (cause as { name?: unknown }).name === "AbortError"
  );
}

function clearTimer(timer: number | null): null {
  if (timer !== null) window.clearTimeout(timer);
  return null;
}

/** Tells every listener once per burst, and never lets one failing listener stop the others. */
function notifyChanges(): void {
  if (!listeners.size || coalesceTimer !== null) return;
  coalesceTimer = window.setTimeout(() => {
    coalesceTimer = null;
    for (const listener of [...listeners]) {
      try {
        listener();
      } catch (cause) {
        console.error(cause);
      }
    }
  }, COALESCE_MS);
}

function backoffDelay(): number {
  const base = Math.min(retryBaseMs * 2 ** attempt, MAX_RETRY_MS);
  attempt += 1;
  // Jitter, so the tabs that lost the connection together do not come back in one wave.
  return Math.round(base * (0.8 + Math.random() * 0.4));
}

function scheduleReconnect(delay?: number): void {
  if (!running || reconnectTimer !== null) return;
  // A deliberate close (the server rotates the connection to re-authenticate it) reconnects at once:
  // waiting would leave the tab without realtime for no reason.
  const wait = delay ?? backoffDelay();
  reconnectTimer = window.setTimeout(() => {
    reconnectTimer = null;
    void connect();
  }, wait);
}

/**
 * Reconnects on the degraded cadence after the API refused to serve a stream.
 *
 * The alternative — holding the connection and hoping — would leave the tab believing realtime
 * works while nothing arrives, and the alternative of a background poll interval would keep running
 * after realtime recovered. Refreshing once per re-attempt keeps the badge moving, and the next
 * successful connection ends the degraded state without a reload.
 */
function holdDegraded(): void {
  if (!degraded) {
    degraded = true;
    console.warn("Louma: realtime notifications unavailable, refreshing on a slower cadence.");
  }
  notifyChanges();
  scheduleReconnect(DEGRADED_RETRY_MS);
}

function handleFrame(frame: string): void {
  for (const line of frame.split("\n")) {
    if (line.startsWith("retry:")) {
      const announced = Number(line.slice("retry:".length).trim());
      if (Number.isFinite(announced) && announced > 0)
        retryBaseMs = Math.min(announced, MAX_RETRY_MS);
      continue;
    }
    if (line.startsWith("event:") && line.slice("event:".length).trim() === CHANGE_EVENT) {
      notifyChanges();
    }
    // `data:` lines and comments are read and ignored on purpose: the frame carries no notice, so
    // there is nothing to parse and nothing that could drift from the page the bell renders.
  }
}

function armSilenceWatchdog(mine: number): void {
  silenceTimer = clearTimer(silenceTimer);
  silenceTimer = window.setTimeout(() => {
    silenceTimer = null;
    if (mine !== generation || !running) return;
    // Abort rather than wait: a quiet stream is dead, and the retry is already scheduled.
    activeController?.abort();
    scheduleReconnect();
  }, SILENCE_TIMEOUT_MS);
}

async function pump(response: Response, mine: number): Promise<void> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("The notification stream answered without a body.");
  const decoder = new TextDecoder();
  let buffer = "";
  armSilenceWatchdog(mine);
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (mine !== generation || !running) return;
      // Any byte counts as liveness, a keep-alive comment included.
      armSilenceWatchdog(mine);
      if (done) return;
      buffer += decoder.decode(value, { stream: true });
      for (let split = buffer.indexOf("\n\n"); split >= 0; split = buffer.indexOf("\n\n")) {
        handleFrame(buffer.slice(0, split));
        buffer = buffer.slice(split + 2);
      }
    }
  } finally {
    silenceTimer = clearTimer(silenceTimer);
    // Releases the socket as soon as this attempt is over, including when it is superseded.
    await reader.cancel().catch(() => undefined);
  }
}

async function connect(): Promise<void> {
  if (!running) return;
  const mine = ++generation;
  const controller = new AbortController();
  activeController = controller;
  try {
    const response = await openNotificationStream(controller.signal);
    if (mine !== generation || !running) return;
    if (response.status === 503) {
      holdDegraded();
      return;
    }
    if (response.status === 401) {
      // The stream is authorized at open, so a rejected token means the session is over: the pages
      // discover that on their own next call and send the visitor to sign in.
      stopNotificationStream();
      return;
    }
    if (!response.ok) {
      scheduleReconnect();
      return;
    }
    attempt = 0;
    degraded = false;
    await pump(response, mine);
    if (mine !== generation || !running) return;
    scheduleReconnect(0);
  } catch (cause) {
    if (mine !== generation || !running || isAbort(cause)) return;
    scheduleReconnect();
  }
}

/**
 * Opens the channel. Idempotent, because every wallet route asks for it again on mount: a channel
 * that is already open is left exactly as it is.
 */
export function startNotificationStream(): void {
  if (typeof window === "undefined" || running) return;
  running = true;
  attempt = 0;
  void connect();
}

/** Closes the channel and cancels every pending retry. Called when the session ends. */
export function stopNotificationStream(): void {
  running = false;
  generation += 1;
  activeController?.abort();
  activeController = null;
  reconnectTimer = clearTimer(reconnectTimer);
  silenceTimer = clearTimer(silenceTimer);
  coalesceTimer = clearTimer(coalesceTimer);
  attempt = 0;
  degraded = false;
  retryBaseMs = DEFAULT_RETRY_MS;
}

/**
 * Registers a listener for "the account's notifications changed". Listeners are told once per burst
 * and receive no data, so each one decides what it needs to re-read.
 */
export function subscribeToNotificationChanges(listener: NotificationChangeListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
