/**
 * Daily mining quota: 10 hours of actual mining per 24-hour window.
 *
 * The quota is server-side and derived only from persisted sessions plus the
 * server clock. No client timestamp, remaining, or elapsed value is ever read.
 * Stop does not refund: consumed time is `endsAt - startedAt` of every segment
 * in the window (active segments count their elapsed-to-now), so resume only
 * continues from `quota - consumed`.
 *
 * Windows are anchored: the first start opens a 24h window (`accountWindowStart`
 * / `deviceWindowStart` stored on each session). Stop/resume never move the
 * anchor; a start at/after `windowStart + 24h` opens the next window. Account
 * and device windows are independent anchors; a new session is capped to
 * `min(accountRemaining, deviceRemaining, accountWindowRemaining,
 * deviceWindowRemaining)` so it can never cross its window.
 *
 * Device quota is shared by every account mining under the same machine
 * identity (`machineKey ?? device.publicId`). Account quota holds across
 * devices because it sums all of the account's segments in its window.
 */

/** Actual mining allowed per 24h window. */
export const MINING_DAILY_QUOTA_SECONDS = 10 * 60 * 60;
/** Quota window length. Matches `MINING_CYCLE_DURATION_SECONDS` (24h). */
export const MINING_QUOTA_WINDOW_SECONDS = 24 * 60 * 60;
export const MINING_QUOTA_WINDOW_MS = MINING_QUOTA_WINDOW_SECONDS * 1000;

export interface QuotaSessionView {
  startedAt: Date;
  endsAt: Date;
  status?: string | undefined;
  accountWindowStart?: Date | null | undefined;
  deviceQuotaKey?: string | null | undefined;
  deviceWindowStart?: Date | null | undefined;
}

/** Effective account window of a session; legacy rows fall back to `startedAt`. */
export function accountWindowStartOf(session: QuotaSessionView): number {
  const anchor = session.accountWindowStart?.getTime();
  if (typeof anchor === "number" && Number.isFinite(anchor)) return anchor;
  return session.startedAt.getTime();
}

/** Effective device window of a session; legacy rows fall back to `startedAt`. */
export function deviceWindowStartOf(session: QuotaSessionView): number {
  const anchor = session.deviceWindowStart?.getTime();
  if (typeof anchor === "number" && Number.isFinite(anchor)) return anchor;
  return session.startedAt.getTime();
}

/**
 * Actual mining seconds a segment accounts for at `nowMs`.
 *
 * Active segments count `now - startedAt`; closed ones count their final
 * `endsAt - startedAt`. Clamped at zero and to whole seconds so the sum only
 * ever steps forward with the server clock.
 */
export function minedSecondsForSession(session: QuotaSessionView, nowMs: number): number {
  const startMs = session.startedAt.getTime();
  const endMs = Math.min(nowMs, session.endsAt.getTime());
  const elapsedMs = endMs - startMs;
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return 0;
  return Math.floor(elapsedMs / 1000);
}

/**
 * Current account window for a start at `nowMs`.
 *
 * `latestWindowStartMs` is the effective window of the account's newest
 * segment (or null when it never mined). A window that already spans 24h is
 * over: the start opens a fresh one anchored at `nowMs`.
 */
export function currentAccountWindowStart(
  latestWindowStartMs: number | null,
  nowMs: number,
  windowMs: number = MINING_QUOTA_WINDOW_MS,
): { windowStartMs: number; isNewWindow: boolean } {
  if (latestWindowStartMs === null || !Number.isFinite(latestWindowStartMs)) {
    return { windowStartMs: nowMs, isNewWindow: true };
  }
  if (nowMs >= latestWindowStartMs + windowMs) return { windowStartMs: nowMs, isNewWindow: true };
  return { windowStartMs: latestWindowStartMs, isNewWindow: false };
}

/** Same as above, scoped to one device quota key. */
export function currentDeviceWindowStart(
  latestWindowStartMs: number | null,
  nowMs: number,
  windowMs: number = MINING_QUOTA_WINDOW_MS,
): { windowStartMs: number; isNewWindow: boolean } {
  return currentAccountWindowStart(latestWindowStartMs, nowMs, windowMs);
}

/**
 * Consumed seconds inside one account window: every segment whose effective
 * window falls in `[windowStartMs, windowStartMs + windowMs)`.
 * Legacy segments (no stored anchor) join by their `startedAt`, so mining
 * done just before the upgrade still counts against the overlapping window.
 */
export function accountConsumedSeconds(
  sessions: QuotaSessionView[],
  windowStartMs: number,
  nowMs: number,
  windowMs: number = MINING_QUOTA_WINDOW_MS,
): number {
  let total = 0;
  for (const session of sessions) {
    const anchor = accountWindowStartOf(session);
    if (anchor < windowStartMs || anchor >= windowStartMs + windowMs) continue;
    total += minedSecondsForSession(session, nowMs);
  }
  return total;
}

/**
 * Consumed seconds on one device inside its window, across ALL accounts that
 * share the quota key. `sessions` must already be limited to that key.
 */
export function deviceConsumedSeconds(
  sessions: QuotaSessionView[],
  windowStartMs: number,
  nowMs: number,
  windowMs: number = MINING_QUOTA_WINDOW_MS,
): number {
  let total = 0;
  for (const session of sessions) {
    const anchor = deviceWindowStartOf(session);
    if (anchor < windowStartMs || anchor >= windowStartMs + windowMs) continue;
    total += minedSecondsForSession(session, nowMs);
  }
  return total;
}

/** Remaining quota seconds, never negative. */
export function remainingSeconds(consumedSeconds: number, quotaSeconds: number = MINING_DAILY_QUOTA_SECONDS): number {
  return Math.max(0, quotaSeconds - Math.max(0, Math.floor(consumedSeconds)));
}

/** Seconds left before the window itself ends, never negative. */
export function windowRemainingSeconds(windowStartMs: number, nowMs: number, windowMs: number = MINING_QUOTA_WINDOW_MS): number {
  return Math.max(0, Math.floor((windowStartMs + windowMs - nowMs) / 1000));
}

/**
 * New session length: the intersection the spec requires.
 * `min(accountRemaining, deviceRemaining)` additionally capped to both
 * windows so the segment can never spill past a reset.
 */
export function allowedSessionSeconds(input: {
  accountRemainingSeconds: number;
  deviceRemainingSeconds: number | null;
  accountWindowRemainingSeconds: number;
  deviceWindowRemainingSeconds: number | null;
}): number {
  const deviceRemaining = input.deviceRemainingSeconds ?? Number.MAX_SAFE_INTEGER;
  const deviceWindowRemaining = input.deviceWindowRemainingSeconds ?? Number.MAX_SAFE_INTEGER;
  return Math.max(
    0,
    Math.min(
      Math.floor(input.accountRemainingSeconds),
      Math.floor(deviceRemaining),
      Math.floor(input.accountWindowRemainingSeconds),
      Math.floor(deviceWindowRemaining),
    ),
  );
}

/**
 * Canonical device quota subject: the stable machine identity when the client
 * reported enough machine traits, else the resolved cluster id. Two accounts
 * on one machine share the machine key, so they share the quota; two machines
 * never do. A browser-only identity degrades to per-cluster (documented).
 */
export function deviceQuotaKeyFor(machineKey: string | null, devicePublicId: string): string {
  return machineKey ?? devicePublicId;
}
