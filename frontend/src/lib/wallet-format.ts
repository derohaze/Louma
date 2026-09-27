/** Louma's ticker; every amount the wallet shows goes through here. */
export const CURRENCY = "LMA";
export const MONEY_DECIMALS = 4;
export const MONEY_SCALE = 10_000;
const MONEY_PATTERN = /^(?:0|[1-9]\d*)(?:\.(\d{1,4}))?$/;

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

export function sumMoney(values: readonly (string | number)[]): string {
  // The generic parameter is explicit: without it TypeScript picks the array's own element type as
  // the accumulator, and the sum is typed `string | number`.
  return moneyFromMinorUnits(
    values.reduce<number>((sum, value) => sum + moneyToMinorUnits(value), 0),
  );
}

/** Convert to a chart coordinate only; all wallet totals are summed in integer minor units first. */
export function moneyChartValue(value: string | number): number {
  return moneyToMinorUnits(value) / MONEY_SCALE;
}

function groupedMoneyValue(value: string | number): string {
  const minor = moneyToMinorUnits(value);
  const whole = Math.floor(minor / MONEY_SCALE);
  const fraction = String(minor % MONEY_SCALE).padStart(MONEY_DECIMALS, "0");
  const visibleFraction = fraction.replace(/0+$/, "").padEnd(2, "0");
  return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(whole)}.${visibleFraction}`;
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

export const dateText = (date: string) =>
  new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(date),
  );
