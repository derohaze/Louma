import type { Collections } from "../../infrastructure/mongodb/collections.js";
import {
  MINING_DAILY_QUOTA_SECONDS,
  MINING_QUOTA_WINDOW_MS,
  accountConsumedSeconds,
  accountWindowStartOf,
  currentAccountWindowStart,
  currentDeviceWindowStart,
  deviceConsumedSeconds,
  deviceWindowStartOf,
  remainingSeconds,
  windowRemainingSeconds,
} from "./quota.js";

export interface AccountQuotaState {
  windowStartMs: number;
  isNewWindow: boolean;
  consumedSeconds: number;
  remainingSeconds: number;
  windowRemainingSeconds: number;
}

export interface DeviceQuotaState {
  quotaKey: string;
  windowStartMs: number;
  isNewWindow: boolean;
  consumedSeconds: number;
  remainingSeconds: number;
  windowRemainingSeconds: number;
}

/**
 * Account quota from persisted segments plus the server clock.
 *
 * Window membership is by stored anchor (`accountWindowStart` equality): the
 * anchor never moves on stop/resume, so clock-travelled rows (tests rewind
 * `startedAt`/`endsAt` to simulate elapsed time) still belong to their window.
 * Legacy segments (no stored anchor) join by `startedAt`, so pre-upgrade
 * mining still counts while its 24h overlaps the window.
 */
export async function loadAccountQuota(
  collections: Collections,
  ownerUserId: string,
  nowMs: number,
): Promise<AccountQuotaState> {
  const latest = await collections.miningSessions.findOne(
    { ownerUserId },
    { sort: { createdAt: -1, publicId: -1 }, projection: { startedAt: 1, endsAt: 1, accountWindowStart: 1 } },
  );
  const latestWindowMs = latest ? accountWindowStartOf(latest) : null;
  const current = currentAccountWindowStart(latestWindowMs, nowMs);
  if (current.isNewWindow) {
    return {
      windowStartMs: current.windowStartMs,
      isNewWindow: true,
      consumedSeconds: 0,
      remainingSeconds: MINING_DAILY_QUOTA_SECONDS,
      windowRemainingSeconds: windowRemainingSeconds(current.windowStartMs, nowMs),
    };
  }
  const windowStart = new Date(current.windowStartMs);
  const [anchored, legacy] = await Promise.all([
    collections.miningSessions
      .find(
        { ownerUserId, accountWindowStart: windowStart },
        { projection: { startedAt: 1, endsAt: 1, accountWindowStart: 1 } },
      )
      .toArray(),
    collections.miningSessions
      .find(
        {
          ownerUserId,
          accountWindowStart: { $exists: false },
          startedAt: { $gte: windowStart, $lt: new Date(current.windowStartMs + MINING_QUOTA_WINDOW_MS) },
        },
        { projection: { startedAt: 1, endsAt: 1, accountWindowStart: 1 } },
      )
      .toArray(),
  ]);
  const consumed = accountConsumedSeconds([...anchored, ...legacy], current.windowStartMs, nowMs);
  return {
    windowStartMs: current.windowStartMs,
    isNewWindow: false,
    consumedSeconds: consumed,
    remainingSeconds: remainingSeconds(consumed),
    windowRemainingSeconds: windowRemainingSeconds(current.windowStartMs, nowMs),
  };
}

/**
 * Shared device quota across every account on one machine identity.
 * `sessions` are limited to the quota key; the sum spans owners.
 */
export async function loadDeviceQuota(
  collections: Collections,
  quotaKey: string,
  nowMs: number,
): Promise<DeviceQuotaState> {
  const latest = await collections.miningSessions.findOne(
    { deviceQuotaKey: quotaKey },
    { sort: { startedAt: -1, publicId: -1 }, projection: { startedAt: 1, endsAt: 1, deviceWindowStart: 1, deviceQuotaKey: 1 } },
  );
  const latestWindowMs = latest ? deviceWindowStartOf(latest) : null;
  const current = currentDeviceWindowStart(latestWindowMs, nowMs);
  if (current.isNewWindow) {
    return {
      quotaKey,
      windowStartMs: current.windowStartMs,
      isNewWindow: true,
      consumedSeconds: 0,
      remainingSeconds: MINING_DAILY_QUOTA_SECONDS,
      windowRemainingSeconds: windowRemainingSeconds(current.windowStartMs, nowMs),
    };
  }
  // Anchor equality (see loadAccountQuota): rows written before the quota had
  // no device key at all, so there is no legacy fallback to serve here.
  const windowSessions = await collections.miningSessions
    .find(
      { deviceQuotaKey: quotaKey, deviceWindowStart: new Date(current.windowStartMs) },
      { projection: { startedAt: 1, endsAt: 1, deviceWindowStart: 1, deviceQuotaKey: 1 } },
    )
    .toArray();
  const consumed = deviceConsumedSeconds(windowSessions, current.windowStartMs, nowMs);
  return {
    quotaKey,
    windowStartMs: current.windowStartMs,
    isNewWindow: false,
    consumedSeconds: consumed,
    remainingSeconds: remainingSeconds(consumed),
    windowRemainingSeconds: windowRemainingSeconds(current.windowStartMs, nowMs),
  };
}
