import { test } from "node:test";
import assert from "node:assert/strict";
import {
  accountDelta,
  assertBalanced,
  calculateTransferAmounts,
  formatMoney,
  parseMoneyToMinorUnits,
} from "./money.js";
import { AppError } from "../../shared/errors.js";
import { MAX_TRANSFER_MINOR } from "../../shared/types.js";

/** Money is stored in integer minor units, so every expectation here is an exact integer. */

const isAppError =
  (code: string) =>
  (error: unknown): boolean =>
    error instanceof AppError && error.code === code;

test("parses a decimal string into integer minor units", () => {
  assert.equal(parseMoneyToMinorUnits("12.3456"), 123_456);
  assert.equal(parseMoneyToMinorUnits("1"), 10_000);
  assert.equal(parseMoneyToMinorUnits("0.0001"), 1);
});

test("formats minor units back into a four-decimal string", () => {
  assert.equal(formatMoney(123_456), "12.3456");
  assert.equal(formatMoney(1), "0.0001");
  assert.equal(formatMoney(0), "0.0000");
});

test("parsing and formatting round-trip without losing precision", () => {
  for (const amount of ["0.0001", "1.0000", "999999.9999", "1000000.0000"]) {
    assert.equal(formatMoney(parseMoneyToMinorUnits(amount)), amount);
  }
});

test("rejects amounts that are not plain positive decimals", () => {
  for (const amount of ["", " ", "0", "-1", "1.00005", "1e3", "1,000", "01", ".5", "abc"]) {
    assert.throws(() => parseMoneyToMinorUnits(amount), isAppError("invalid_amount"), amount);
  }
});

test("rejects non-string amounts instead of coercing them", () => {
  assert.throws(() => parseMoneyToMinorUnits(12.34), isAppError("invalid_amount"));
  assert.throws(() => parseMoneyToMinorUnits(null), isAppError("invalid_amount"));
});

test("enforces the maximum transfer amount", () => {
  assert.equal(parseMoneyToMinorUnits("1000000.0000"), MAX_TRANSFER_MINOR);
  assert.throws(() => parseMoneyToMinorUnits("1000000.0001"), isAppError("invalid_amount"));
});

test("computes the 1% fee rounded to the nearest minor unit", () => {
  // 100.0000 -> fee 1.0000, net 99.0000
  assert.deepEqual(calculateTransferAmounts(1_000_000), {
    amountMinor: 1_000_000,
    feeMinor: 10_000,
    netAmountMinor: 990_000,
  });
  // Half a minor unit rounds up: 50 minor -> fee 1, net 49
  assert.deepEqual(calculateTransferAmounts(50), { amountMinor: 50, feeMinor: 1, netAmountMinor: 49 });
  // Below half a minor unit the fee is zero, and the recipient keeps the whole amount
  assert.deepEqual(calculateTransferAmounts(49), { amountMinor: 49, feeMinor: 0, netAmountMinor: 49 });
});

test("every transfer keeps amount = fee + net and a positive net", () => {
  for (const amountMinor of [1, 49, 50, 51, 100, 9_999, 1_000_000, MAX_TRANSFER_MINOR]) {
    const amounts = calculateTransferAmounts(amountMinor);
    assert.equal(amounts.feeMinor + amounts.netAmountMinor, amounts.amountMinor);
    assert.ok(amounts.feeMinor >= 0);
    assert.ok(amounts.netAmountMinor > 0);
  }
});

test("rejects transfer amounts outside the allowed range", () => {
  assert.throws(() => calculateTransferAmounts(0), isAppError("invalid_amount"));
  assert.throws(() => calculateTransferAmounts(MAX_TRANSFER_MINOR + 1), isAppError("invalid_amount"));
  assert.throws(() => calculateTransferAmounts(1.5), isAppError("invalid_amount"));
});

test("accepts a balanced double-entry set and rejects an unbalanced one", () => {
  assert.doesNotThrow(() =>
    assertBalanced([
      { side: "debit", amountMinor: 1_000_000 },
      { side: "credit", amountMinor: 990_000 },
      { side: "credit", amountMinor: 10_000 },
    ]),
  );
  assert.throws(() =>
    assertBalanced([
      { side: "debit", amountMinor: 1_000_000 },
      { side: "credit", amountMinor: 990_000 },
    ]),
  );
});

test("rejects ledger sets that cannot balance", () => {
  assert.throws(() => assertBalanced([{ side: "debit", amountMinor: 10 }]));
  assert.throws(() =>
    assertBalanced([
      { side: "debit", amountMinor: 10 },
      { side: "credit", amountMinor: 0 },
    ]),
  );
  assert.throws(() =>
    assertBalanced([
      { side: "debit", amountMinor: -10 },
      { side: "credit", amountMinor: -10 },
    ]),
  );
});

test("a debit grows the normal side and a credit shrinks it", () => {
  assert.equal(accountDelta("debit", 500), 500);
  assert.equal(accountDelta("credit", 500), -500);
});

test("the maximum transfer keeps its fee and net inside exact integer bounds", () => {
  const amounts = calculateTransferAmounts(MAX_TRANSFER_MINOR);
  assert.equal(amounts.feeMinor, 100_000_000); // 1% of 1,000,000.0000, exact
  assert.equal(amounts.netAmountMinor, 9_900_000_000);
  assert.ok(Number.isSafeInteger(amounts.feeMinor));
  assert.ok(Number.isSafeInteger(amounts.netAmountMinor));
  assert.equal(amounts.feeMinor + amounts.netAmountMinor, MAX_TRANSFER_MINOR);
});

test("formatting refuses values that could not have come from the money arithmetic", () => {
  for (const value of [Number.NaN, Number.POSITIVE_INFINITY, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => formatMoney(value), `formatMoney(${value}) must throw`);
  }
});

test("the fee never exceeds the amount and the net stays positive across the whole range", () => {
  for (const amountMinor of [1, 2, 49, 50, 51, 99, 100, 101, 9_999, 10_000, 10_001, 999_999, 1_000_000]) {
    const amounts = calculateTransferAmounts(amountMinor);
    assert.ok(amounts.feeMinor >= 0 && amounts.feeMinor <= amountMinor);
    assert.ok(amounts.netAmountMinor > 0);
    assert.equal(amounts.amountMinor - amounts.feeMinor, amounts.netAmountMinor);
  }
});
