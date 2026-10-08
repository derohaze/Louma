import type { ApiMiningSession } from "@/shared/api";

export interface MiningPayout {
  sessionId: string;
  amount: string;
  at: string;
}

/** Returns only mining payouts posted inside the selected rolling time window. */
export function miningPayoutsInWindow(
  sessions: readonly ApiMiningSession[],
  from: number,
  to: number,
): MiningPayout[] {
  return sessions.flatMap((session) => {
    const settlements = session.settlements ?? [];
    const payouts =
      settlements.length > 0
        ? settlements
        : session.lastSettledAt
          ? [{ amount: session.settled, at: session.lastSettledAt }]
          : [];
    return payouts
      .filter(({ at }) => {
        const time = new Date(at).getTime();
        return time >= from && time < to;
      })
      .map(({ amount, at }) => ({ sessionId: session.id, amount, at }));
  });
}
