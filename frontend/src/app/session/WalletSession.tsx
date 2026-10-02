import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
  clearSessionHint,
  hasSessionHint,
  logout as endSession,
  messageForError,
  type ApiSecurityOverview,
} from "@/shared/api";
import { WalletContext, type Transaction } from "@/shared/hooks";
import { useIsomorphicLayoutEffect } from "@/shared/hooks";
import {
  clearWalletSnapshot,
  readWalletSnapshot,
  writeWalletSnapshot,
  type WalletSnapshot,
} from "@/shared/lib/wallet";
import { clearTransferPrefill } from "@/shared/lib/wallet";
import {
  accountFetchers,
  clearAccountCache,
  hasBrowserSession,
  hydrateAccountCache,
  refetchAccount,
  resetSessionCache,
  serverStateFreshness,
  serverStateKeys,
  type AccountProfile,
  type TransactionPage,
} from "@/shared/lib/platform";
import { startNotificationStream, stopNotificationStream } from "@/shared/lib/platform";

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
   * Captured once, before any request can clear it: a visitor whose session the API rejects is sent
   * to log in when this browser has held a session before, and to create an account when it never
   * has. The hint is read at mount because the rejected refresh clears it before the redirect runs.
   */
  const [hadSession] = useState(hasSessionHint);

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

  /**
   * Restores this tab's last snapshot, so a page the tab already visited reopens with its data
   * instead of the skeleton. The account itself is not restored — see `hydrateAccountCache` — so a
   * reload still waits for the session check.
   *
   * The snapshot is applied when the API has confirmed which account is signed in, not on mount.
   * The refresh cookie is shared between tabs, so signing in as somebody else in another tab
   * leaves this one holding a snapshot of the previous account; seeding it before `/me` answered
   * would show that account's history under the new profile and write the mixture back. It cannot
   * be seeded during the first render either: the server answers with the loading state, and a
   * first client render that already held data would be a hydration mismatch. A layout effect runs
   * before the browser paints, so the data is in place for the same frame that opens the gate.
   */
  const snapshotRef = useRef<WalletSnapshot | null | undefined>(undefined);
  const hydratedAccountId = useRef<string | null>(null);
  useIsomorphicLayoutEffect(() => {
    if (snapshotRef.current === undefined) snapshotRef.current = readWalletSnapshot();
    const snapshot = snapshotRef.current;
    const confirmedUserId = profile.data?.user.id ?? null;
    if (!snapshot || !confirmedUserId) return;
    if (hydratedAccountId.current === confirmedUserId) return;
    hydratedAccountId.current = confirmedUserId;
    if (hydrateAccountCache(queryClient, snapshot, confirmedUserId)) return;
    // Written for an account this tab is no longer signed in as, so it is not this session's to show.
    clearWalletSnapshot();
    snapshotRef.current = null;
  }, [queryClient, profile.data]);

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
   * Ends the session on the server, and only then clears this tab. The revocation is what ends the
   * session: the refresh cookie and the server's session record outlive anything this tab does, and
   * the sign-in page sends an already-authenticated visitor straight back to the wallet. Clearing
   * the tab first while still holding a live cookie would tell the customer they are signed out and
   * then bounce them in again.
   *
   * A failed request is not proof that the session survived, and the tab cannot go on showing one
   * account's private data while that is undecided. The snapshot and the realtime channel go, and the
   * account is dropped from the cache and re-read from the API: a revoked session answers 401 to that
   * read, which is the rejection handler below, so the tab ends exactly as if the sign-out had been
   * confirmed — only without a promise the server never made — while a session that merely hit a
   * transport failure is rebuilt. The caller is told the sign-out was not confirmed either way,
   * because this tab is not the authority on it.
   */
  const signOut = useCallback(async () => {
    try {
      await endSession();
    } catch (cause) {
      clearWalletSnapshot();
      clearTransferPrefill();
      stopNotificationStream();
      resetSessionCache(queryClient);
      throw cause;
    }
    clearAccessToken();
    clearSessionHint();
    stopNotificationStream();
    // In-flight reads are cancelled and the wallet screens are unmounted before their cache
    // is dropped: clearing the cache while they are still mounted makes the observers refetch
    // with no token, forcing a doomed refresh against the revoked cookie (a 401 the browser
    // logs even though it is caught).
    await queryClient.cancelQueries();
    try {
      await navigate({ to: "/login", replace: true });
    } finally {
      clearWalletSnapshot();
      // One-shot recipient for the transfer form: it belongs to the session that just ended.
      clearTransferPrefill();
      // The cache is a copy of one account's server state: none of it may survive into the next session
      // this tab starts, and the realtime channel was authorized for the session that just ended.
      clearAccountCache(queryClient);
    }
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
    // Same ordering as signOut: unmount the wallet screens before dropping their cache, so no
    // still-mounted observer refetches with no token and fires a doomed refresh.
    void (async () => {
      clearAccessToken();
      clearSessionHint();
      stopNotificationStream();
      await queryClient.cancelQueries();
      try {
        await navigate({ to: hadSession ? "/login" : "/signup", replace: true });
      } finally {
        clearWalletSnapshot();
        clearTransferPrefill();
        clearAccountCache(queryClient);
      }
    })();
  }, [profile.error, navigate, queryClient, hadSession]);

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
