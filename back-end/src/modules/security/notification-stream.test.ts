import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_STREAMS_PER_ACCOUNT,
  NOTIFICATIONS_CHANGED_FRAME,
  notificationStreamStats,
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
