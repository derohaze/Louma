import { useCallback, useEffect, useMemo, useRef, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
  type InfiniteData,
} from "@tanstack/react-query";
import {
  ApiError,
  clearAccessToken,
  logout as endSession,
  messageForError,
  type ApiSecurityOverview,
} from "@/lib/api";
import { WalletContext, type Transaction } from "@/hooks/wallet-context";
import { useIsomorphicLayoutEffect } from "@/hooks/use-isomorphic-layout-effect";
import { clearWalletSnapshot, readWalletSnapshot, writeWalletSnapshot } from "@/lib/wallet-cache";
import {
  accountFetchers,
  clearAccountCache,
  hasBrowserSession,
  hydrateAccountCache,
  refetchAccount,
  serverStateFreshness,
  serverStateKeys,
  type AccountProfile,
  type TransactionPage,
} from "@/lib/server-state";
import { startNotificationStream, stopNotificationStream } from "@/lib/notification-stream";

/**
 * Loads the signed-in account, its wallet, the first page of transactions, and the security overview
 * from the shared cache, and hands them to every wallet page.
 *
 * The provider is mounted by every wallet route, but it no longer owns the data: the cache it reads
 * from is created with the router and lives above the route tree, so arriving on a page re-reads
 * memory. A fetch happens when a freshness window has closed, when a screen explicitly refreshes
 * after changing something, when the realtime channel reports a change, or when the session has to
 * be confirmed — which is the difference between a page change being a UI event and it being a
 * network event.
 */
