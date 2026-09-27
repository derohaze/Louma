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

  const signOut = useCallback(async () => {
    try {
      await endSession();
    } finally {
      clearAccessToken();
      setUser(null);
      setWallet(null);
      setTransactions([]);
      setNextCursor(null);
      setSecurity(null);
      await navigate({ to: "/login", replace: true });
    }
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
