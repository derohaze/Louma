import type { ApiSecurityOverview, ApiUser } from "@/lib/api";
import type { Transaction, Wallet } from "@/hooks/wallet-context";

/**
 * The last confirmed snapshot of the signed-in account, kept for this tab only.
 *
 * It exists for the reload: the in-memory cache survives navigation but not a page load, and without
 * a snapshot an F5 would show the skeleton for data the tab was already holding. The snapshot carries
 * nothing the page is not about to render anyway, it dies with the tab, and it is dropped as soon as
 * a session ends or a new one starts, so one account can never inherit another one's history.
 */
export interface WalletSnapshot {
  user: ApiUser;
  wallet: Wallet | null;
  transactions: Transaction[];
  nextCursor: string | null;
  security: ApiSecurityOverview | null;
  /**
   * When this snapshot was written. The copy restores a screen without a skeleton, and its age is
   * what decides whether the API is asked again — a snapshot is never trusted as fresh just because
   * it was found. A payload written before this field existed carries no age and reads as stale.
   */
  savedAt: number;
}

const STORAGE_KEY = "louma.wallet.snapshot.v1";

/** `sessionStorage` is absent during SSR and throws when a browser blocks storage entirely. */
function tabStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

/** A stored payload is trusted only if it still has the shape this release reads. */
function isSnapshot(value: unknown): value is WalletSnapshot {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<WalletSnapshot>;
  return (
    typeof candidate.user?.id === "string" &&
    typeof candidate.user.email === "string" &&
    Array.isArray(candidate.transactions)
  );
}

export function readWalletSnapshot(): WalletSnapshot | null {
  const raw = tabStorage()?.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isSnapshot(parsed)) return null;
    // A payload written before `savedAt` existed is still usable, it simply has no age. Reading it as
    // perfectly stale makes the API answer it again rather than trusting a copy of unknown age.
    return { ...parsed, savedAt: typeof parsed.savedAt === "number" ? parsed.savedAt : 0 };
  } catch {
    // An unreadable payload is treated as no snapshot; the next fetch overwrites it.
    return null;
  }
}

/**
 * Fails silently on purpose: the cache only ever saves a round trip, so a blocked or full storage
 * must never break the screen that is trying to persist its own data.
 */
export function writeWalletSnapshot(snapshot: WalletSnapshot): void {
  try {
    tabStorage()?.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    /* ignored */
  }
}

export function clearWalletSnapshot(): void {
  try {
    tabStorage()?.removeItem(STORAGE_KEY);
  } catch {
    /* ignored */
  }
}
