import { test } from "node:test";
import assert from "node:assert/strict";
import { ObjectId } from "mongodb";
import { loadConfig } from "../../config/env.js";
import { accruedMinorFor, pickRateUnits, rateToString, secureRandomIntInclusive, totalAccrualMinor } from "./rate.js";
import { toPublicSession } from "./service.js";
import type { MiningSessionRecord } from "../../shared/types.js";

/**
 * The mining arithmetic is the part that must be exactly right: it decides what a 24-hour cycle pays
 * and it is the only thing standing between a client and an unlimited reward. These tests pin the
 * window, the clamping, the precision, and the lifecycle rules without a database, so a regression
 * is caught before it can reach a ledger.
 *
 * Randomness is never asserted on as a value — only its bounds and its variation — because a test
 * that predicts a draw would be testing the seed, not the guarantee.
 */

const MONTH = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const DAY_SECONDS = 24 * 60 * 60;

/** A 6-decimal rate of exactly 0.050000 LMA/hour, as the persisted integers hold it. */
const RATE = { rateUnits: 50_000, rateScale: 1_000_000 };
const WINDOW = { startedAtMs: 0, endsAtMs: DAY_SECONDS * 1000, durationSeconds: DAY_SECONDS };

test("a drawn integer stays inside its inclusive range", () => {
  for (let index = 0; index < 500; index += 1) {
    const value = secureRandomIntInclusive(10, 13);
    assert.ok(value >= 10 && value <= 13, `value ${value} is inside [10, 13]`);
    assert.ok(Number.isInteger(value));
  }
  assert.equal(secureRandomIntInclusive(7, 7), 7, "a single-value range resolves to that value");
  assert.throws(() => secureRandomIntInclusive(5, 4), RangeError);
});

test("draws are not a constant, and every value in a small range appears", () => {
  const seen = new Set<number>();
  for (let index = 0; index < 2_000; index += 1) seen.add(secureRandomIntInclusive(0, 2));
  assert.deepEqual([...seen].sort(), [0, 1, 2], "a three-value range is fully reachable");
});

test("a cycle's rate is drawn inside the configured band and varies between draws", () => {
  const spec = { minUnits: 10_000, maxUnits: 50_000, scale: 1_000_000, decimals: 6 };
  const drawn = new Set<number>();
  for (let index = 0; index < 200; index += 1) {
    const units = pickRateUnits(spec);
    assert.ok(units >= spec.minUnits && units <= spec.maxUnits, "the draw honours the configured range");
    drawn.add(units);
  }
  assert.ok(drawn.size > 1, "two accounts would not be handed the same rate by construction");
  assert.equal(pickRateUnits({ minUnits: 42, maxUnits: 42, scale: 1_000_000, decimals: 6 }), 42);
});

test("rate rendering is exact fixed-point with no float division", () => {
  assert.equal(rateToString(50_000, 1_000_000, 6), "0.050000");
  assert.equal(rateToString(12_345, 1_000_000, 6), "0.012345");
  assert.equal(rateToString(1_000_000, 1_000_000, 6), "1.000000");
  // A rate that another rounding approach would render as 0.029999999999999998.
  assert.equal(rateToString(30_000, 1_000_000, 6), "0.030000");
});

test("accrual is proportional to elapsed time and exact at each sample", () => {
  assert.equal(accruedMinorFor({ ...RATE, ...WINDOW, nowMs: 0 }), 0, "nothing accrues before the start");
  assert.equal(accruedMinorFor({ ...RATE, ...WINDOW, nowMs: -1 }), 0, "a clock before the start still accrues nothing");
  // 0.05 LMA/hour for one hour is exactly 0.0500 LMA = 500 minor units.
  assert.equal(accruedMinorFor({ ...RATE, ...WINDOW, nowMs: HOUR_MS }), 500);
  assert.equal(accruedMinorFor({ ...RATE, ...WINDOW, nowMs: 12 * HOUR_MS }), 6_000);
  assert.equal(accruedMinorFor({ ...RATE, ...WINDOW, nowMs: 30 * 60 * 1000 }), 250, "half an hour is half the hourly rate");
});

test("the window is a hard ceiling: 24h - 1ms is under, 24h is exact, anything later is clamped", () => {
  const full = 12_000;
  assert.equal(accruedMinorFor({ ...RATE, ...WINDOW, nowMs: WINDOW.endsAtMs }), full);
  assert.ok(
    accruedMinorFor({ ...RATE, ...WINDOW, nowMs: WINDOW.endsAtMs - 1 }) < full,
    "one millisecond short of the window cannot pay the full 24-hour reward",
  );
  assert.equal(accruedMinorFor({ ...RATE, ...WINDOW, nowMs: WINDOW.endsAtMs + 1 }), full, "one millisecond past the window pays no more");
  assert.equal(accruedMinorFor({ ...RATE, ...WINDOW, nowMs: WINDOW.endsAtMs + MONTH }), full, "a month later pays no more");
  assert.equal(totalAccrualMinor(RATE, WINDOW), full, "the total is the accrual at the closing instant");
});

test("accrual is monotonic in time and never exceeds the 24-hour total", () => {
  let previous = 0;
  for (let seconds = 0; seconds <= DAY_SECONDS + 2 * DAY_SECONDS; seconds += 137) {
    const accrued = accruedMinorFor({ ...RATE, ...WINDOW, nowMs: seconds * 1000 });
    assert.ok(accrued >= previous, `accrual went backwards at ${seconds}s`);
    assert.ok(accrued <= 12_000, `accrual exceeded the 24-hour total at ${seconds}s`);
    previous = accrued;
  }
});

