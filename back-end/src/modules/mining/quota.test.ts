import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MINING_DAILY_QUOTA_SECONDS,
  MINING_QUOTA_WINDOW_SECONDS,
  accountConsumedSeconds,
  accountWindowStartOf,
  allowedSessionSeconds,
  currentAccountWindowStart,
  deviceConsumedSeconds,
  deviceQuotaKeyFor,
  minedSecondsForSession,
  remainingSeconds,
  windowRemainingSeconds,
  type QuotaSessionView,
} from "./quota.js";
import { quotaFromSessions, stateFromRecord } from "./state.js";
import type { MiningSessionRecord } from "../../shared/types.js";
import { ObjectId } from "mongodb";

const HOUR = 3600;
const QUOTA = 10 * HOUR;
const WINDOW = 24 * HOUR;
const T0 = Date.UTC(2026, 0, 1, 12, 0, 0);

function segment(startMs: number, seconds: number, overrides: Partial<QuotaSessionView> = {}): QuotaSessionView {
  return {
    startedAt: new Date(startMs),
    endsAt: new Date(startMs + seconds * 1000),
    status: "settled",
    ...overrides,
  };
}

function stored(overrides: Partial<MiningSessionRecord> = {}): MiningSessionRecord {
  return {
    _id: new ObjectId(),
    publicId: "11111111-1111-4111-8111-111111111111",
    ownerUserId: "user-1",
    walletId: "wallet-1",
    ledgerAccountId: "account-1",
    status: "active",
    cycleNumber: 1,
    startedAt: new Date(T0),
    endsAt: new Date(T0 + QUOTA * 1000),
    durationSeconds: QUOTA,
    rateUnits: 50_000,
    rateScale: 1_000_000,
    rateDecimals: 6,
    rate: "0.050000",
    rateUnit: "LMA/hour",
    settledMinor: 0,
    settlementSequence: 0,
    lastSettledAt: null,
    createdAt: new Date(T0),
    updatedAt: new Date(T0),
    ...overrides,
  };
}

test("constants: 10h quota per 24h window", () => {
  assert.equal(MINING_DAILY_QUOTA_SECONDS, QUOTA);
  assert.equal(MINING_QUOTA_WINDOW_SECONDS, WINDOW);
});

test("basic quota: 10h maximum, 10h + 1s accrues nothing more", () => {
  const windowStart = T0;
  const full = [segment(T0, QUOTA, { accountWindowStart: new Date(windowStart) })];
  assert.equal(accountConsumedSeconds(full, windowStart, T0 + QUOTA * 1000), QUOTA);
  assert.equal(remainingSeconds(QUOTA), 0);
  // One more second of wall time adds no consumable quota: the segment is
  // already capped at endsAt, so mined time stays exactly 10h.
  assert.equal(minedSecondsForSession(full[0]!, T0 + (QUOTA + 1) * 1000), QUOTA);
  assert.equal(minedSecondsForSession(full[0]!, T0 + (QUOTA + 3600) * 1000), QUOTA);
});

test("stop: mine 1h then stop consumes 1h and leaves 9h", () => {
  const windowStart = T0;
  const oneHour = [segment(T0, HOUR, { accountWindowStart: new Date(windowStart) })];
  const consumed = accountConsumedSeconds(oneHour, windowStart, T0 + HOUR * 1000);
  assert.equal(consumed, HOUR);
  assert.equal(remainingSeconds(consumed), 9 * HOUR);
});

test("resume is not a new quota: 1h + resume leaves only 9h", () => {
  const windowStart = T0;
  const first = segment(T0, HOUR, { accountWindowStart: new Date(windowStart) });
  // Resume two hours later: first segment stays 1h, second starts later.
  const secondStart = T0 + 3 * HOUR * 1000;
  const second = segment(secondStart, HOUR, { accountWindowStart: new Date(windowStart) });
  const consumed = accountConsumedSeconds([first, second], windowStart, secondStart + HOUR * 1000);
  assert.equal(consumed, 2 * HOUR);
  assert.equal(remainingSeconds(consumed), 8 * HOUR);
  // A single 1h segment alone leaves exactly 9h for the resume.
  assert.equal(remainingSeconds(accountConsumedSeconds([first], windowStart, secondStart)), 9 * HOUR);
});

