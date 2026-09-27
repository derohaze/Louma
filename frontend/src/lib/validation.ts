import { roundAmount } from "@/lib/wallet-format";

/**
 * Every rule the wallet applies to what someone types, in one module with no UI imports. The forms
 * read these rules and the demo store applies them again before it writes anything, so a future
 * backend can mirror one file instead of re-deriving the rules from the screens.
 */

/** Upper bounds for every free-text field, so nothing unbounded can reach a request body. */
export const LIMITS = {
  amountDecimals: 4,
  minAmount: 0.0001,
  maxAmount: 1_000_000,
  minDailyLimit: 50,
  maxDailyLimit: 1_000_000,
  minPasswordLength: 8,
  maxPasswordLength: 128,
  maxNoteLength: 240,
  maxSearchLength: 60,
  maxDisplayNameLength: 32,
  maxHandleLength: 24,
  minHandleLength: 4,
  oneTimeCodeLength: 6,
} as const; /**
 * Drops control characters (and DEL), which never belong in text a person types. Written as a
 * filter rather than a regex so the intent is readable and no escape range has to be suppressed.
 */
const withoutControlCharacters = (value: string): string =>
  [...value]
    .filter((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code >= 0x20 && code !== 0x7f;
    })
    .join("");

/** One line of text, with control characters removed and repeated spaces collapsed. */
export const sanitizeText = (value: string, maxLength: number): string =>
  withoutControlCharacters(value).replace(/\s+/g, " ").trim().slice(0, maxLength);

/** Wallet address: the ticker plus three groups of four characters. */
const WALLET_ADDRESS_PATTERN = /^LMA(-[A-Z0-9]{4}){3}$/;
/** Public handle, written with the leading "@". */
const HANDLE_PATTERN = /^@[a-z0-9_]{4,24}$/;

/** Addresses are compared in upper case, so a lower-cased paste still resolves. */
const isWalletAddress = (value: string): boolean =>
  WALLET_ADDRESS_PATTERN.test(value.trim().toUpperCase());

/** Handles are compared in lower case, matching how the wallet stores them. */
export const isHandle = (value: string): boolean => HANDLE_PATTERN.test(value.trim().toLowerCase());

/** A transfer target is either a wallet address or a public handle. */
export const isTransferTarget = (value: string): boolean =>
  isWalletAddress(value) || isHandle(value);

/** Accepts only a full IPv4 address with each octet inside 0-255. */
export const isIpv4 = (value: string): boolean => {
  const parts = value.trim().split(".");
  return parts.length === 4 && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}; /** "HH:MM" on a 24-hour clock, as `type="time"` produces it. */
const isTimeOfDay = (value: string): boolean => /^([01]\d|2[0-3]):[0-5]\d$/.test(value.trim());

/** A saved access window needs two valid times that are not the same. */
export const timeWindowError = (start: string, end: string): string | null => {
  if (!isTimeOfDay(start) || !isTimeOfDay(end)) return "Enter both times as HH:MM.";
  if (start.trim() === end.trim()) return "The window has to open before it closes.";
  return null;
};

/** Six digits from the authenticator app. */
export const isOneTimeCode = (value: string): boolean =>
  new RegExp(`^\\d{${LIMITS.oneTimeCodeLength}}$`).test(value.trim());

/** Digits only, so a pasted code with spaces or letters is corrected while typing. */
export const oneTimeCodeDigits = (value: string): string =>
  value.replace(/\D/g, "").slice(0, LIMITS.oneTimeCodeLength);

export interface AmountCheck {
  ok: boolean;
  /** The amount to use once `ok` is true; 0 otherwise. */
  value: number;
  error: string;
}

/**
 * Amounts arrive as text. Only plain decimal numbers are accepted: signs, exponents, and thousands
 * separators are rejected rather than guessed at, and the result is capped by `max` (the balance).
 */
export const parseAmount = (
  raw: string,
  { min = LIMITS.minAmount, max = LIMITS.maxAmount }: { min?: number; max?: number } = {},
): AmountCheck => {
  const text = raw.trim();
  if (!text) return { ok: false, value: 0, error: "Enter an amount." };
  if (!new RegExp(`^\\d+(\\.\\d{1,${LIMITS.amountDecimals}})?$`).test(text)) {
    return { ok: false, value: 0, error: "Enter a positive amount, with up to four decimals." };
  }
  const value = Number(text);
  if (!Number.isFinite(value) || value <= 0) {
    return { ok: false, value: 0, error: "Enter an amount greater than zero." };
  }
  if (value < min) return { ok: false, value: 0, error: "That amount is too small to send." };
  if (value > max) return { ok: false, value: 0, error: "That amount is more than you can send." };
  return { ok: true, value: roundAmount(value), error: "" };
};

export interface PasswordRule {
  id: "length" | "letter" | "number";
  label: string;
  met: boolean;
}

/** The rules the wallet password and the transfer password share. */
export const passwordRules = (value: string): PasswordRule[] => [
  {
    id: "length",
    label: `At least ${LIMITS.minPasswordLength} characters`,
    met: value.length >= LIMITS.minPasswordLength,
  },
  { id: "letter", label: "Contains a letter", met: /[A-Za-z]/.test(value) },
  { id: "number", label: "Contains a number", met: /\d/.test(value) },
];

/** True when a password satisfies every rule and stays inside the length cap. */
export const isStrongPassword = (value: string): boolean =>
  value.length <= LIMITS.maxPasswordLength && passwordRules(value).every((rule) => rule.met);

/**
 * Whether a new password may be saved, and the message to show when it may not. Kept here so the
 * transfer password form and the wallet password form cannot drift apart.
 */
export const newPasswordError = (value: string, confirmation: string): string | null => {
  if (value.length > LIMITS.maxPasswordLength) {
    return `Use at most ${LIMITS.maxPasswordLength} characters.`;
  }
  if (!isStrongPassword(value)) return "Use at least 8 characters with both letters and numbers.";
  if (value !== confirmation) return "The two passwords do not match.";
  return null;
};
