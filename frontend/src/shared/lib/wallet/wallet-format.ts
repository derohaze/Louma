import { currentLocale } from "@/shared/i18n";

/** Louma's ticker; every amount the wallet shows goes through here. */
const CURRENCY = "LMA";
const MONEY_DECIMALS = 4;
export const MONEY_SCALE = 10_000;
const MONEY_PATTERN = /^(?:0|[1-9]\d*)(?:\.(\d{1,4}))?$/;

/**
 * The largest amount a single transfer may carry, in minor units — mirrors the backend's ceiling.
 *
 * There is no product limit: a wallet may move any amount it can hold, so the only bound is the
 * exact-integer range four-decimal money is stored in — the largest whole amount that range holds.
 * The two sides derive it the same way so a form never accepts an amount the API would refuse, or
 * refuses one it would have moved.
 */
export const MAX_TRANSFER_MINOR = Math.floor(Number.MAX_SAFE_INTEGER / MONEY_SCALE) * MONEY_SCALE;

export function moneyToMinorUnits(value: string | number): number {
  const text = typeof value === "number" ? value.toFixed(MONEY_DECIMALS) : value.trim();
  const match = MONEY_PATTERN.exec(text);
  if (!match) throw new RangeError("Invalid LMA amount");
  const [whole, fraction = ""] = text.split(".");
  const minor = Number(whole) * MONEY_SCALE + Number(fraction.padEnd(MONEY_DECIMALS, "0"));
  if (!Number.isSafeInteger(minor)) throw new RangeError("LMA amount is outside the safe range");
  return minor;
}

export function moneyFromMinorUnits(minor: number): string {
  if (!Number.isSafeInteger(minor) || minor < 0) throw new RangeError("Invalid LMA amount");
  return `${Math.floor(minor / MONEY_SCALE)}.${String(minor % MONEY_SCALE).padStart(MONEY_DECIMALS, "0")}`;
}

/** Exact minor-unit parsing without the safe-integer ceiling, for aggregating many valid amounts. */
function minorUnitsBigInt(value: string | number): bigint {
  const text = typeof value === "number" ? value.toFixed(MONEY_DECIMALS) : value.trim();
  const match = MONEY_PATTERN.exec(text);
  if (!match) throw new RangeError("Invalid LMA amount");
  // Destructured with a default: the pattern above guarantees a leading whole part, but the
  // compiler cannot see that, and BigInt (unlike Number) refuses `undefined`.
  const [whole = "0", fraction = ""] = text.split(".");
  const minor = BigInt(whole) * BigInt(MONEY_SCALE) + BigInt(fraction.padEnd(MONEY_DECIMALS, "0"));
  if (minor < 0n) throw new RangeError("Invalid LMA amount");
  return minor;
}

function stringFromMinorUnits(minor: bigint): string {
  if (minor < 0n) throw new RangeError("Invalid LMA amount");
  return `${(minor / BigInt(MONEY_SCALE)).toString()}.${(minor % BigInt(MONEY_SCALE)).toString().padStart(MONEY_DECIMALS, "0")}`;
}

export function sumMoney(values: readonly (string | number)[]): string {
  // A single transfer is bounded by the safe-integer range, but a wallet's received total is not:
  // two individually valid transfers can sum past Number.MAX_SAFE_INTEGER in minor units. Summing
  // in BigInt keeps the overview rendering instead of throwing on the accumulated total.
  return stringFromMinorUnits(
    values.reduce<bigint>((sum, value) => sum + minorUnitsBigInt(value), 0n),
  );
}

/** Convert to a chart coordinate only; all wallet totals are summed in integer minor units first. */
export function moneyChartValue(value: string | number): number {
  // Totals from sumMoney can exceed the safe-integer range, so this parses exactly and converts
  // once: the chart coordinate is approximate by design, but it must never throw on a real total.
  return Number(minorUnitsBigInt(value)) / MONEY_SCALE;
}

function groupedMoneyValue(value: string | number): string {
  // Totals from sumMoney() can exceed the safe-integer range, so this parses exactly like the
  // aggregator instead of going through the range-limited moneyToMinorUnits(): the overview passes
  // those totals straight into currency(), and throwing here would blank the whole page.
  const minor = minorUnitsBigInt(value);
  const scale = BigInt(MONEY_SCALE);
  // The whole part itself can exceed the safe-integer range, so it is grouped as text rather than
  // formatted as a Number.
  const groupedWhole = (minor / scale).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const fraction = (minor % scale).toString().padStart(MONEY_DECIMALS, "0");
  const visibleFraction = fraction.replace(/0+$/, "").padEnd(2, "0");
  return `${groupedWhole}.${visibleFraction}`;
}

export const currency = (amount: string | number) => `${groupedMoneyValue(amount)} ${CURRENCY}`;

/** Network fee rounded to the nearest smallest unit, matching the backend's integer rule. */
export function transferTax(amount: string | number): string {
  const minor = moneyToMinorUnits(amount);
  return moneyFromMinorUnits(Math.floor((minor + 50) / 100));
}

export function transferNet(amount: string | number): string {
  return moneyFromMinorUnits(moneyToMinorUnits(amount) - moneyToMinorUnits(transferTax(amount)));
}

/**
 * A timestamp, written the way the reader's language writes one: Arabic month names in Arabic, and
 * the same Latin digits the amounts use. `currentLocale()` follows the language the screen is being
 * rendered in, so a switch re-renders every date without a single call site passing a locale.
 */
export const dateText = (date: string) =>
  new Intl.DateTimeFormat(currentLocale(), { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(date),
  );

/** Transfer times use UTC so both wallets display the same instant across device time zones. */
export const transactionDateText = (date: string) =>
  `${new Intl.DateTimeFormat(currentLocale(), {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(date))} UTC`;