test("stop does not refund: consumed stays after close", () => {
  const windowStart = T0;
  const sessions = [segment(T0, HOUR, { status: "settled", accountWindowStart: new Date(windowStart) })];
  // Far later in the same window the consumed hour is still counted.
  assert.equal(accountConsumedSeconds(sessions, windowStart, windowStart + 20 * HOUR * 1000), HOUR);
});

test("account switching shares the device quota: A 1h then B sees 9h left", () => {
  const deviceWindow = T0;
  const key = "machine-1";
  const a = segment(T0, HOUR, { deviceQuotaKey: key, deviceWindowStart: new Date(deviceWindow) });
  assert.equal(deviceConsumedSeconds([a], deviceWindow, T0 + HOUR * 1000), HOUR);
  assert.equal(remainingSeconds(HOUR), 9 * HOUR);
  // B has no segments of its own, but the shared device sum still counts A's hour.
  const bSessions: QuotaSessionView[] = [a];
  assert.equal(deviceConsumedSeconds(bSessions, deviceWindow, T0 + 2 * HOUR * 1000), HOUR);
});

test("same-device concurrency: second start is rejected and consumes nothing", () => {
  // A is actively mining (ends in the future); B's attempt must not create a
  // segment, so the device sum contains only A's elapsed-to-now.
  const now = T0 + 30 * 60 * 1000;
  const aActive: QuotaSessionView = {
    startedAt: new Date(T0),
    endsAt: new Date(T0 + QUOTA * 1000),
    status: "active",
    deviceQuotaKey: "machine-1",
    deviceWindowStart: new Date(T0),
  };
  assert.equal(minedSecondsForSession(aActive, now), 1800);
  // No segment for B exists: sums are unchanged by the rejected attempt.
  assert.equal(deviceConsumedSeconds([aActive], T0, now), 1800);
  // The intersection for B would be min(accountRemaining, deviceRemaining) but
  // the lease lock rejects first; allowed() only shows the cap it would get.
  const allowed = allowedSessionSeconds({
    accountRemainingSeconds: QUOTA,
    deviceRemainingSeconds: remainingSeconds(1800),
    accountWindowRemainingSeconds: WINDOW - 1800,
    deviceWindowRemainingSeconds: WINDOW - 1800,
  });
  assert.ok(allowed > 0, "quota alone would allow B, the lease is what refuses it");
});

test("different devices: same account quota holds across devices", () => {
  const windowStart = T0;
  const onDevice1 = segment(T0, 2 * HOUR, { accountWindowStart: new Date(windowStart) });
  const consumed = accountConsumedSeconds([onDevice1], windowStart, T0 + 5 * HOUR * 1000);
  assert.equal(consumed, 2 * HOUR);
  // Starting on device 2 sees the same account sum: only 8h left.
  assert.equal(remainingSeconds(consumed), 8 * HOUR);
  const allowedOnDevice2 = allowedSessionSeconds({
    accountRemainingSeconds: remainingSeconds(consumed),
    deviceRemainingSeconds: QUOTA, // fresh device
    accountWindowRemainingSeconds: WINDOW - 5 * HOUR,
    deviceWindowRemainingSeconds: WINDOW,
  });
  assert.equal(allowedOnDevice2, 8 * HOUR);
});

test("device quota: A 4h + B 3h leaves C at most 3h", () => {
  const deviceWindow = T0;
  const key = "machine-shared";
  const a = segment(T0, 4 * HOUR, { deviceQuotaKey: key, deviceWindowStart: new Date(deviceWindow) });
  const b = segment(T0 + 5 * HOUR * 1000, 3 * HOUR, { deviceQuotaKey: key, deviceWindowStart: new Date(deviceWindow) });
  const now = T0 + 9 * HOUR * 1000;
  assert.equal(deviceConsumedSeconds([a, b], deviceWindow, now), 7 * HOUR);
  assert.equal(remainingSeconds(7 * HOUR), 3 * HOUR);
  const allowedC = allowedSessionSeconds({
    accountRemainingSeconds: QUOTA, // C is fresh
    deviceRemainingSeconds: remainingSeconds(7 * HOUR),
    accountWindowRemainingSeconds: WINDOW,
    deviceWindowRemainingSeconds: WINDOW - 9 * HOUR,
  });
  assert.equal(allowedC, 3 * HOUR);
});