export function WalletProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  /**
   * Restores this tab's last snapshot before the browser paints, so a page the tab already visited
   * reopens with its data instead of the skeleton. The account itself is not restored — see
   * `hydrateAccountCache` — so a reload still waits for the session check. It cannot seed the cache
   * during the first render: the server answers with the loading state, and a first client render
   * that already held data would be a hydration mismatch. A layout effect keeps that first render
   * identical and still swaps the snapshot in before anything is painted.
   */
  useIsomorphicLayoutEffect(() => {
    const snapshot = readWalletSnapshot();
    if (snapshot) hydrateAccountCache(queryClient, snapshot);
  }, [queryClient]);

  const profile = useQuery<AccountProfile>({
    queryKey: serverStateKeys.profile,
    queryFn: accountFetchers.profile,
    staleTime: serverStateFreshness.profileMs,
    enabled: hasBrowserSession,
  });

  /**
   * Transactions are paged from the same cache, so "load older" appends to a shared list rather than
   * to one screen's copy of it.
   */
  const transactions = useInfiniteQuery<
    TransactionPage,
    Error,
    InfiniteData<TransactionPage, string | null>,
    typeof serverStateKeys.transactions,
    string | null
  >({
    queryKey: serverStateKeys.transactions,
    queryFn: ({ pageParam }) => accountFetchers.transactions(pageParam),
    initialPageParam: null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    staleTime: serverStateFreshness.transactionsMs,
    enabled: hasBrowserSession,
  });

  /**
   * The security overview is read on every wallet page, not only on the security ones: the shell
   * gates transfers on the wallet's frozen state, and the backend refuses them there, so the flag has
   * to be known before a page can offer the action.
   */
  const security = useQuery<ApiSecurityOverview>({
    queryKey: serverStateKeys.security,
    queryFn: accountFetchers.security,
    staleTime: serverStateFreshness.securityMs,
    enabled: hasBrowserSession,
  });

  const user = profile.data?.user ?? null;
  const wallet = profile.data?.wallet ?? null;
  const securityOverview = security.data ?? null;
  const pages = transactions.data?.pages;
  const transactionList = useMemo<Transaction[]>(
    () => (pages ?? []).flatMap((page) => page.transactions),
    [pages],
  );
  const nextCursor = pages?.at(-1)?.nextCursor ?? null;

  /**
   * The screen waits until the API has confirmed this session. The snapshot does not seed the
   * profile, so there is no cached account to render on the strength of a session that may already
   * be gone: a reload rests behind this gate until the server answers. A 401 keeps it closed as
   * well, because the redirect effect below takes over instead of an error page (or a cached
   * wallet) being painted for the moment before that lands. A refresh that fails on top of data
   * already on screen reports itself through the screen's own message, instead of replacing a
   * working wallet with an error page.
   */
  const sessionRejected = profile.error instanceof ApiError && profile.error.status === 401;
  const loading = !profile.data && (profile.isPending || sessionRejected);
  const failure = [profile, transactions, security].find(
    (query) => query.error && !query.data,
  )?.error;
  const error = failure ? messageForError(failure) : "";

  /**
   * Mirrors the confirmed snapshot into the tab cache. The write is silent and best effort: it only
   * ever saves a round trip on the next load, so it must never break the screen producing it.
   */
  useEffect(() => {
    if (!user) return;
    writeWalletSnapshot({
      user,
      wallet,
      transactions: transactionList,
      nextCursor,
      security: securityOverview,
      savedAt: Date.now(),
    });
  }, [user, wallet, transactionList, nextCursor, securityOverview]);

  /**
   * Re-reads the account from the API, including the security overview, because the screens that call
   * it have just changed something the API owns: a transfer moves the balance and records a security
   * event, a freeze changes the wallet status, a profile edit changes the account. It is always an
   * explicit call, never a side effect of mounting a page.
   */
  const refresh = useCallback(
    () =>
      refetchAccount(queryClient, [
        serverStateKeys.profile,
        serverStateKeys.transactions,
        serverStateKeys.security,
      ]),
    [queryClient],
  );

  const refreshSecurity = useCallback(
    () => refetchAccount(queryClient, [serverStateKeys.security]),
    [queryClient],
  );

  /** The bell owns its own query; it is told that a notice appeared instead of being fetched here. */
  const refreshNotifications = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: serverStateKeys.notifications });
  }, [queryClient]);

  const loadMore = useCallback(async () => {
    await transactions.fetchNextPage();
  }, [transactions]);

  /**
   * Ends the session on the server, then clears this tab whatever the reply was. The server revokes
   * the session before it writes its audit record, so a failed or lost response does not prove the
   * session survived — and continuing to show an authenticated wallet on that assumption is the
   * worse mistake. The failure is rethrown after the local state is gone, so the caller can report
   * that the server did not confirm the sign-out, without the wallet staying open.
   */
  const signOut = useCallback(async () => {
    let failure: unknown;
    let failed = false;
    try {
      await endSession();
    } catch (error) {
      failed = true;
      failure = error;
    }
    clearAccessToken();
    clearWalletSnapshot();
    // The cache is a copy of one account's server state: none of it may survive into the next session
    // this tab starts, and the realtime channel was authorized for the session that just ended.
    clearAccountCache(queryClient);
    stopNotificationStream();
    await navigate({ to: "/login", replace: true });
    if (failed) throw failure;
  }, [navigate, queryClient]);

  /**
   * A rejected session is not an error state: the visitor is simply not signed in. This is handled
   * once, here, instead of by every screen that reads the account.
   */
  const handledRejection = useRef(false);
  useEffect(() => {
    if (!profile.error || !(profile.error instanceof ApiError) || profile.error.status !== 401)
      return;
    if (handledRejection.current) return;
    handledRejection.current = true;
    clearAccessToken();
    clearWalletSnapshot();
    clearAccountCache(queryClient);
    stopNotificationStream();
    void navigate({ to: "/login", replace: true });
  }, [profile.error, navigate, queryClient]);

  /**
   * The realtime channel belongs to the session: it opens once the account is known — from the cache
   * or from the API — and stays open across navigation, because it is not owned by this component.
   */
  useEffect(() => {
    if (!user) return;
    startNotificationStream();
  }, [user]);

  const value = useMemo(
    () => ({
      user,
      userId: user?.id ?? null,
      email: user?.email ?? null,
      wallet,
      transactions: transactionList,
      nextCursor,
      security: securityOverview,
      loading,
      error,
      refresh,
      refreshNotifications,
      refreshSecurity,
      loadMore,
      signOut,
    }),
    [
      user,
      wallet,
      transactionList,
      nextCursor,
      securityOverview,
      loading,
      error,
      refresh,
      refreshNotifications,
      refreshSecurity,
      loadMore,
      signOut,
    ],
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}
