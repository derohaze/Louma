import { currency } from "@/lib/wallet-format";
import { securityFeatures, securityScoreMax, type SecurityFeatureId } from "@/lib/security-catalog";

/**
 * The wallet UI is built before the security API exists, so the controls on the Security pages read
 * and write this in-memory store. Every function below is deliberately thin so swapping it for real
 * requests later stays mechanical.
 *
 * Nothing here is a credential: the authenticator key and password fields are placeholders that
 * never leave the browser.
 */
export interface SecurityAlert {
  id: string;
  level: "info" | "success" | "warning";
  title: string;
  detail: string;
  at: string;
}

/** What the wallet asks for before a transfer leaves the account. */
export type TransferAuthMethod = "password" | "two-factor" | "both";

export interface SecuritySnapshot {
  enabled: Record<SecurityFeatureId, boolean>;
  /** LMA cap for a single day, used by the daily transfer limit. */
  dailyLimit: number;
  /** Days a device stays signed in under auto sign-in. */
  autoSignInDays: number;
  /** 24h clock window for time-based access. */
  timeAccess: { start: string; end: string };
  /** ISO country codes allowed to sign in; an empty list allows every country. */
  geoLockCountries: string[];
  /** Stops every transfer and sign-in until the owner unfreezes the wallet. */
  frozen: boolean;
  /** Which protection approves a transfer; it only applies while that protection is on. */
  transferAuthMethod: TransferAuthMethod;
  approvedIps: string[];
  /** Placeholder authenticator key; a real one is issued by the backend. */
  twoFactorSecret: string;
  backupCodesRemaining: number;
  /**
   * What the account set as its transfer password, held in memory for this session only. The
   * transfer form checks against it, and a real build would never keep it in the browser.
   */
  transferPassword: string | null;
  transferPasswordChangedAt: string | null;
  alerts: SecurityAlert[];
}

/** The visitor's demo session; the geo-lock and IP pages compare the wallet against these. */
export const currentSession = {
  ip: "102.44.18.7",
  city: "Cairo",
  country: "EG",
  countryName: "Egypt",
  device: "Chrome · Windows 11",
  signedInAt: null as string | null,
};

export const geoCountries: readonly { code: string; name: string }[] = [
  { code: "EG", name: "Egypt" },
  { code: "AE", name: "United Arab Emirates" },
  { code: "SA", name: "Saudi Arabia" },
  { code: "DE", name: "Germany" },
  { code: "GB", name: "United Kingdom" },
  { code: "US", name: "United States" },
];

export const countryName = (code: string): string =>
  geoCountries.find((country) => country.code === code)?.name ?? code;

const isoAt = (daysAgo: number, hour: number, minute = 0): string => {
  const date = new Date();
  date.setHours(hour, minute, 0, 0);
  date.setDate(date.getDate() - daysAgo);
  return date.toISOString();
};

if (!currentSession.signedInAt) currentSession.signedInAt = isoAt(0, 8, 12);

const state: SecuritySnapshot = {
  enabled: {
    "two-factor": true,
    "transfer-password": true,
    "daily-limit": false,
    "auto-sign-in": true,
    "time-access": false,
    "geo-lock": false,
    "ip-whitelist": false,
  },
  dailyLimit: 500,
  autoSignInDays: 20,
  timeAccess: { start: "08:00", end: "22:00" },
  geoLockCountries: ["EG"],
  frozen: false,
  transferAuthMethod: "password",
  approvedIps: ["102.44.18.7", "102.44.19.31"],
  twoFactorSecret: "LMA-7Q4M 2XK9 5HP3 8DT6",
  backupCodesRemaining: 8,
  transferPassword: "louma-demo-2026",
  transferPasswordChangedAt: isoAt(24, 11, 30),
  alerts: [
    {
      id: "alert-1",
      level: "success",
      title: "Two-factor authentication is active",
      detail: "Every sign-in now needs a code from your authenticator app.",
      at: isoAt(9, 14, 5),
    },
    {
      id: "alert-2",
      level: "warning",
      title: "New sign-in from an unrecognised device",
      detail: "Chrome on Windows 11 signed in from Cairo, Egypt.",
      at: isoAt(2, 21, 40),
    },
    {
      id: "alert-3",
      level: "info",
      title: "Transfer password changed",
      detail: "Transfers now wait for your transfer password.",
      at: isoAt(24, 11, 30),
    },
  ],
};

