import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  ApiError,
  api,
  clearAccessToken,
  logout as endSession,
  messageForError,
  type ApiSecurityOverview,
  type ApiUser,
} from "@/lib/api";
import { WalletContext, type Transaction, type Wallet } from "@/hooks/wallet-context";
import { useIsomorphicLayoutEffect } from "@/hooks/use-isomorphic-layout-effect";
import { clearWalletSnapshot, readWalletSnapshot, writeWalletSnapshot } from "@/lib/wallet-cache";

const PAGE_SIZE = 20;

interface TransactionPage {
  transactions: Transaction[];
  nextCursor: string | null;
}

/**
 * Loads the signed-in account, its wallet, the first page of transactions, and the security
 * overview from the API, and hands them to every wallet page. The screens never keep their own copy
 * of server state: a reload, a transfer, or a security change goes through `refresh`.
 */
export function WalletProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const [user, setUser] = useState<ApiUser | null>(null);
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [security, setSecurity] = useState<ApiSecurityOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notificationsRevision, setNotificationsRevision] = useState(0);
  /** Guards the bootstrap effect: React runs it twice in development, not once per visit. */
  const bootstrapped = useRef(false);

  /**
   * Restores this tab's last snapshot before the browser paints, so a page that was already visited
   * opens with its data instead of the skeleton. It cannot seed the `useState` calls above: the
   * server answers with the loading state, and a first client render that already held data would
   * be a hydration mismatch. A layout effect keeps that first render identical and still swaps the
   * snapshot in before anything is painted.
   */
  useIsomorphicLayoutEffect(() => {
    const snapshot = readWalletSnapshot();
    if (!snapshot) return;
    setUser(snapshot.user);
    setWallet(snapshot.wallet);
    setTransactions(snapshot.transactions);
    setNextCursor(snapshot.nextCursor);
    setSecurity(snapshot.security);
    setLoading(false);
  }, []);

  /**
   * Mirrors every confirmed snapshot into the tab cache. The effect runs only while a session is
   * held: ending one (sign-out, rejected token) clears the cache explicitly, so this never has to
   * guess whether an empty state means "signed out" or "not loaded yet".
   */
  useEffect(() => {
    if (!user) return;
    writeWalletSnapshot({ user, wallet, transactions, nextCursor, security });
  }, [user, wallet, transactions, nextCursor, security]);

  const refreshSecurity = useCallback(async () => {
    setSecurity(await api.get<ApiSecurityOverview>("/api/v1/security"));
  }, []);

  /** The bell owns its own request, so it is told that something happened instead of being fetched here. */
  const refreshNotifications = useCallback(
    () => setNotificationsRevision((revision) => revision + 1),
    [],
  );

  const refresh = useCallback(async () => {
    const [me, page] = await Promise.all([
      api.get<{ user: ApiUser; wallet: Wallet | null }>("/api/v1/me"),
      api.get<TransactionPage>(`/api/v1/transactions?limit=${PAGE_SIZE}`),
    ]);
    setUser(me.user);
    setWallet(me.wallet);
    setTransactions(page.transactions);
    setNextCursor(page.nextCursor);
    await refreshSecurity();
    setError("");
  }, [refreshSecurity]);

  const loadMore = useCallback(async () => {
    if (!nextCursor) return;
    const page = await api.get<TransactionPage>(
      `/api/v1/transactions?limit=${PAGE_SIZE}&cursor=${encodeURIComponent(nextCursor)}`,
    );
    setTransactions((previous) => [...previous, ...page.transactions]);
    setNextCursor(page.nextCursor);
  }, [nextCursor]);

  /**
   * Ends the session on the server first. Clearing local state after a failed logout would look like
   * a success while the refresh cookie stayed valid — and the sign-in page would then refresh that
   * cookie and send the same person straight back into the wallet — so the failure is handed to the
   * caller to report instead of being swallowed.
   */
  const signOut = useCallback(async () => {
    await endSession();
    clearAccessToken();
    clearWalletSnapshot();
    setUser(null);
    setWallet(null);
    setTransactions([]);
    setNextCursor(null);
    setSecurity(null);
    await navigate({ to: "/login", replace: true });
  }, [navigate]);

  useEffect(() => {
    if (bootstrapped.current) return;
    bootstrapped.current = true;
    void (async () => {
      try {
        await refresh();
      } catch (cause) {
        // A rejected session is not an error state: the visitor is simply not signed in.
        if (cause instanceof ApiError && cause.status === 401) {
          clearAccessToken();
          clearWalletSnapshot();
          await navigate({ to: "/login", replace: true });
          return;
        }
        setError(messageForError(cause));
      } finally {
        setLoading(false);
      }
    })();
  }, [navigate, refresh]);

  const value = useMemo(
    () => ({
      user,
      userId: user?.id ?? null,
      email: user?.email ?? null,
      wallet,
      transactions,
      nextCursor,
      security,
      loading,
      error,
      notificationsRevision,
      refresh,
      refreshNotifications,
      refreshSecurity,
      loadMore,
      signOut,
    }),
    [
      user,
      wallet,
      transactions,
      nextCursor,
      security,
      loading,
      error,
      notificationsRevision,
      refresh,
      refreshNotifications,
      refreshSecurity,
      loadMore,
      signOut,
    ],
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}
