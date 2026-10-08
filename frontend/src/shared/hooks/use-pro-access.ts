import { useEffect, useMemo, useState } from "react";
import type { ApiSubscription } from "@/shared/api";
import { useWallet } from "./wallet-context";

const subscriptionDeadlines = new WeakMap<ApiSubscription, number>();

function subscriptionDeadline(subscription: ApiSubscription | undefined) {
  if (!subscription?.expiresAt) return null;
  let deadline = subscriptionDeadlines.get(subscription);
  if (deadline === undefined) {
    deadline = Date.now() + Date.parse(subscription.expiresAt) - Date.parse(subscription.serverNow);
    subscriptionDeadlines.set(subscription, deadline);
  }
  return deadline;
}

/** UI visibility only. Every protected request is authorized independently by MongoDB. */
export function useProAccess(override?: ApiSubscription) {
  const { user } = useWallet();
  const subscription = override ?? user?.subscription;
  // Keep the first local deadline across mounts; cached answers must not restart their duration.
  const expiry = useMemo(() => subscriptionDeadline(subscription), [subscription]);
  const [, updateClock] = useState(0);
  useEffect(() => {
    const refresh = () => updateClock((value) => value + 1);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      if (expiry === null || !Number.isFinite(expiry)) return;
      const remaining = expiry - Date.now();
      if (remaining <= 0) {
        refresh();
        return;
      }
      timer = setTimeout(
        () => {
          refresh();
          schedule();
        },
        Math.min(remaining, 86400000),
      );
    };
    schedule();
    window.addEventListener("focus", refresh);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("focus", refresh);
    };
  }, [expiry]);
  return subscription?.tier === "pro" && (expiry === null || expiry > Date.now());
}
