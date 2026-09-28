import type { ChangeStream } from "mongodb";
import type { FastifyBaseLogger } from "fastify";
import type { Collections } from "../../infrastructure/mongodb/collections.js";
import type { NotificationRecord } from "../../shared/types.js";

/**
 * Realtime notification fan-out.
 *
 * One MongoDB change stream per API process watches the `notifications` collection and hands every
 * connected account a content-free "something changed" hint over Server-Sent Events. That hint is
 * the entire cost the push path adds to the database: a change stream is a server-pushed cursor
 * rather than a poll, it is opened once per process, and it does not grow with the number of open
 * tabs the way repeating `GET /api/v1/notifications` from every tab does.
 *
 * The hint deliberately carries no notification data. The read model stays
 * `GET /api/v1/notifications`, so a pushed frame can never become a second copy of a notice that
 * skipped the authorization, projection, and cursor paging the page already goes through.
 *
 * The watcher needs a change stream, and therefore a replica set. This deployment already requires
 * one for the transactional transfer path; if the watcher still cannot start, the stream endpoint
 * answers 503 and the client falls back to a slow poll, so realtime degrades instead of taking the
 * wallet down with it.
 */

/** Sent to an account when a notice was written for it. Carries no content on purpose. */
export const NOTIFICATIONS_CHANGED_FRAME = "event: notifications\ndata: {}\n\n";

/**
 * Comment frame that keeps proxies and load balancers from reaping an idle connection, and that
 * lets either side notice a peer that is gone.
 */
export const NOTIFICATION_HEARTBEAT_FRAME = ": keep-alive\n\n";

/** How long one stream stays open before the client reconnects and re-authenticates. */
export const STREAM_MAX_LIFETIME_MS = 5 * 60 * 1000;
export const STREAM_HEARTBEAT_INTERVAL_MS = 20 * 1000;
/** Reconnect hint handed to the client, so a lost connection is not retried in a tight loop. */
export const STREAM_RETRY_MS = 5 * 1000;

/**
 * One account holds at most this many open streams. Bounded per account rather than only in total,
 * because a browser that leaks tabs must not be able to reserve the whole budget for itself.
 */
export const MAX_STREAMS_PER_ACCOUNT = 4;
/** Admission control for the process as a whole: past this, new streams are refused, not queued. */
export const MAX_STREAMS_TOTAL = 5_000;
/** Delay before the watcher is restarted after a failure, so a broken cursor cannot spin. */
const WATCHER_RETRY_DELAY_MS = 15 * 1000;

export interface NotificationStreamSubscriber {
  /** Writes one frame to the client. */
  send: (frame: string) => void;
  /** Closes the connection. Called on shutdown so the process can exit. */
  end: () => void;
}

export type NotificationStreamRejection = "per_account_limit" | "stream_capacity";

const subscribers = new Map<string, Set<NotificationStreamSubscriber>>();

let watcher: ChangeStream<NotificationRecord> | null = null;
let watcherStart: Promise<void> | null = null;
let watcherRetryAt = 0;
/** True once the watcher has run a generation, so a restart can be told from a first start. */
let watcherRan = false;
let shuttingDown = false;

/** Open streams, counted the same way the cap is enforced. Exposed for tests and diagnostics. */
export function notificationStreamStats(): { total: number; accounts: number } {
  let total = 0;
  for (const set of subscribers.values()) total += set.size;
  return { total, accounts: subscribers.size };
}

/**
 * Registers one open stream for an account.
 *
 * The caller owns the socket; this registry owns only the routing. A rejection is returned rather
 * than thrown so the HTTP layer decides the status code, and so the decision can be tested without
 * a database.
 */
export function registerNotificationSubscriber(input: {
  ownerUserId: string;
  subscriber: NotificationStreamSubscriber;
}): { unsubscribe: () => void } | { rejection: NotificationStreamRejection } {
  const existing = subscribers.get(input.ownerUserId);
  if (existing && existing.size >= MAX_STREAMS_PER_ACCOUNT) {
    return { rejection: "per_account_limit" };
  }
  if (notificationStreamStats().total >= MAX_STREAMS_TOTAL) return { rejection: "stream_capacity" };

  const set = existing ?? new Set<NotificationStreamSubscriber>();
  set.add(input.subscriber);
  subscribers.set(input.ownerUserId, set);

  let released = false;
  return {
    unsubscribe: () => {
      // A socket can close while a shutdown is already clearing the registry, so releasing twice
      // must not delete from a set that no longer holds this subscriber.
      if (released) return;
      released = true;
      const current = subscribers.get(input.ownerUserId);
      if (!current) return;
      current.delete(input.subscriber);
      if (current.size > 0) return;
      subscribers.delete(input.ownerUserId);
      // Nobody is listening any more: release the cursor instead of holding a replica-set
      // connection open for a process that has no audience.
      if (subscribers.size === 0) void releaseWatcher();
    },
  };
}

/**
 * Hands a change hint to every open stream of one account. Returns how many were told, which is
 * also what a test asserts on: a notice for one account must never reach another one.
 */