/**
 * One snapshot object is reused until the state actually changes. `useSyncExternalStore` compares
 * snapshots by reference, so building a new object on every read would re-render without end.
 */
let snapshot: SecuritySnapshot | null = null;
const securityListeners = new Set<() => void>();

/**
 * Lets a mounted view follow the security state. The wallet shell uses it so a freeze switched on
 * from a Security page locks the rest of the app immediately, without waiting for a route change.
 */
export const subscribeSecurity = (listener: () => void): (() => void) => {
  securityListeners.add(listener);
  return () => {
    securityListeners.delete(listener);
  };
};

/** Called by every setter: drops the cached snapshot and tells the mounted views to re-read. */
const securityChanged = (): void => {
  snapshot = null;
  securityListeners.forEach((listener) => listener());
};

export const readSecurity = (): SecuritySnapshot => {
  if (!snapshot) {
    snapshot = {
      ...state,
      enabled: { ...state.enabled },
      timeAccess: { ...state.timeAccess },
      approvedIps: [...state.approvedIps],
      geoLockCountries: [...state.geoLockCountries],
      alerts: [...state.alerts],
    };
  }
  return snapshot;
};

export const setSecurityFeature = (id: SecurityFeatureId, enabled: boolean): void => {
  state.enabled[id] = enabled;
  securityChanged();
};

export const setDailyLimit = (amount: number): void => {
  state.dailyLimit = amount;
  securityChanged();
};

export const setAutoSignInDays = (days: number): void => {
  state.autoSignInDays = days;
  securityChanged();
};

export const setTimeAccess = (start: string, end: string): void => {
  state.timeAccess = { start, end };
  securityChanged();
};

export const addGeoLockCountry = (code: string): void => {
  if (!state.geoLockCountries.includes(code)) state.geoLockCountries.push(code);
  securityChanged();
};

export const removeGeoLockCountry = (code: string): void => {
  state.geoLockCountries = state.geoLockCountries.filter((item) => item !== code);
  securityChanged();
};

export const setFrozen = (frozen: boolean): void => {
  state.frozen = frozen;
  securityChanged();
};

export const setTransferAuthMethod = (method: TransferAuthMethod): void => {
  state.transferAuthMethod = method;
  securityChanged();
};

/** True while the owner froze the wallet from the security screen. */
export const isWalletFrozen = (snapshot: SecuritySnapshot): boolean => snapshot.frozen;

export const addApprovedIp = (ip: string): void => {
  if (!state.approvedIps.includes(ip)) state.approvedIps.push(ip);
  securityChanged();
};

export const removeApprovedIp = (ip: string): void => {
  state.approvedIps = state.approvedIps.filter((item) => item !== ip);
  securityChanged();
};

const BACKUP_CODE_COUNT = 8;
/** Excludes look-alike characters so a printed code is easy to read back. */
const BACKUP_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
/** Bumped on every regeneration so each set differs from the last one. */
let backupCodeGeneration = 1;

/**
 * Spreads a seed across the alphabet so that two seeds printed next to each other look unrelated.
 * Deterministic on purpose: these codes are display-only stand-ins, not secrets.
 */
const characterAt = (seed: number, position: number): string => {
  const hashed = Math.abs(Math.sin(seed * 12.9898 + position * 78.233) * 43758.5453) % 1;
  return BACKUP_CODE_ALPHABET[Math.floor(hashed * BACKUP_CODE_ALPHABET.length)] ?? "A";
};

