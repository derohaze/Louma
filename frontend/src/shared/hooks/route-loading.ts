import { createContext, useContext, useId } from "react";
import { useIsomorphicLayoutEffect } from "./use-isomorphic-layout-effect";

export interface RouteLoadingContextValue {
  pathname: string;
  report: (pathname: string, id: string, pending: boolean) => void;
}

export const RouteLoadingContext = createContext<RouteLoadingContextValue | null>(null);

export function useRouteLoadingStatus(key: string, pending: boolean) {
  const context = useContext(RouteLoadingContext);
  const instanceId = useId();

  useIsomorphicLayoutEffect(() => {
    if (!context) return;
    context.report(context.pathname, `${key}:${instanceId}`, pending);
    return () => context.report(context.pathname, `${key}:${instanceId}`, false);
  }, [context, instanceId, key, pending]);
}
