import { test } from "node:test";
import assert from "node:assert/strict";
import { ObjectId } from "mongodb";
import {
  canUseHistoryWindow,
  isActiveSubscription,
  maxHistoryWindowDays,
  publicSubscription,
  subscriptionExpiry,
} from "./policy.js";
import type { SubscriptionRecord } from "../../shared/types.js";

const now = new Date("2026-01-31T12:34:56.789Z");
const record: SubscriptionRecord = { _id: new ObjectId(), publicId: "s", ownerUserId: "u", name: "Louma Pro", plan: "monthly", status: "active", startsAt: now,
  expiresAt: new Date("2026-02-28T12:34:56.789Z"), endedAt: null, createdAt: now, createdBy: "test", activationKey: "test", version: 0 };

test("monthly and yearly subscriptions use UTC calendar durations with month-end clamping", () => {
  assert.equal(subscriptionExpiry("monthly", now)?.toISOString(), "2026-02-28T12:34:56.789Z");
  assert.equal(subscriptionExpiry("monthly", new Date("2024-01-31T00:00:00Z"))?.toISOString(), "2024-02-29T00:00:00.000Z");
  assert.equal(subscriptionExpiry("monthly", new Date("2026-12-31T00:00:00Z"))?.toISOString(), "2027-01-31T00:00:00.000Z");
  assert.equal(subscriptionExpiry("yearly", new Date("2024-02-29T01:02:03Z"))?.toISOString(), "2025-02-28T01:02:03.000Z");
  assert.equal(subscriptionExpiry("lifetime", now), null);
  assert.equal(now.toISOString(), "2026-01-31T12:34:56.789Z", "does not mutate the starting date");
});

test("Pro fails closed at the exact expiry, before start, and after supersession", () => {
  assert.equal(isActiveSubscription(record, now), true);
  assert.equal(isActiveSubscription(record, new Date(now.getTime() - 1)), false);
  assert.equal(isActiveSubscription(record, record.expiresAt!), false);
  assert.equal(isActiveSubscription({ ...record, status: "superseded" }, now), false);
  assert.equal(isActiveSubscription({ ...record, status: "expired" }, now), false);
  assert.equal(isActiveSubscription(null, now), false);
  assert.equal(isActiveSubscription({ ...record, plan: "lifetime", expiresAt: null }, new Date("2099-01-01")), true);
  assert.deepEqual(publicSubscription(record, record.expiresAt!), { tier: "free", plan: null, startsAt: null, expiresAt: null, serverNow: record.expiresAt!.toISOString() });
});

test("Free history stops at 30 days while Pro can select up to 120", () => {
  assert.equal(maxHistoryWindowDays("free"), 30);
  assert.equal(maxHistoryWindowDays("pro"), 120);
  for (const days of [1, 7, 30]) assert.equal(canUseHistoryWindow("free", days), true);
  for (const days of [90, 120]) assert.equal(canUseHistoryWindow("free", days), false);
  for (const days of [1, 7, 30, 90, 120]) assert.equal(canUseHistoryWindow("pro", days), true);
  assert.equal(canUseHistoryWindow("pro", 31), false);
});