test("a high-precision rate still resolves to whole minor units exactly", () => {
  // 0.000001 LMA/hour over a full day is 0.000024 LMA — too small for one 0.0001 minor unit, so it
  // floors to zero rather than inventing a fraction of a unit.
  assert.equal(accruedMinorFor({ rateUnits: 1, rateScale: 1_000_000, ...WINDOW, nowMs: WINDOW.endsAtMs }), 0);
  // 1.000000 LMA/hour for a day is 24.0000 LMA exactly.
  assert.equal(accruedMinorFor({ rateUnits: 1_000_000, rateScale: 1_000_000, ...WINDOW, nowMs: WINDOW.endsAtMs }), 240_000);
});

/** A stored cycle with the fields the lifecycle is derived from. */
function storedSession(overrides: Partial<MiningSessionRecord> = {}): MiningSessionRecord {
  return {
    _id: new ObjectId(),
    publicId: "11111111-1111-4111-8111-111111111111",
    ownerUserId: "user-1",
    walletId: "wallet-1",
    ledgerAccountId: "account-1",
    status: "active",
    cycleNumber: 1,
    startedAt: new Date(0),
    endsAt: new Date(WINDOW.endsAtMs),
    durationSeconds: DAY_SECONDS,
    rateUnits: RATE.rateUnits,
    rateScale: RATE.rateScale,
    rateDecimals: 6,
    rate: "0.050000",
    rateUnit: "LMA/hour",
    settledMinor: 0,
    settlementSequence: 0,
    lastSettledAt: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...overrides,
  };
}

test("the reported status follows the stored lifecycle and the clock", () => {
  assert.equal(toPublicSession(storedSession(), 0).status, "active");
  assert.equal(toPublicSession(storedSession(), WINDOW.endsAtMs - 1).status, "active");
  assert.equal(toPublicSession(storedSession(), WINDOW.endsAtMs).status, "completed");
  assert.equal(toPublicSession(storedSession(), WINDOW.endsAtMs + MONTH).status, "completed");
  assert.equal(toPublicSession(storedSession({ status: "settled" }), 0).status, "settled", "a closed cycle stays closed");
});

test("a running cycle reports its remaining time and whether there is anything to collect", () => {
  const running = toPublicSession(storedSession(), HOUR_MS);
  assert.equal(running.remainingSeconds, DAY_SECONDS - 3600);
  assert.equal(running.elapsedSeconds, 3600);
  assert.equal(running.canSettle, true);
  assert.equal(running.accrued, "0.0500");

  const settled = toPublicSession(storedSession({ settledMinor: 12_000, status: "settled" }), WINDOW.endsAtMs);
  assert.equal(settled.canSettle, false);
  assert.equal(settled.settled, "1.2000");
  assert.equal(settled.totalAccrued, "1.2000");
  assert.equal(settled.progress, 1);
});

test("mining configuration is validated: the 24-hour window and the one-cycle rule are invariants", () => {
  const base = {
    MONGODB_URI: "mongodb://127.0.0.1:27017/louma",
    MONGODB_DATABASE: "louma",
    ACCESS_TOKEN_SECRET: Buffer.alloc(32, 1).toString("base64"),
    APP_ENCRYPTION_KEY: Buffer.alloc(32, 2).toString("base64"),
  };

  const defaults = loadConfig({ ...base }).mining;
  assert.equal(defaults.cycleDurationSeconds, DAY_SECONDS);
  assert.equal(defaults.maxActiveCyclesPerUser, 1);
  assert.equal(defaults.rate.decimals, 6);
  assert.equal(defaults.rate.scale, 1_000_000);
  assert.equal(defaults.rate.minUnits, 10_000, "0.0100 LMA/hour at six decimals");
  assert.equal(defaults.rate.maxUnits, 50_000, "0.0500 LMA/hour at six decimals");

  assert.throws(() => loadConfig({ ...base, MINING_CYCLE_DURATION_SECONDS: "3600" }), /MINING_CYCLE_DURATION_SECONDS/);
  assert.throws(() => loadConfig({ ...base, MINING_MAX_ACTIVE_CYCLES_PER_USER: "2" }), /MINING_MAX_ACTIVE_CYCLES_PER_USER/);
  assert.throws(() => loadConfig({ ...base, MINING_RATE_MIN_LMA_PER_HOUR: "0.0900", MINING_RATE_MAX_LMA_PER_HOUR: "0.0500" }), /MINING_RATE_MIN_LMA_PER_HOUR/);
  assert.throws(() => loadConfig({ ...base, MINING_RATE_DECIMALS: "9" }), /MINING_RATE_DECIMALS/);
  assert.throws(() => loadConfig({ ...base, MINING_RATE_DECIMALS: "2", MINING_RATE_MIN_LMA_PER_HOUR: "0.001" }), /MINING_RATE_MIN_LMA_PER_HOUR/, "precision beyond the configured decimals is refused, not truncated");
  assert.throws(() => loadConfig({ ...base, MINING_RATE_MIN_LMA_PER_HOUR: "-1" }), /MINING_RATE_MIN_LMA_PER_HOUR/);
  assert.throws(() => loadConfig({ ...base, MINING_ENABLED: "maybe" }), /MINING_ENABLED/);

  const tuned = loadConfig({ ...base, MINING_RATE_MIN_LMA_PER_HOUR: "0.0001", MINING_RATE_MAX_LMA_PER_HOUR: "0.0002", MINING_RATE_DECIMALS: "4" });
  assert.equal(tuned.mining.rate.minUnits, 1, "0.0001 at four decimals");
  assert.equal(tuned.mining.rate.maxUnits, 2, "0.0002 at four decimals");
  assert.equal(tuned.mining.rate.scale, 10_000);
});
