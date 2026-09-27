import type { ApiSecurityOverview, ApiUser } from "@/lib/api";
import type { Transaction, Wallet } from "@/hooks/wallet-context";

/**
 * The last confirmed snapshot of the signed-in account, kept for this tab only.
 *
 * Every wallet page mounts its own `WalletProvider`, so a navigation that had no snapshot would
 * start from an empty state and show the loading skeleton for data the tab already holds. The
 * snapshot carries nothing the page is not about to render anyway, it dies with the tab, and it is
 * dropped as soon as a session ends or a new one starts, so one account can never inherit another
 * one's history.
 */
export interface WalletSnapshot {
  user: ApiUser;
  wallet: Wallet | null;
  transactions: Transaction[];
  nextCursor: string | null;
  security: ApiSecurityOverview | null;
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
    return isSnapshot(parsed) ? parsed : null;
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
