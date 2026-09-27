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

export interface SecuritySnapshot {
  enabled: Record<SecurityFeatureId, boolean>;
  /** Stops every transfer and sign-in until the owner unfreezes the wallet. */
  frozen: boolean;
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

/** The visitor's demo session; the device list reads its device, location, and address from here. */
export const currentSession = {
  ip: "102.44.18.7",
  city: "Cairo",
  countryName: "Egypt",
  device: "Chrome · Windows 11",
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

const state: SecuritySnapshot = {
  enabled: {
    "two-factor": true,
    "transfer-password": true,
  },
  frozen: false,
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
      alerts: [...state.alerts],
    };
  }
  return snapshot;
};

export const setSecurityFeature = (id: SecurityFeatureId, enabled: boolean): void => {
  state.enabled[id] = enabled;
  securityChanged();
};

export const setFrozen = (frozen: boolean): void => {
  state.frozen = frozen;
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

export interface TransferGuardInput {
  /** What the account typed as its transfer password. */
  transferPassword: string;
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
  if (snapshot.enabled["transfer-password"]) {
    if (!snapshot.transferPassword) return "Set your transfer password before sending.";
    if (input.transferPassword !== snapshot.transferPassword) {
      return "The transfer password is incorrect.";
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
  }
};
