import { MONEY_SCALE } from "@/shared/lib/wallet";
import type { ApiMiningQuota, ApiMiningSession } from "@/shared/api";

const SECONDS_PER_HOUR = 3600n;

/**
 * The live numbers the page paints between server reads.
 *
 * This mirrors the server's arithmetic exactly — the same integer rate, the same floored elapsed
 * seconds, the same floor division — but it is a *renderer*, not a source of truth: the authoritative
 * numbers arrive with every state read, the clock is offset by the server's own answer, and nothing
 * computed here is ever sent back as an amount. A tampered tab can therefore drag its own display
 * around and change nothing about what the account earns.
 */
export function liveSnapshot(session: ApiMiningSession, serverNowMs: number) {
  const startedAtMs = new Date(session.startedAt).getTime();
  const endsAtMs = new Date(session.endsAt).getTime();
  const effectiveNow = Math.min(serverNowMs, endsAtMs);
  const elapsedSeconds = Math.max(
    0,
    Math.min(Math.floor((effectiveNow - startedAtMs) / 1000), session.durationSeconds),
  );
  const accruedMinor = Number(
    (BigInt(session.rateUnits) * BigInt(MONEY_SCALE) * BigInt(elapsedSeconds)) /
      (BigInt(session.rateScale) * SECONDS_PER_HOUR),
  );
  return {
    elapsedSeconds,
    remainingSeconds: Math.max(0, session.durationSeconds - elapsedSeconds),
    accruedMinor,
    completed: serverNowMs >= endsAtMs,
  };
}

export type LiveSnapshot = ReturnType<typeof liveSnapshot>;

/**
 * The limiting account/device window's numbers, advanced locally between server reads.
 *
 * `quota.consumedSeconds` is the server's accumulated sum for that window, so it already contains
 * every earlier segment of the limiting account or device. The only local
 * addition is the growth of the *running* segment since that read, measured on the same live
 * snapshot the cycle countdown uses: a stopped account's window stops counting, and a reopened page
 * continues the same total instead of restarting from zero.
 */
export function windowSnapshot(
  quota: ApiMiningQuota,
  live: { elapsedSeconds: number } | null,
  sessionElapsedSeconds: number,
) {
  const runningGrowth = live ? Math.max(0, live.elapsedSeconds - sessionElapsedSeconds) : 0;
  const minedSeconds = Math.max(
    0,
    Math.min(quota.dailyQuotaSeconds, quota.consumedSeconds + runningGrowth),
  );
  const remainingSeconds = Math.max(0, quota.dailyQuotaSeconds - minedSeconds);
  return {
    minedSeconds,
    remainingSeconds,
    dailyQuotaSeconds: quota.dailyQuotaSeconds,
    windowEndsAt: quota.windowEndsAt,
    progressPercent:
      quota.dailyQuotaSeconds > 0
        ? Math.min(100, (minedSeconds / quota.dailyQuotaSeconds) * 100)
        : 0,
  };
}

export type WindowSnapshot = ReturnType<typeof windowSnapshot>;

export function countdown(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map((part) => String(part).padStart(2, "0")).join(":");
}

/**
 * Resolves after the browser has painted the latest commit. The checking card
 * (and its freshly mounted orb) must land its first frames before the
 * device-evidence collectors contend the main thread — otherwise the swap
 * visibly hitches. Falls back after ~300ms: a background tab pauses animation
 * frames, and the start request must not wait behind an unsent paint.
 */
export function nextPaint(): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (!done) {
        done = true;
        resolve();
      }
    };
    requestAnimationFrame(() => requestAnimationFrame(finish));
    setTimeout(finish, 300);
  });
}
