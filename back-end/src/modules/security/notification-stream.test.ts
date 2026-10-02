import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type { ServerResponse } from "node:http";
import { buildApp } from "../../app.js";
import { loadConfig } from "../../config/env.js";
import type { Collections } from "../../infrastructure/mongodb/collections.js";
import { disabledRedis } from "../../infrastructure/redis/client.js";
import {
  createNotificationStreamWriter,
  ensureNotificationWatcher,
  MAX_STREAMS_PER_ACCOUNT,
  NOTIFICATION_HEARTBEAT_FRAME,
  NOTIFICATIONS_CHANGED_FRAME,
  notificationStreamStats,
  notificationWatcherUnavailable,
  publishNotificationChange,
  registerNotificationSubscriber,
  stopNotificationStream,
  type NotificationStreamSubscriber,
} from "./notification-stream.js";

/**
 * The fan-out is the part of the realtime channel that carries the security decision — which account
 * receives which hint — so it is exercised without a database. The change-stream watcher and the SSE
 * transport are covered by the endpoint itself; here the registry is driven directly.
 */

/** One fake open tab: records every frame it was handed, and whether it was closed. */
function fakeStream() {
  const frames: string[] = [];
  let ended = false;
  const subscriber: NotificationStreamSubscriber = {
    send: (frame) => frames.push(frame),
    end: () => {
      ended = true;
    },
  };
  return { subscriber, frames, isEnded: () => ended };
}

test("a change reaches every stream of its own account and no other account", async () => {
  const owner = "user-owner";
  const other = "user-other";
  const first = fakeStream();
  const second = fakeStream();
  const stranger = fakeStream();
  const firstRegistration = registerNotificationSubscriber({ ownerUserId: owner, subscriber: first.subscriber });
  const secondRegistration = registerNotificationSubscriber({ ownerUserId: owner, subscriber: second.subscriber });
  const strangerRegistration = registerNotificationSubscriber({ ownerUserId: other, subscriber: stranger.subscriber });
  assert.ok("unsubscribe" in firstRegistration && "unsubscribe" in secondRegistration && "unsubscribe" in strangerRegistration);

  assert.equal(publishNotificationChange(owner), 2, "both tabs of the account are told");
  assert.deepEqual(first.frames, [NOTIFICATIONS_CHANGED_FRAME]);
  assert.deepEqual(second.frames, [NOTIFICATIONS_CHANGED_FRAME]);
  assert.deepEqual(stranger.frames, [], "another account's stream is untouched");
  assert.equal(publishNotificationChange("user-nobody"), 0, "an account with no stream is a no-op");

  await stopNotificationStream();
});

test("an account cannot hold more than its share of streams", async () => {
  const owner = "user-many";
  const registrations = [];
  for (let index = 0; index < MAX_STREAMS_PER_ACCOUNT; index += 1) {
    const stream = fakeStream();
    registrations.push(registerNotificationSubscriber({ ownerUserId: owner, subscriber: stream.subscriber }));
  }
  assert.ok(registrations.every((registration) => "unsubscribe" in registration));

  const refused = registerNotificationSubscriber({ ownerUserId: owner, subscriber: fakeStream().subscriber });
  assert.deepEqual(refused, { rejection: "per_account_limit" }, "one account cannot reserve unlimited streams");
  assert.ok(
    "unsubscribe" in registerNotificationSubscriber({ ownerUserId: "user-untouched", subscriber: fakeStream().subscriber }),
    "the refusal is scoped to the account that exceeded its share",
  );

  // Closing one tab makes room again, which is what stops a limit from being a permanent lockout.
  const first = registrations[0] as { unsubscribe: () => void };
  first.unsubscribe();
  const admitted = registerNotificationSubscriber({ ownerUserId: owner, subscriber: fakeStream().subscriber });
  assert.ok("unsubscribe" in admitted, "a released slot is reusable");

  await stopNotificationStream();
});

