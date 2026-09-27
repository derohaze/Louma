import {
  FEE_PERCENT,
  MAX_TRANSFER_MINOR,
  MIN_TRANSFER_MINOR,
  MONEY_DECIMALS,
  MONEY_SCALE,
  type LedgerSide,
} from "../../shared/types.js";
import { badRequest } from "../../shared/errors.js";

const MONEY_PATTERN = /^(?:0|[1-9]\d*)(?:\.(\d{1,4}))?$/;

export function parseMoneyToMinorUnits(value: unknown): number {
  if (typeof value !== "string") throw badRequest("invalid_amount", "Enter the amount as a decimal string.");
  const normalized = value.trim();
  const match = MONEY_PATTERN.exec(normalized);
  if (!match) throw badRequest("invalid_amount", "Enter a positive amount with up to four decimal places.");

  const [whole, fraction = ""] = normalized.split(".");
  const minor = Number(whole) * MONEY_SCALE + Number(fraction.padEnd(MONEY_DECIMALS, "0"));
  if (!Number.isSafeInteger(minor) || minor < MIN_TRANSFER_MINOR || minor > MAX_TRANSFER_MINOR) {
    throw badRequest("invalid_amount", "The amount is outside the allowed range.");
  }
  return minor;
}

export function calculateTransferAmounts(amountMinor: number): {
  amountMinor: number;
  feeMinor: number;
  netAmountMinor: number;
} {
  if (!Number.isSafeInteger(amountMinor) || amountMinor < MIN_TRANSFER_MINOR || amountMinor > MAX_TRANSFER_MINOR) {
    throw badRequest("invalid_amount", "The amount is outside the allowed range.");
  }
  const feeMinor = Math.floor((amountMinor * FEE_PERCENT + 50) / 100);
  const netAmountMinor = amountMinor - feeMinor;
  if (feeMinor < 0 || netAmountMinor <= 0 || !Number.isSafeInteger(netAmountMinor)) {
    throw badRequest("invalid_amount", "The amount is too small to transfer after fees.");
  }
  return { amountMinor, feeMinor, netAmountMinor };
}

export function formatMoney(minor: number): string {
  if (!Number.isSafeInteger(minor) || minor < 0) throw new RangeError("Invalid money value");
  const whole = Math.floor(minor / MONEY_SCALE);
  const fraction = String(minor % MONEY_SCALE).padStart(MONEY_DECIMALS, "0");
  return `${whole}.${fraction}`;
}

export function accountDelta(side: LedgerSide, amountMinor: number): number {
  return side === "debit" ? amountMinor : -amountMinor;
}

export function assertBalanced(entries: ReadonlyArray<{ side: LedgerSide; amountMinor: number }>): void {
  if (entries.length < 2 || entries.some((entry) => !Number.isSafeInteger(entry.amountMinor) || entry.amountMinor <= 0)) {
    throw new Error("Ledger transaction must contain at least two positive integer entries");
  }
  const debitTotal = entries.filter((entry) => entry.side === "debit").reduce((sum, entry) => sum + entry.amountMinor, 0);
  const creditTotal = entries.filter((entry) => entry.side === "credit").reduce((sum, entry) => sum + entry.amountMinor, 0);
  if (!Number.isSafeInteger(debitTotal) || debitTotal !== creditTotal) {
    throw new Error("Ledger transaction is not balanced");
  }
}