const backupCode = (seed: number): string => {
  const characters = [0, 1, 2, 3, 4, 5, 6, 7].map((position) => characterAt(seed, position));
  return `${characters.slice(0, 4).join("")}-${characters.slice(4).join("")}`;
};

/**
 * Stand-in for the backend's one-time code endpoint: it returns a fresh-looking set every call so
 * the UI can show codes, but nothing is stored or verified anywhere.
 */
export const regenerateBackupCodes = (): string[] => {
  backupCodeGeneration += 1;
  const codes = Array.from({ length: BACKUP_CODE_COUNT }, (_, index) =>
    backupCode(backupCodeGeneration * BACKUP_CODE_COUNT + index),
  );
  state.backupCodesRemaining = codes.length;
  securityChanged();
  return codes;
};

export const setTransferPassword = (password: string): void => {
  state.transferPassword = password;
  state.transferPasswordChangedAt = new Date().toISOString();
  securityChanged();
};

/** "HH:MM" as minutes past midnight, or NaN when the value is not a time. */
const clockMinutes = (value: string): number => {
  const [hours, minutes] = value.split(":").map(Number);
  if (hours === undefined || minutes === undefined) return Number.NaN;
  return hours * 60 + minutes;
};

/**
 * Whether the wallet is open at `time`. Time-based access windows may run past midnight, so the
 * comparison flips when the end time is earlier than the start time.
 */
export const isWithinAccessWindow = (snapshot: SecuritySnapshot, time: Date): boolean => {
  if (!snapshot.enabled["time-access"]) return true;
  const now = time.getHours() * 60 + time.getMinutes();
  const start = clockMinutes(snapshot.timeAccess.start);
  const end = clockMinutes(snapshot.timeAccess.end);
  // An unreadable window must never lock anyone out, so it counts as open.
  if (Number.isNaN(start) || Number.isNaN(end)) return true;
  return start <= end ? now >= start && now <= end : now >= start || now <= end;
};

/** True when time-based access is on and the current clock is outside its window. */
export const isWalletClosed = (snapshot: SecuritySnapshot, time: Date): boolean =>
  !isWithinAccessWindow(snapshot, time);

/**
 * Stand-in for the authenticator app: six digits that rotate every 30 seconds, like a real TOTP
 * code, derived from the demo key. Display-only — nothing behind this build verifies it.
 */
const twoFactorCodeAtStep = (step: number): string => {
  const seed =
    [...state.twoFactorSecret].reduce((total, character) => total + character.charCodeAt(0), 0) +
    step;
  const hashed = Math.abs(Math.sin(seed * 12.9898) * 43758.5453) % 1;
  return String(Math.floor(hashed * 1_000_000)).padStart(6, "0");
};

/** The code that is valid right now. */
export const twoFactorCode = (time: Date): string =>
  twoFactorCodeAtStep(Math.floor(time.getTime() / 30_000));

/**
 * Accepts the previous and the next window as well: a code typed just before it rotates would
 * otherwise be rejected for a reason the person holding the phone cannot see.
 */
export const isTwoFactorCodeValid = (code: string, time: Date): boolean => {
  const trimmed = code.trim();
  if (!/^\d{6}$/.test(trimmed)) return false;
  const step = Math.floor(time.getTime() / 30_000);
  return [step - 1, step, step + 1].some((value) => twoFactorCodeAtStep(value) === trimmed);
};

/** Seconds until the demo code rotates, so the UI can say how long the current one lasts. */
export const twoFactorCodeSecondsLeft = (time: Date): number =>
  30 - (Math.floor(time.getTime() / 1000) % 30);

export interface TransferGuardInput {
  /** LMA the transfer would send. */
  amount: number;
  /** LMA already sent today, which the daily limit is measured against. */
  spentToday: number;
  /** What the account typed as its transfer password. */
  transferPassword: string;
  /** What the account typed from their authenticator app. */
  twoFactorCode: string;
  /** Supplied by the caller so the rules stay pure and easy to test. */
  now: Date;
}

