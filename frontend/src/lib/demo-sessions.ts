import { currentSession } from "@/lib/demo-security";

/**
 * Devices signed in to the wallet. There is no session API yet, so the list lives in memory: the
 * device reading the page is merged with a few earlier ones, so the page has something real to
 * manage and revoking a row is a visible change. A real build would key this off the session
 * records the backend already issues.
 */
export type SessionKind = "browser" | "app";

export interface WalletSession {
  id: string;
  kind: SessionKind;
  device: string;
  location: string;
  ip: string;
  /** Last request seen from this device. */
  lastActiveAt: string;
  /** The session reading the page. It can only be ended by signing out, never revoked from here. */
  current: boolean;
  /** Set by auto sign-in, so the row can say why the device stayed signed in. */
  trusted: boolean;
}

const isoAt = (daysAgo: number, hour: number, minute = 0): string => {
  const date = new Date();
  date.setHours(hour, minute, 0, 0);
  date.setDate(date.getDate() - daysAgo);
  return date.toISOString();
};

let sessions: WalletSession[] = [
  {
    id: "session-current",
    kind: "browser",
    device: currentSession.device,
    location: `${currentSession.city}, ${currentSession.countryName}`,
    ip: currentSession.ip,
    lastActiveAt: new Date().toISOString(),
    current: true,
    trusted: false,
  },
  {
    id: "session-app-android",
    kind: "app",
    device: "Louma Wallet · Android",
    location: "Cairo, Egypt",
    ip: "102.44.19.31",
    lastActiveAt: isoAt(0, 7, 12),
    current: false,
    trusted: true,
  },
  {
    id: "session-safari-macos",
    kind: "browser",
    device: "Safari · macOS",
    location: "Dubai, United Arab Emirates",
    ip: "94.203.66.12",
    lastActiveAt: isoAt(6, 10, 22),
    current: false,
    trusted: false,
  },
  {
    id: "session-chrome-linux",
    kind: "browser",
    device: "Chrome · Linux",
    location: "Frankfurt, Germany",
    ip: "45.133.9.204",
    lastActiveAt: isoAt(19, 21, 5),
    current: false,
    trusted: false,
  },
];

/** Newest activity first: the device in use belongs at the top of the list. */
export const readSessions = (): WalletSession[] =>
  [...sessions].sort((first, second) => second.lastActiveAt.localeCompare(first.lastActiveAt));

export const sessionCount = (): number => sessions.length;

/**
 * Drops one device. The current session is deliberately not removable here: signing the wallet out
 * of the device being used is a different action with different consequences.
 */
export const revokeSession = (id: string): void => {
  sessions = sessions.filter((session) => session.id !== id || session.current);
};

/** Ends every other session and reports how many were dropped. */
export const revokeOtherSessions = (): number => {
  const removed = sessions.filter((session) => !session.current).length;
  sessions = sessions.filter((session) => session.current);
  return removed;
};
