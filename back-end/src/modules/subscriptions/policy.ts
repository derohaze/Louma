import type { PublicSubscription, SubscriptionPlan, SubscriptionRecord } from "../../shared/types/subscriptions.js";

export const HISTORY_WINDOW_DAYS = [1, 7, 30, 90, 120] as const;

export function maxHistoryWindowDays(tier: PublicSubscription["tier"]): number {
  return tier === "pro" ? 120 : 30;
}

export function canUseHistoryWindow(tier: PublicSubscription["tier"], days: number): boolean {
  return HISTORY_WINDOW_DAYS.includes(days as (typeof HISTORY_WINDOW_DAYS)[number]) &&
    days <= maxHistoryWindowDays(tier);
}

export function isActiveSubscription(record: SubscriptionRecord | null, now = new Date()): boolean {
  return record !== null && record.status === "active" && record.startsAt <= now &&
    (record.expiresAt === null || record.expiresAt > now);
}

/** Calendar months/years in UTC, clamped to the destination month's last day. */
export function subscriptionExpiry(plan: SubscriptionPlan, start: Date): Date | null {
  if (plan === "lifetime") return null;
  const result = new Date(start);
  const day = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + (plan === "monthly" ? 1 : 12));
  const lastDay = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate();
  result.setUTCDate(Math.min(day, lastDay));
  return result;
}

export function publicSubscription(record: SubscriptionRecord | null, now = new Date()): PublicSubscription {
  if (!record || !isActiveSubscription(record, now)) {
    return { tier: "free", plan: null, startsAt: null, expiresAt: null, serverNow: now.toISOString() };
  }
  return { tier: "pro", plan: record.plan, startsAt: record.startsAt.toISOString(), expiresAt: record.expiresAt?.toISOString() ?? null, serverNow: now.toISOString() };
}
