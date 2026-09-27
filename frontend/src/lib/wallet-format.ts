/** Louma's ticker; every amount the wallet shows goes through here. */
export const CURRENCY = "LMA";

export const currency = (amount: number) =>
  `${new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  }).format(amount)} ${CURRENCY}`;

/**
 * Network tax on every transfer: the sender pays the amount they typed and the recipient is
 * credited the amount minus this share. It applies to every wallet — there are no plans, tiers, or
 * exemptions.
 */
export const TRANSFER_TAX_RATE = 0.01;

/** Two decimals, the smallest unit the wallet shows and stores. */
export const roundAmount = (amount: number): number => Number(amount.toFixed(2));

/** Tax taken out of `amount` before the recipient is credited. */
export const transferTax = (amount: number): number => roundAmount(amount * TRANSFER_TAX_RATE);

/** What actually reaches the recipient after the tax is deducted. */
export const transferNet = (amount: number): number => roundAmount(amount - transferTax(amount));

/** Amount strings the transfer form accepts: positive, at most four decimals, no separators. */
export const isValidAmountInput = (value: string): boolean =>
  /^\d+(\.\d{1,4})?$/.test(value.trim());

/** Shown instead of an amount while the wallet's balance privacy preference is on. */
export const hiddenAmount = "••••";

export const dateText = (date: string) =>
  new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(date),
  );
