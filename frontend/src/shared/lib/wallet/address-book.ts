import { isTransferTarget } from "@/shared/lib/platform";

/**
 * Device-local address book.
 *
 * There is no backend for it yet, so it lives in localStorage, keyed by
 * account: one account's saved addresses must never leak into another's.
 */

export interface SavedAddress {
  address: string;
  label: string;
  addedAt: number;
}

const addressBookKey = (userId: string | null) => `louma:addressbook:${userId ?? "anon"}`;
const TRANSFER_PREFILL_KEY = "louma:transfer:prefill";

/**
 * The `anon` buckets below exist only as storage keys, never as readable data: every reader
 * returns empty for a null user (profile still loading / signed out) and every writer refuses to
 * persist without an account. Otherwise an address saved while the profile was loading would land
 * in a shared `anon` bucket that the next account on the same browser then reads.
 */
function requireUserKey(userId: string | null): string | null {
  return userId;
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private mode: the feature works for this visit, it just won't persist.
  }
}

export function loadAddressBook(userId: string | null): SavedAddress[] {
  if (typeof window === "undefined" || !requireUserKey(userId)) return [];
  const entries = readJson<SavedAddress[]>(addressBookKey(userId), []);
  if (!Array.isArray(entries)) return [];
  return entries.filter(
    (entry) =>
      entry &&
      typeof entry.address === "string" &&
      typeof entry.label === "string" &&
      isTransferTarget(entry.address),
  );
}

export function saveAddress(userId: string | null, address: string, label: string): SavedAddress[] {
  const normalized = address.trim();
  const current = loadAddressBook(userId);
  // No signed-in account (profile still loading): keep it in memory only, never in the `anon`
  // bucket, so it cannot leak into the next account on this browser.
  if (!requireUserKey(userId)) {
    return [
      { address: normalized, label: label.trim() || shortAddress(normalized), addedAt: Date.now() },
      ...current.filter((entry) => entry.address.toLowerCase() !== normalized.toLowerCase()),
    ].slice(0, 50);
  }
  const next = [
    { address: normalized, label: label.trim() || shortAddress(normalized), addedAt: Date.now() },
    ...loadAddressBook(userId).filter(
      (entry) => entry.address.toLowerCase() !== normalized.toLowerCase(),
    ),
  ].slice(0, 50);
  writeJson(addressBookKey(userId), next);
  return next;
}

export function removeAddress(userId: string | null, address: string): SavedAddress[] {
  const next = loadAddressBook(userId).filter(
    (entry) => entry.address.toLowerCase() !== address.toLowerCase(),
  );
  if (!requireUserKey(userId)) return next;
  writeJson(addressBookKey(userId), next);
  return next;
}

export function isSavedAddress(userId: string | null, address: string): boolean {
  return loadAddressBook(userId).some(
    (entry) => entry.address.toLowerCase() === address.toLowerCase(),
  );
}

/** Middle-truncated address for chips and tight rows. */
export function shortAddress(address: string): string {
  if (address.length <= 18) return address;
  return `${address.slice(0, 10)}…${address.slice(-6)}`;
}

/** Stash a recipient so the transfer page opens with it filled in. */
export function prefillTransfer(address: string): void {
  try {
    window.localStorage.setItem(TRANSFER_PREFILL_KEY, address);
  } catch {
    // Best effort; the transfer page still works without it.
  }
}

/** Read once and clear: the transfer form consumes it on mount. */
export function consumeTransferPrefill(): string {
  if (typeof window === "undefined") return "";
  try {
    const value = window.localStorage.getItem(TRANSFER_PREFILL_KEY) ?? "";
    window.localStorage.removeItem(TRANSFER_PREFILL_KEY);
    return value;
  } catch {
    return "";
  }
}

/** Drops the one-shot recipient so a signed-out tab never hands it to the next account. */
export function clearTransferPrefill(): void {
  try {
    window.localStorage?.removeItem(TRANSFER_PREFILL_KEY);
  } catch {
    // Best effort; the next consume clears it anyway.
  }
}