test("releasing a stream twice counts once", async () => {
  const owner = "user-double-release";
  const stream = fakeStream();
  const registration = registerNotificationSubscriber({ ownerUserId: owner, subscriber: stream.subscriber });
  assert.ok("unsubscribe" in registration);

  registration.unsubscribe();
  registration.unsubscribe();
  assert.deepEqual(notificationStreamStats(), { total: 0, accounts: 0 });

  await stopNotificationStream();
});

test("shutdown closes every open stream", async () => {
  const first = fakeStream();
  const second = fakeStream();
  registerNotificationSubscriber({ ownerUserId: "user-a", subscriber: first.subscriber });
  registerNotificationSubscriber({ ownerUserId: "user-b", subscriber: second.subscriber });

  await stopNotificationStream();
  assert.equal(first.isEnded(), true);
  assert.equal(second.isEnded(), true);
  assert.deepEqual(notificationStreamStats(), { total: 0, accounts: 0 });

  // Streams that closed after the shutdown release without touching the cleared registry.
  registerNotificationSubscriber({ ownerUserId: "user-c", subscriber: fakeStream().subscriber });
  await stopNotificationStream();
});

/**
 * The change stream is a replica-set-only feature, so its failure is staged here rather than in the
 * integration suite: a `watch()` that throws stands in for a deployment where the watcher cannot
 * start, which is exactly the case the endpoint has to degrade for.
 */
const failingCollections = {
  notifications: {
    watch: () => {
      throw new Error("a change stream needs a replica set");
    },
  },
} as unknown as Collections;

const quietLog = { warn: () => undefined } as unknown as Parameters<typeof ensureNotificationWatcher>[0]["log"];

test("a watcher that cannot start ends the streams it was opened for", async () => {
  const stream = fakeStream();
  registerNotificationSubscriber({ ownerUserId: "user-watcher-down", subscriber: stream.subscriber });

  ensureNotificationWatcher({ collections: failingCollections, log: quietLog });
  // The watcher runs on its own promise, so let the failure settle before asserting on it.
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(stream.isEnded(), true, "a stream whose hints can never arrive is closed instead");
  assert.deepEqual(notificationStreamStats(), { total: 0, accounts: 0 }, "the registry is released");
  assert.equal(
    notificationWatcherUnavailable(),
    true,
    "the next attempt is refused with 503 until the backoff ends, so the client degrades",
  );

  await stopNotificationStream();
});

/**
 * What the endpoint answers is what the client's fallback keys off, and the ordering inside it
 * matters: a start that fails synchronously must not close a response the route has not written yet,
 * and the request must still be refused the way the client degrades on. The app is built against the
 * same stub rather than a live replica set, because the refusal is decided before anything touches
 * the database.
 */
test("a stream request is refused with 503 while the watcher cannot start", async () => {
  // A clean slate: the test above left the watcher waiting out its backoff, and a request refused
  // because of that backoff would say nothing about the ordering exercised here.
  await stopNotificationStream();
  assert.equal(notificationWatcherUnavailable(), false, "the request below starts a watcher");

  const app = await buildApp({
    config: loadConfig({
      MONGODB_URI: "mongodb://127.0.0.1:27017/louma",
      MONGODB_DATABASE: "louma",
      ACCESS_TOKEN_SECRET: Buffer.alloc(32, 1).toString("base64"),
      APP_ENCRYPTION_KEY: Buffer.alloc(32, 2).toString("base64"),
    }),
    collections: failingCollections,
    mongoClient: {} as never,
    redis: disabledRedis(),
    logger: false,
  });
  // The route is behind the session pre-handler, which reads the database. The session is not what
  // this test is about, so the decorator is replaced.
  app.authenticate = async (request) => {
    const auth = { userId: "user-watcher-down", sessionId: "session-1" };
    request.auth = auth;
    return auth;
  };

  try {
    const response = await app.inject({ method: "GET", url: "/api/v1/notifications/stream" });
    assert.equal(response.statusCode, 503, "the client is told to degrade, not handed a dead stream");
    assert.equal(response.json().error.code, "realtime_unavailable");
    assert.equal(
      notificationWatcherUnavailable(),
      true,
      "the failed start is recorded, so the next attempt is refused the same way",
    );
  } finally {
    await app.close();
  }
});

