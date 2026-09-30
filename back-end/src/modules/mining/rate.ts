import { randomBytes } from "node:crypto";
import { MONEY_SCALE } from "../../shared/types.js";
import type { MiningRateSpec } from "../../config/env.js";

/**
 * The exact arithmetic behind mining.
 *
 * Everything here is pure: no clock is read, no database is touched, and no state is kept. A cycle's
 * reward is a function of the persisted rate, the persisted window, and the server's current time,
 * which is what makes it reproducible on any process — and what makes a client unable to influence
 * it.
 *
 * Money never becomes a float. Rates are integer counts of `1 / scale` LMA per hour, and an accrual
 * is one BigInt division whose intermediate product cannot round. See `accruedMinorFor`.
 */

const SECONDS_PER_HOUR = 3600n;

/**
 * A uniformly distributed integer in `[min, max]`, from a cryptographically secure source.
 *
 * `Math.random()` is deliberately not used: a predictable rate would let a client that can observe
 * its own draws predict another account's, and a biased one would hand some accounts a permanently
 * better deal. Bytes are drawn and rejected until they land inside the largest multiple of the range
 * that fits the draw width, which is the standard unbiased construction — every value in the range
 * is equally likely, with no modulo skew.
 */
export function secureRandomIntInclusive(min: number, max: number): number {
  if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || min > max) {
    throw new RangeError("secureRandomIntInclusive requires safe integers with min <= max");
  }
  const range = BigInt(max - min + 1);
  if (range === 1n) return min;

  const bits = (range - 1n).toString(2).length;
  const byteCount = Math.ceil(bits / 8);
  const space = 1n << BigInt(byteCount * 8);
  // Reject the tail that would make the last bucket short, so the modulo below stays uniform.
  const limit = space - (space % range);

  for (;;) {
    const bytes = randomBytes(byteCount);
    let value = 0n;
    for (const byte of bytes) value = (value << 8n) | BigInt(byte);
    if (value < limit) return min + Number(value % range);
  }
}

/** Draws the rate for a new cycle: one integer inside the configured range, inclusive. */
export function pickRateUnits(spec: MiningRateSpec): number {
  return secureRandomIntInclusive(spec.minUnits, spec.maxUnits);
}

/** Renders `units / scale` as a fixed-point decimal string, without floating-point division. */
export function rateToString(units: number, scale: number, decimals: number): string {
  if (!Number.isSafeInteger(units) || units < 0) throw new RangeError("Invalid rate value");
  const whole = Math.floor(units / scale);
  const fraction = String(units % scale).padStart(decimals, "0");
  return `${whole}.${fraction}`;
}

export interface AccrualInput {
  rateUnits: number;
  rateScale: number;
  startedAtMs: number;
  endsAtMs: number;
  nowMs: number;
  durationSeconds: number;
}

/**
 * Whole minor units earned at `nowMs`.
 *
 * The clock is clamped before anything else: `effectiveNow = min(now, endsAt)`. A process whose
 * clock ran forward, a replay after the window closed, and a hundred retries of the same settle all
 * observe the same ceiling, and the ceiling cannot be moved by the caller because `endsAt` is the
 * stored value, not an argument anyone on the network can supply.
 *
 * Elapsed time is floored to whole seconds so the result only ever steps forward, and the accrual is
 * a single floor division of exact integers:
 *
 *   accruedMinor = rateUnits * MONEY_SCALE * elapsedSeconds / (rateScale * 3600)
 *
 * The numerator is a rate in minor units per second scaled by the elapsed seconds; the denominator
 * is the rate unit's hour expressed in seconds. BigInt keeps the intermediate product exact for
 * every configured precision, and the floor is monotonic in time, so no stretch of time can ever
 * make the reward go backwards or exceed the 24-hour total.
 */
export function accruedMinorFor(input: AccrualInput): number {
  if (input.rateScale <= 0 || input.durationSeconds <= 0) throw new RangeError("Invalid mining cycle");
  const effectiveNow = Math.min(input.nowMs, input.endsAtMs);
  const elapsedMs = effectiveNow - input.startedAtMs;
  if (elapsedMs <= 0) return 0;

  const elapsedSeconds = Math.min(Math.floor(elapsedMs / 1000), input.durationSeconds);
  if (elapsedSeconds <= 0) return 0;

  const numerator = BigInt(input.rateUnits) * BigInt(MONEY_SCALE) * BigInt(elapsedSeconds);
  const denominator = BigInt(input.rateScale) * SECONDS_PER_HOUR;
  const accrued = numerator / denominator;

  if (accrued > BigInt(Number.MAX_SAFE_INTEGER)) {
    // Unreachable with validated configuration, but an accrual that cannot be represented exactly is
    // an integrity fault rather than something to round away.
    throw new RangeError("Mining accrual exceeds the exact-integer range");
  }
  return Number(accrued);
}

/** The most a cycle can pay in total: its accrual at the moment the window closes. */
export function totalAccrualMinor(rate: { rateUnits: number; rateScale: number }, window: { startedAtMs: number; endsAtMs: number; durationSeconds: number }): number {
  return accruedMinorFor({ ...rate, ...window, nowMs: window.endsAtMs });
}