test("intersection: allowed is min(account, device) capped to windows", () => {
  assert.equal(
    allowedSessionSeconds({ accountRemainingSeconds: 8 * HOUR, deviceRemainingSeconds: 3 * HOUR, accountWindowRemainingSeconds: WINDOW, deviceWindowRemainingSeconds: WINDOW }),
    3 * HOUR,
  );
  assert.equal(
    allowedSessionSeconds({ accountRemainingSeconds: 0, deviceRemainingSeconds: 5 * HOUR, accountWindowRemainingSeconds: WINDOW, deviceWindowRemainingSeconds: WINDOW }),
    0,
  );
  // A segment never crosses its window end.
  assert.equal(
    allowedSessionSeconds({ accountRemainingSeconds: QUOTA, deviceRemainingSeconds: QUOTA, accountWindowRemainingSeconds: 1800, deviceWindowRemainingSeconds: WINDOW }),
    1800,
  );
});

test("concurrent race: two starts from one snapshot, one winner, no over-consumption", async () => {
  const windowStart = T0;
  const now = T0 + 1000;
  // Both racers read the same empty window: each computes full quota.
  const racer = () => allowedSessionSeconds({
    accountRemainingSeconds: QUOTA,
    deviceRemainingSeconds: QUOTA,
    accountWindowRemainingSeconds: WINDOW,
    deviceWindowRemainingSeconds: WINDOW,
  });
  const [first, second] = await Promise.all([Promise.resolve(racer()), Promise.resolve(racer())]);
  assert.equal(first, QUOTA);
  assert.equal(second, QUOTA);
  // The database unique indexes (one active per account, one active lease per
  // device) let exactly one insert win. Model the winner committing a full
  // segment, then the loser recomputes: nothing remains.
  const winner = segment(now, first, { accountWindowStart: new Date(windowStart), deviceQuotaKey: "m", deviceWindowStart: new Date(windowStart) });
  const afterWin = accountConsumedSeconds([winner], windowStart, now + first * 1000);
  assert.equal(afterWin, QUOTA);
  assert.equal(remainingSeconds(afterWin), 0);
});

test("quota reset: consumed inside 24h, fresh after the anchor + 24h", () => {
  const windowStart = T0;
  const sessions = [segment(T0, 3 * HOUR, { accountWindowStart: new Date(windowStart) })];
  // 23h later the same window still counts the 3h.
  const beforeReset = T0 + 23 * HOUR * 1000;
  const currentBefore = currentAccountWindowStart(accountWindowStartOf(sessions[0]!), beforeReset);
  assert.equal(currentBefore.isNewWindow, false);
  assert.equal(accountConsumedSeconds(sessions, currentBefore.windowStartMs, beforeReset), 3 * HOUR);
  // At anchor + 24h a new window opens with zero consumed.
  const afterReset = T0 + WINDOW * 1000;
  const currentAfter = currentAccountWindowStart(accountWindowStartOf(sessions[0]!), afterReset);
  assert.equal(currentAfter.isNewWindow, true);
  assert.equal(accountConsumedSeconds(sessions, currentAfter.windowStartMs, afterReset), 0);
  assert.equal(remainingSeconds(0), QUOTA);
});

test("stop at boundaries: immediate, 1h, near-10h, exact, past-end", () => {
  const windowStart = T0;
  const immediate = segment(T0, 0, { accountWindowStart: new Date(windowStart) });
  assert.equal(minedSecondsForSession(immediate, T0), 0);
  assert.equal(remainingSeconds(accountConsumedSeconds([immediate], windowStart, T0 + 1000)), QUOTA);
  const oneHour = segment(T0, HOUR, { accountWindowStart: new Date(windowStart) });
  assert.equal(accountConsumedSeconds([oneHour], windowStart, T0 + HOUR * 1000), HOUR);
  const nearFull = segment(T0, QUOTA - 1, { accountWindowStart: new Date(windowStart) });
  assert.equal(minedSecondsForSession(nearFull, T0 + QUOTA * 1000), QUOTA - 1);
  const exact = segment(T0, QUOTA, { accountWindowStart: new Date(windowStart) });
  assert.equal(minedSecondsForSession(exact, T0 + QUOTA * 1000), QUOTA);
  // Past the end clamps: no accrual above 10h.
  assert.equal(minedSecondsForSession(exact, T0 + (QUOTA + 5000) * 1000), QUOTA);
  assert.equal(remainingSeconds(accountConsumedSeconds([exact], windowStart, T0 + 20 * HOUR * 1000)), 0);
});