test("one broken socket does not stop the other streams of the account", async () => {
  const owner = "user-broken";
  const broken = registerNotificationSubscriber({
    ownerUserId: owner,
    subscriber: {
      send: () => {
        throw new Error("socket is gone");
      },
      end: () => undefined,
    },
  });
  const healthy = fakeStream();
  registerNotificationSubscriber({ ownerUserId: owner, subscriber: healthy.subscriber });
  assert.ok("unsubscribe" in broken);

  assert.equal(publishNotificationChange(owner), 2, "the healthy stream is still reached");
  assert.deepEqual(healthy.frames, [NOTIFICATIONS_CHANGED_FRAME]);

  await stopNotificationStream();
});

/**
 * A socket stub the writer can drive: records frames, answers whether the kernel accepted the
 * write, and can die on demand the way a reaped mobile connection does.
 */
function fakeRaw(input: { acceptWrites?: boolean; dieOn?: "write" | "end" } = {}) {
  const emitter = new EventEmitter();
  const frames: string[] = [];
  let ended = false;
  const raw = Object.assign(emitter, {
    write: (frame: string): boolean => {
      if (input.dieOn === "write") throw new Error("socket is gone");
      frames.push(frame);
      return input.acceptWrites ?? true;
    },
    end: (): void => {
      if (input.dieOn === "end") throw new Error("socket is gone");
      ended = true;
    },
  }) as unknown as ServerResponse;
  return { raw, frames, isEnded: () => ended };
}

test("a write to a dead socket closes the writer instead of throwing", async () => {
  const { raw, frames } = fakeRaw({ dieOn: "write" });
  const writer = createNotificationStreamWriter(raw);

  // The heartbeat timer calls this with no request scope left to catch it: it must never throw.
  assert.doesNotThrow(() => writer.send(NOTIFICATION_HEARTBEAT_FRAME));
  assert.doesNotThrow(() => writer.send(NOTIFICATIONS_CHANGED_FRAME));
  assert.doesNotThrow(() => writer.end());
  assert.deepEqual(frames, [], "nothing was delivered to the dead socket");

  await stopNotificationStream();
});

test("ending a dead socket never throws", async () => {
  const { raw } = fakeRaw({ dieOn: "end" });
  const writer = createNotificationStreamWriter(raw);

  assert.doesNotThrow(() => writer.end());
  assert.doesNotThrow(() => writer.send(NOTIFICATIONS_CHANGED_FRAME));

  await stopNotificationStream();
});

test("a slow reader gets one coalesced change hint when it drains", async () => {
  const { raw, frames } = fakeRaw({ acceptWrites: false });
  const writer = createNotificationStreamWriter(raw);

  writer.send(NOTIFICATION_HEARTBEAT_FRAME);
  writer.send(NOTIFICATIONS_CHANGED_FRAME);
  writer.send(NOTIFICATIONS_CHANGED_FRAME);
  writer.send(NOTIFICATION_HEARTBEAT_FRAME);
  assert.deepEqual(frames, [NOTIFICATION_HEARTBEAT_FRAME], "only the first frame reached the kernel");

  raw.emit("drain");
  assert.deepEqual(
    frames,
    [NOTIFICATION_HEARTBEAT_FRAME, NOTIFICATIONS_CHANGED_FRAME],
    "the burst collapses into a single remembered hint",
  );

  await stopNotificationStream();
});

test("open/close churn leaves no registered stream behind", async () => {
  for (let index = 0; index < 5_000; index += 1) {
    const registration = registerNotificationSubscriber({
      ownerUserId: `user-churn-${index % 100}`,
      subscriber: fakeStream().subscriber,
    });
    assert.ok("unsubscribe" in registration);
    if ("unsubscribe" in registration) registration.unsubscribe();
  }
  assert.deepEqual(notificationStreamStats(), { total: 0, accounts: 0 });

  await stopNotificationStream();
});