export function publishNotificationChange(ownerUserId: string): number {
  const set = subscribers.get(ownerUserId);
  if (!set) return 0;
  for (const subscriber of set) {
    // One broken socket must not stop the others, and its own close handler owns the cleanup.
    try {
      subscriber.send(NOTIFICATIONS_CHANGED_FRAME);
    } catch {
      /* ignored */
    }
  }
  return set.size;
}

function publishToEveryone(): void {
  for (const ownerUserId of [...subscribers.keys()]) publishNotificationChange(ownerUserId);
}

async function runWatcher(input: { collections: Collections; log: FastifyBaseLogger }): Promise<void> {
  let cursor: ChangeStream<NotificationRecord> | null = null;
  try {
    cursor = input.collections.notifications.watch(
      [
        { $match: { operationType: { $in: ["insert", "update"] } } },
        // Only the owner is needed to route the hint: a notice's title and body never enter this
        // process through the change stream. `operationType` is kept because the projection decides
        // the whole shape of the event — a projected change carries no other field, and the loop
        // below reads this one to tell an insert from an update.
        { $project: { operationType: 1, "fullDocument.ownerUserId": 1 } },
      ],
      // Read state counts as a change too: acknowledging a notice on one device has to clear the
      // badge on every other one.
      { fullDocument: "updateLookup" },
    );
    watcher = cursor;
    if (watcherRan) {
      // The watcher was down for a while, so hints were missed while clients stayed connected.
      // Every account re-reads its own page once, which resynchronises without a resume token that
      // could expire and wedge the retry loop.
      publishToEveryone();
    }
    watcherRan = true;
    for await (const change of cursor) {
      // The projection is why this check reads a real field rather than trusting the pipeline: the
      // driver types the cursor as every kind of change event, so the loop narrows it here to reach
      // `fullDocument`, and it only does so for the two operations the projection kept.
      if (change.operationType !== "insert" && change.operationType !== "update") continue;
      const ownerUserId = change.fullDocument?.ownerUserId;
      if (typeof ownerUserId === "string") publishNotificationChange(ownerUserId);
    }
  } catch (error) {
    // A cursor that is no longer the current one was closed on purpose — the last subscriber left
    // or the process is closing — and ends the loop the same way a failure does. Only a real
    // failure is reported and retried.
    if (cursor !== null && watcher !== cursor) return;
    if (shuttingDown) return;
    input.log.warn({ err: error }, "notification_stream_watcher_stopped");
    watcher = null;
    watcherRetryAt = Date.now() + WATCHER_RETRY_DELAY_MS;
  }
}

/**
 * Starts the watcher once for the whole process.
 *
 * Called by a subscriber rather than at boot, so a process nobody is reading from holds no cursor.
 * It never rejects: a connection is not refused because realtime is unhealthy, and the failure is
 * retried by the next subscriber after the backoff.
 */
/**
 * Whether the change stream could not be established and is waiting out its backoff.
 *
 * Without this the endpoint would answer 200 and then never speak, which is the worst of both
 * worlds: the client holds a connection, believes realtime works, and never falls back. Reporting it
 * lets the client degrade on its own terms.
 */
export function notificationWatcherUnavailable(): boolean {
  return !watcher && !watcherStart && Date.now() < watcherRetryAt;
}

export function ensureNotificationWatcher(input: { collections: Collections; log: FastifyBaseLogger }): void {
  if (shuttingDown || watcher || watcherStart || Date.now() < watcherRetryAt) return;
  watcherStart = runWatcher(input)
    .catch(() => undefined)
    .finally(() => {
      watcherStart = null;
      // A subscriber can arrive while a previous cursor is still closing; without this second look
      // that connection would stay open with no watcher behind it.
      if (subscribers.size > 0) ensureNotificationWatcher(input);
    });
}

/**
 * Closes the cursor because nobody is listening. Unlike shutdown this is not a terminal state: the
 * next subscriber starts a new watcher.
 */
async function releaseWatcher(): Promise<void> {
  const current = watcher;
  watcher = null;
  if (current) await current.close().catch(() => undefined);
  if (watcherStart) await watcherStart.catch(() => undefined);
  // Nothing was connected while this cursor was down, so nothing can have been missed and the next
  // subscriber has no reason to be told to resynchronise. Only a watcher that fails *while* clients
  // are connected needs that announcement.
  watcherRan = false;
}

/**
 * Ends every open stream and releases the cursor.
 *
 * An SSE connection outlives any request timeout, so a closing process has to end it explicitly or
 * the server would never finish closing. Registered as a `preClose` hook, which is what runs before
 * the server stops.
 */
export async function stopNotificationStream(): Promise<void> {
  shuttingDown = true;
  try {
    for (const set of subscribers.values()) {
      for (const subscriber of set) subscriber.end();
    }
    subscribers.clear();
    await releaseWatcher();
  } finally {
    watcherRan = false;
    watcherRetryAt = 0;
    shuttingDown = false;
  }
}