/**
 * The rules a transfer has to pass, in the order the wallet applies them. Returning a reason keeps
 * the checks in one place: a new rule is a new branch here, and the form only renders the message.
 */
export const transferBlockedReason = (
  snapshot: SecuritySnapshot,
  input: TransferGuardInput,
): string | null => {
  if (snapshot.frozen) {
    return "The wallet is frozen. Unfreeze it from Security before sending.";
  }
  if (isWalletClosed(snapshot, input.now)) {
    return `The wallet is closed until ${snapshot.timeAccess.start}.`;
  }
  if (snapshot.enabled["daily-limit"]) {
    const remaining = snapshot.dailyLimit - input.spentToday;
    if (input.amount > remaining) {
      return `Daily limit reached: ${currency(Math.max(remaining, 0))} left for today.`;
    }
  }
  // The chosen approval only applies while its protection is switched on.
  const method = snapshot.transferAuthMethod;
  if (snapshot.enabled["transfer-password"] && (method === "password" || method === "both")) {
    if (!snapshot.transferPassword) return "Set your transfer password before sending.";
    if (input.transferPassword !== snapshot.transferPassword) {
      return "The transfer password is incorrect.";
    }
  }
  if (snapshot.enabled["two-factor"] && (method === "two-factor" || method === "both")) {
    if (!isTwoFactorCodeValid(input.twoFactorCode, input.now)) {
      return "That one-time code is not valid. Open your authenticator app for a fresh one.";
    }
  }
  return null;
};

export interface SecurityScore {
  score: number;
  max: number;
  enabledCount: number;
  total: number;
}

export const securityScore = (snapshot: SecuritySnapshot): SecurityScore => ({
  score: securityFeatures.reduce(
    (total, feature) => (snapshot.enabled[feature.id] ? total + feature.importance : total),
    0,
  ),
  max: securityScoreMax,
  enabledCount: securityFeatures.filter((feature) => snapshot.enabled[feature.id]).length,
  total: securityFeatures.length,
});

/** LMA the wallet has already sent today, which the daily transfer limit is measured against. */
export const sentToday = (
  transactions: { direction: string; amount: number; created_at: string }[],
): number =>
  transactions
    .filter(
      (transaction) =>
        transaction.direction === "sent" &&
        new Date(transaction.created_at).toDateString() === new Date().toDateString(),
    )
    .reduce((total, transaction) => total + transaction.amount, 0);

/** One-line state summary, shown in the Security Center list and on each feature page. */
export const securityStateText = (id: SecurityFeatureId, snapshot: SecuritySnapshot): string => {
  switch (id) {
    case "two-factor":
      return snapshot.enabled[id]
        ? `${snapshot.backupCodesRemaining} backup codes remaining`
        : "One-time codes are not required";
    case "transfer-password":
      return snapshot.enabled[id]
        ? `Last changed ${new Date(snapshot.transferPasswordChangedAt ?? Date.now()).toLocaleDateString()}`
        : "Transfers are approved with your account password";
    case "daily-limit":
      return snapshot.enabled[id]
        ? `Up to ${currency(snapshot.dailyLimit)} per day`
        : "No cap on daily transfers";
    case "auto-sign-in":
      return snapshot.enabled[id]
        ? `Devices stay signed in for ${snapshot.autoSignInDays} days`
        : "Credentials required for every session";
    case "time-access":
      return snapshot.enabled[id]
        ? `Access allowed ${snapshot.timeAccess.start} – ${snapshot.timeAccess.end}`
        : "Access allowed at any hour";
    case "geo-lock":
      if (!snapshot.enabled[id]) return "Access allowed from any country";
      return snapshot.geoLockCountries.length
        ? `${snapshot.geoLockCountries.map(countryName).join(", ")} only`
        : "No country allowed yet";
    case "ip-whitelist":
      return snapshot.enabled[id]
        ? `${snapshot.approvedIps.length} approved address${snapshot.approvedIps.length === 1 ? "" : "es"}`
        : "Any IP address is accepted";
  }
};
