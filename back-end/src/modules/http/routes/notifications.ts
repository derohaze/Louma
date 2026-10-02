import type { FastifyInstance } from "fastify";
import { z } from "zod";
import * as security from "../../security/service.js";
import {
  createNotificationStreamWriter,
  ensureNotificationWatcher,
  NOTIFICATION_HEARTBEAT_FRAME,
  notificationWatcherUnavailable,
  registerNotificationSubscriber,
  STREAM_HEARTBEAT_INTERVAL_MS,
  STREAM_MAX_LIFETIME_MS,
  STREAM_RETRY_MS,
} from "../../security/notification-stream.js";
import { AppError, serviceUnavailable } from "../../../shared/errors.js";
import { pageLimitSchema } from "../schemas.js";
import { authenticated, getAuth, parseBody } from "../http-helpers.js";

export async function registerNotificationRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/v1/notifications", authenticated, async (request) => {
    const query = parseBody(
      z.object({ cursor: z.string().max(32).optional(), limit: pageLimitSchema }).strict(),
      request.query,
    );
    return security.listNotifications({
      collections: app.collections,
      ownerUserId: getAuth(request).userId,
      cursor: query.cursor,
      limit: query.limit ?? 20,
    });
  });

  // An empty body marks every unread notification, which is what the bell does when it is opened.
  app.post("/api/v1/notifications/read", authenticated, async (request) => {
    const body = parseBody(
      z.object({ ids: z.array(z.string().regex(/^[0-9a-f]{24}$/i)).min(1).max(50).optional() }).strict(),
      request.body ?? {},
    );
    return security.markNotificationsRead({
      collections: app.collections,
      ownerUserId: getAuth(request).userId,
      ids: body.ids,
    });
  });

  /**
   * The realtime notification channel: Server-Sent Events, one connection per open tab.
   *
   * The frames are only a signal, never data — a change makes the client re-read
   * `GET /api/v1/notifications`, so this endpoint needs no read path of its own and no projection
   * that could drift from the page the bell renders.
   *
   * The connection is authorized once, at open. It is deliberately short-lived for that reason (see
   * STREAM_MAX_LIFETIME_MS): the client reconnects with a token that has to still be valid, so a
   * revoked session stops receiving hints within one rotation instead of holding a stream open until
   * the tab is closed.
   */
  app.get("/api/v1/notifications/stream", authenticated, async (request, reply) => {
    const current = getAuth(request);

    // A stream that could never speak would strand the client on a connection it believes in, so a
    // change stream that cannot be established is refused instead: the client then refreshes on its
    // own slower cadence until the API can serve realtime again.
    //
    // This runs before the connection is registered, because a watcher that cannot start ends every
    // stream that is already open: a writer this route has not committed to yet must not be one of
    // them, or its response would be closed before the SSE headers were written and the client would
    // get a broken 200 instead of the 503 it falls back on.
    ensureNotificationWatcher({ collections: app.collections, log: request.log });
    if (notificationWatcherUnavailable()) {
      throw serviceUnavailable("realtime_unavailable", "Realtime notifications are temporarily unavailable.");
    }

    const writer = createNotificationStreamWriter(reply.raw);
    // Registered before the hijack so the caps can still be answered with the API's error envelope.
    const registered = registerNotificationSubscriber({
      ownerUserId: current.userId,
      subscriber: writer,
    });
    if ("rejection" in registered) {
      if (registered.rejection === "per_account_limit") {
        throw new AppError(
          429,
          "stream_limit",
          "Too many notification streams are already open for this account. Close a Louma tab and try again.",
        );
      }
      throw serviceUnavailable("stream_capacity", "Realtime notifications are at capacity. Try again shortly.");
    }

    reply.hijack();
    const raw = reply.raw;
    // The reply is hijacked, so the headers the global hooks set never reach the client and the CORS
    // plugin never runs: both are repeated here. The origin is echoed only when it is one this API
    // already trusts, because credentials travel on this request.
    const origin = request.headers.origin;
    raw.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store, no-transform",
      connection: "keep-alive",
      "x-request-id": request.id,
      // Tells a buffering reverse proxy to pass frames through instead of holding them.
      "x-accel-buffering": "no",
      ...(origin && app.config.frontendOrigins.includes(origin)
        ? {
            "access-control-allow-origin": origin,
            "access-control-allow-credentials": "true",
            vary: "Origin",
          }
        : {}),
    });
    writer.send(`retry: ${STREAM_RETRY_MS}\n\n`);

    const heartbeat = setInterval(() => writer.send(NOTIFICATION_HEARTBEAT_FRAME), STREAM_HEARTBEAT_INTERVAL_MS);
    const rotation = setTimeout(() => writer.end(), STREAM_MAX_LIFETIME_MS);
    // Neither timer may keep the process alive on its own.
    heartbeat.unref();
    rotation.unref();

    const openedAt = Date.now();
    raw.on("close", () => {
      clearInterval(heartbeat);
      clearTimeout(rotation);
      registered.unsubscribe();
      request.log.debug(
        { userId: current.userId, durationMs: Date.now() - openedAt },
        "notification_stream_closed",
      );
    });
    // A hijacked socket reports write failures here; without a listener an unhandled 'error' event
    // would take the process down.
    raw.on("error", () => raw.destroy());

    request.log.debug({ userId: current.userId }, "notification_stream_opened");
    return undefined;
  });
}
