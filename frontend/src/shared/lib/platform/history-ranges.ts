export const FREE_HISTORY_DAYS = [1, 7, 30] as const;
export const PRO_HISTORY_DAYS = [1, 7, 30, 90, 120] as const;

export function availableHistoryDays(isPro: boolean): readonly number[] {
  return isPro ? PRO_HISTORY_DAYS : FREE_HISTORY_DAYS;
}

export function maximumHistoryDays(isPro: boolean): number {
  return isPro ? 120 : 30;
}