test("exhaustion: full 10h then start is refused, even for another account on the device", () => {
  const windowStart = T0;
  const full = [segment(T0, QUOTA, { accountWindowStart: new Date(windowStart), deviceQuotaKey: "m", deviceWindowStart: new Date(windowStart) })];
  const consumed = accountConsumedSeconds(full, windowStart, T0 + QUOTA * 1000);
  assert.equal(remainingSeconds(consumed), 0);
  const deviceConsumed = deviceConsumedSeconds(full, windowStart, T0 + QUOTA * 1000);
  assert.equal(remainingSeconds(deviceConsumed), 0);
  const allowed = allowedSessionSeconds({
    accountRemainingSeconds: 0,
    deviceRemainingSeconds: 0,
    accountWindowRemainingSeconds: WINDOW - QUOTA,
    deviceWindowRemainingSeconds: WINDOW - QUOTA,
  });
  assert.equal(allowed, 0);
});

test("device quota key: same machine shares, different machines do not", () => {
  assert.equal(deviceQuotaKeyFor("machine-abc", "cluster-1"), "machine-abc");
  assert.equal(deviceQuotaKeyFor(null, "cluster-1"), "cluster-1");
  assert.notEqual(deviceQuotaKeyFor("machine-abc", "cluster-1"), deviceQuotaKeyFor("machine-xyz", "cluster-2"));
});

test("legacy rows without anchors count by startedAt", () => {
  const legacy: QuotaSessionView = { startedAt: new Date(T0), endsAt: new Date(T0 + HOUR * 1000) };
  assert.equal(accountWindowStartOf(legacy), T0);
  assert.equal(accountConsumedSeconds([legacy], T0, T0 + 2 * HOUR * 1000), HOUR);
});

test("window remaining shrinks to the reset", () => {
  const WINDOW_MS = WINDOW * 1000;
  assert.equal(windowRemainingSeconds(T0, T0, WINDOW_MS), WINDOW);
  assert.equal(windowRemainingSeconds(T0, T0 + (WINDOW - 60) * 1000, WINDOW_MS), 60);
  assert.equal(windowRemainingSeconds(T0, T0 + WINDOW * 1000, WINDOW_MS), 0);
  assert.equal(windowRemainingSeconds(T0, T0 + (WINDOW + 100) * 1000, WINDOW_MS), 0);
});

test("state reports quota and refuses start when exhausted", () => {
  const now = T0 + HOUR * 1000;
  const rec = stored({ startedAt: new Date(T0), endsAt: new Date(T0 + QUOTA * 1000), durationSeconds: QUOTA, status: "settled", accountWindowStart: new Date(T0) });
  const quota = quotaFromSessions([rec], T0, now);
  // One settled hour is not in this helper's list (rec spans 10h from T0, now is
  // 1h in), so consumed is the elapsed-to-now of the 10h segment = 1h.
  assert.equal(quota.consumedSeconds, HOUR);
  assert.equal(quota.remainingSeconds, 9 * HOUR);
  const exhausted = quotaFromSessions([stored({ ...rec, startedAt: new Date(T0), endsAt: new Date(T0 + QUOTA * 1000) })], T0, T0 + QUOTA * 1000);
  assert.equal(exhausted.remainingSeconds, 0);
  const refused = stateFromRecord(rec, T0 + QUOTA * 1000, true, true, WINDOW, "low", false, exhausted);
  assert.equal(refused.canStart, false);
  const allowed = stateFromRecord(null, T0, true, true, WINDOW, "low", false, quota);
  assert.equal(allowed.canStart, true);
});
