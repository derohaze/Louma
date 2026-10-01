import { isTransferTarget } from "@/lib/validation";

/**
 * Device-local address book and personal transaction notes.
 *
 * There is no backend for either yet, so both live in localStorage, keyed by
 * account: one account's saved addresses must never leak into another's.
 * The transfer form sends a real `note` to the API on new transfers (the
 * backend already accepts it); the local note covers older transfers whose
 * record has no note, and both are shown with their source labeled.
 */

export interface SavedAddress {
  address: string;
  label: string;
  addedAt: number;
}

const addressBookKey = (userId: string | null) => `louma:addressbook:${userId ?? "anon"}`;
const notesKey = (userId: string | null) => `louma:txnotes:${userId ?? "anon"}`;
export const TRANSFER_PREFILL_KEY = "louma:transfer:prefill";

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
  if (typeof window === "undefined") return [];
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
  writeJson(addressBookKey(userId), next);
  return next;
}

export function isSavedAddress(userId: string | null, address: string): boolean {
  return loadAddressBook(userId).some(
    (entry) => entry.address.toLowerCase() === address.toLowerCase(),
  );
}

export function savedLabelFor(userId: string | null, address: string): string | null {
  return (
    loadAddressBook(userId).find((entry) => entry.address.toLowerCase() === address.toLowerCase())
      ?.label ?? null
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

/** Personal note for a transfer, stored on this device only. */
export function loadLocalNote(userId: string | null, transferId: string): string {
  if (typeof window === "undefined") return "";
  return readJson<Record<string, string>>(notesKey(userId), {})[transferId] ?? "";
}

export function saveLocalNote(userId: string | null, transferId: string, note: string): void {
  const notes = readJson<Record<string, string>>(notesKey(userId), {});
  if (note.trim()) notes[transferId] = note.trim().slice(0, 240);
  else delete notes[transferId];
  writeJson(notesKey(userId), notes);
}

/** What the UI shows: the on-record note first, the device note as fallback. */
export function displayNote(serverNote: string, localNote: string): string {
  return serverNote || localNote;
}
