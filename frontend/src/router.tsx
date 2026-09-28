import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import { shouldRetryRequest } from "./lib/server-state";

export const getRouter = () => {
  /**
   * One cache for the whole tab, created with the router and therefore above every route: a page
   * change re-reads it instead of re-asking the API.
   *
   * The defaults are the policy for that cache. A window that regains focus no longer triggers a
   * reload — every wallet route mounts its own provider, and a focus-based refetch meant four
   * endpoints were re-read whenever the customer clicked back into the tab. Freshness comes from the
   * realtime channel and from the per-query windows instead, and a reconnect re-reads once. The entry
   * is kept long enough to outlive a normal session of clicking around.
   */
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        refetchOnWindowFocus: false,
        refetchOnReconnect: true,
        retry: shouldRetryRequest,
        gcTime: 30 * 60 * 1000,
      },
    },
  });

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
  });

  return router;
};
