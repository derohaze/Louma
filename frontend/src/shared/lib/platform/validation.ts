import { translate } from "@/shared/i18n";
import { MAX_TRANSFER_MINOR, moneyFromMinorUnits, moneyToMinorUnits } from "@/shared/lib/wallet";

/**
 * Every rule the wallet applies to what someone types, in one module with no UI imports. The forms
 * read these rules, and the backend re-checks the same limits, so the two never drift apart.
 *
 * The messages are translation keys resolved when the rule runs — the same validator answers the
 * transfer form and the security pages, and each of them renders the message in its own language.
 */

/** Upper bounds for every free-text field, so nothing unbounded can reach a request body. */
export const LIMITS = {
  amountDecimals: 4,
  /** One minor unit: the smallest amount the money arithmetic can represent. */
  minAmountMinor: 1,
  minPasswordLength: 8,
  maxPasswordLength: 128,
  /** Mirrors the API's own caps on the transfer form, so nothing unbounded can be typed into it. */
  maxRecipientLength: 128,
  maxAmountLength: 32,
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

/** Canonical wallet address: the fixed prefix, 26 Crockford symbols, and two checksum symbols. */
const WALLET_ADDRESS_PATTERN = /^LMA[0-7][0-9A-HJKMNP-TV-Z]{27}$/;
/** Public handle, written with the leading "@". */
const HANDLE_PATTERN = /^@[a-z0-9_]{4,24}$/;

/** Addresses are compared in upper case, so a lower-cased paste still resolves. */
const isWalletAddress = (value: string): boolean =>
  WALLET_ADDRESS_PATTERN.test(value.trim().toUpperCase());

/** Handles are compared in lower case, matching how the wallet stores them. */
const isHandle = (value: string): boolean => HANDLE_PATTERN.test(value.trim().toLowerCase());

/** A transfer target is either a wallet address or a public handle. */
export const isTransferTarget = (value: string): boolean =>
  isWalletAddress(value) || isHandle(value);

/**
 * Tidies a typed or pasted transfer target as it is typed: a wallet address is upper case by
 * convention and a handle is lower case, so both are normalised rather than shown rejected, and an
 * address pasted with spaces around its groups still resolves.
 */
export const normalizeTransferTarget = (value: string): string => {
  const collapsed = value.replace(/\s+/g, "").slice(0, LIMITS.maxRecipientLength);
  return collapsed.startsWith("@") ? collapsed.toLowerCase() : collapsed.toUpperCase();
};

/** Six digits from the authenticator app. */
export const isOneTimeCode = (value: string): boolean =>
  new RegExp(`^\\d{${LIMITS.oneTimeCodeLength}}$`).test(value.trim());

/** Digits only, so a pasted code with spaces or letters is corrected while typing. */
export const oneTimeCodeDigits = (value: string): string =>
  value.replace(/\D/g, "").slice(0, LIMITS.oneTimeCodeLength);

interface AmountCheck {
  ok: boolean;
  /** Exact decimal string to send to the API; an invalid amount is represented as `0`. */
  value: string;
  error: string;
}

/**
 * Amounts arrive as text. Only plain decimal numbers are accepted: signs, exponents, and thousands
 * separators are rejected rather than guessed at, and the result is capped by real money rather than
 * by a product rule: the caller passes the balance it is spending from, and the default is the
 * largest amount the money arithmetic can carry exactly.
 *
 * Both bounds are integer minor units, so the comparison never goes through a floating-point value.
 */
export const parseAmount = (
  raw: string,
  options: {
    minMinor?: number;
    maxMinor?: number;
  } = {},
): AmountCheck => {
  const { minMinor = LIMITS.minAmountMinor, maxMinor = MAX_TRANSFER_MINOR } = options;
  const text = raw.trim();
  if (!text) return { ok: false, value: "0", error: translate("validation.amount.empty") };
  if (!new RegExp(`^\\d+(\\.\\d{1,${LIMITS.amountDecimals}})?$`).test(text)) {
    return { ok: false, value: "0", error: translate("validation.amount.invalid") };
  }
  let minor: number;
  try {
    minor = moneyToMinorUnits(text);
  } catch {
    return { ok: false, value: "0", error: translate("validation.amount.invalid") };
  }
  if (minor <= 0) {
    return { ok: false, value: "0", error: translate("validation.amount.zero") };
  }
  if (minor < minMinor) {
    return { ok: false, value: "0", error: translate("validation.amount.tooSmall") };
  }
  if (minor > maxMinor) {
    return { ok: false, value: "0", error: translate("validation.amount.tooLarge") };
  }
  return { ok: true, value: moneyFromMinorUnits(minor), error: "" };
};

interface PasswordRule {
  id: "length" | "letter" | "number";
  label: string;
  met: boolean;
}

/** The strength rules every wallet credential has to satisfy. */
export const passwordRules = (value: string): PasswordRule[] => [
  {
    id: "length",
    label: translate("validation.password.minLength", { min: LIMITS.minPasswordLength }),
    met: value.length >= LIMITS.minPasswordLength,
  },
  {
    id: "letter",
    label: translate("validation.password.letter"),
    met: /[A-Za-z]/.test(value),
  },
  {
    id: "number",
    label: translate("validation.password.number"),
    met: /\d/.test(value),
  },
];

/** True when a password satisfies every rule and stays inside the length cap. */
const isStrongPassword = (value: string): boolean =>
  value.length <= LIMITS.maxPasswordLength && passwordRules(value).every((rule) => rule.met);

/**
 * Whether a new password may be saved, and the message to show when it may not. Kept here so every
 * password form in the wallet applies the same rules.
 */
export const newPasswordError = (value: string, confirmation: string): string | null => {
  if (value.length > LIMITS.maxPasswordLength) {
    return translate("validation.password.tooLong", { max: LIMITS.maxPasswordLength });
  }
  if (!isStrongPassword(value)) {
    return translate("validation.password.weak", { min: LIMITS.minPasswordLength });
  }
  if (value !== confirmation) return translate("validation.password.mismatch");
  return null;
};
