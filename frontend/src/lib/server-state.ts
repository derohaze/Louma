import type { InfiniteData, QueryClient } from "@tanstack/react-query";
import {
  ApiError,
  api,
  type ApiMiningSession,
  type ApiMiningState,
  type ApiNotification,
  type ApiSecurityOverview,
  type ApiSession,
  type ApiTransaction,
  type ApiUser,
  type ApiWallet,
} from "@/lib/api";
import type { WalletSnapshot } from "@/lib/wallet-cache";

/**
 * The one cache every wallet screen reads its server state from.
 *
 * The wallet used to keep a copy of the account, the first page of transactions, and the security
 * overview inside a provider that every route mounts itself. That made a page change a data-loading
 * event: the provider was destroyed and rebuilt on every navigation, and its bootstrap asked the API
 * for all three again. Here the cache lives above the route tree (it is created with the router and
 * provided at the root), so a route change re-reads memory, and the network is asked again only when
 * a window below has closed or when something actually changed.
 *
 * Nothing here is authoritative. Every value is a copy of an API answer with a freshness window
 * attached, and the window is the whole policy: short enough that a screen is never meaningfully out
 * of date, long enough that clicking around the wallet costs nothing.
 */

/**
 * True in the browser, false during the server render.
 *
 * Every query here is session-scoped: the server has no session to read and the API would answer
 * 401, so the queries are gated on this. It also keeps the first client render identical to the
 * server's — both see a gate that is closed on the server and no data yet on the client — which is
 * what makes the wallet's skeleton hydrate without a mismatch.
 */
export const hasBrowserSession = typeof window !== "undefined";

/** One page of transactions, exactly as the API answers it. */
export interface TransactionPage {
  transactions: ApiTransaction[];
  nextCursor: string | null;
}

/** One page of notifications plus the account-wide unread count that page reports. */
export interface NotificationPage {
  notifications: ApiNotification[];
  unread: number;
  nextCursor: string | null;
}

/** One page of mining cycles, newest first, exactly as the API answers it. */
export interface MiningHistoryPage {
  sessions: ApiMiningSession[];
  nextCursor: string | null;
}

/** `/api/v1/me`: the account and the wallet the ledger currently reports for it. */
export interface AccountProfile {
  user: ApiUser;
  wallet: ApiWallet | null;
}

/**
 * How many rows one page holds. Part of the cache key, because a page size is not a detail of the
 * request — a different page size is a different list, and mixing the two in one entry would hand a
 * screen a page it did not ask for.
 */
export const ACCOUNT_PAGE_SIZE = 20;
export const NOTIFICATION_PAGE_SIZE = 20;

export const serverStateKeys = {
  /** Every account object shares this prefix, so a session boundary drops them in one call. */
  account: ["account"] as const,
  profile: ["account", "profile"] as const,
  transactions: ["account", "transactions", ACCOUNT_PAGE_SIZE] as const,
  security: ["account", "security"] as const,
  mining: ["account", "mining"] as const,
  miningHistory: ["account", "mining", "history"] as const,
  sessions: ["account", "sessions"] as const,
  notifications: ["notifications", NOTIFICATION_PAGE_SIZE] as const,
};

export const serverStateFreshness = {
  profileMs: 60_000,
  transactionsMs: 30_000,
  securityMs: 60_000,
  /**
   * Short, because mining state is live: the page renders between reads from the last authoritative
   * answer, and this window is how long that answer may be reused before the server is asked again.
   */
  miningMs: 15_000,
  /** Cycle history changes at most once a day; a longer window keeps paging cheap. */
  miningHistoryMs: 60_000,
  /** The device list and the session count on the security overview are the same fact, read twice. */
  sessionsMs: 60_000,
  notificationsMs: 30_000,
} as const;

export const accountFetchers = {
  profile: () => api.get<AccountProfile>("/api/v1/me"),
  security: () => api.get<ApiSecurityOverview>("/api/v1/security"),
  mining: () => api.get<ApiMiningState>("/api/v1/mining/state"),
  miningHistory: (cursor: string | null) =>
    api.get<MiningHistoryPage>(
      `/api/v1/mining/history?limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
    ),
  sessions: () => api.get<{ sessions: ApiSession[] }>("/api/v1/sessions"),
  transactions: (cursor: string | null) =>
    api.get<TransactionPage>(
      `/api/v1/transactions?limit=${ACCOUNT_PAGE_SIZE}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
    ),
  notifications: (cursor: string | null) =>
    api.get<NotificationPage>(
      `/api/v1/notifications?limit=${NOTIFICATION_PAGE_SIZE}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
    ),
};

/**
 * A rejection the API actually decided on is an answer, not a hiccup: only a server fault or a
 * transport failure is worth another attempt. Retrying a 401 would also fight the token refresh the
 * API layer performs once per request, and retrying a 429 would deepen the limit it just hit.
 */
export function shouldRetryRequest(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError && error.status < 500) return false;
  return failureCount < 2;
}

/**
 * Re-reads the given queries, at most once each, and rejects if any of them failed.
 *
 * `cancelRefetch: false` is what makes overlapping callers safe: screens that refresh several keys
 * at once — `Promise.all([refresh(), refreshSecurity()])` — share the fetch already in flight
 * instead of cancelling it and paying for a second request for the same data.
 *
 * `throwOnError` is what makes the returned promise mean something. `refetchQueries` swallows a
 * failed fetch by default and resolves anyway, so a screen that awaits this after changing
 * something would report success while still showing the balance, profile, or freeze state the API
 * just replaced. Callers that do not await it own their own reporting.
 */
export function refetchAccount(
  queryClient: QueryClient,
  keys: readonly (readonly unknown[])[],
): Promise<void> {
  return Promise.all(
    keys.map((queryKey) =>
      queryClient.refetchQueries({ queryKey }, { cancelRefetch: false, throwOnError: true }),
    ),
  ).then(() => undefined);
}

/**
 * Seeds the list caches from this tab's last snapshot, once the API has confirmed which account is
 * signed in. Returns whether the snapshot belonged to that account.
 *
 * The account itself is deliberately not seeded. The profile is the record that decides whether a
 * session is still signed in, and a cached copy — `setQueryData` marks a query successful — would
 * let a wallet page render private data on the strength of a session the API may already have
 * revoked. Leaving it to the API keeps the page gated until the server answers for this load, while
 * the snapshot still removes the wait for the transaction and security panels once it has.
 *
 * `accountUserId` is required for that reason as much as the gate is: the refresh cookie is shared
 * between tabs, so signing in as another account elsewhere leaves this tab holding a snapshot that
 * describes somebody else. Seeding it would show one account's history under another's profile and
 * then write the mixture back as this tab's snapshot. The caller drops a snapshot that fails here.
 *
 * The snapshot's age is carried into the cache rather than reset, so an old payload is displayed and
 * immediately re-asked for instead of being trusted for a freshness window it never earned. A
 * snapshot written by an earlier release has no age at all, which reads as perfectly stale.
 *
 * A key the cache already holds a newer answer for is left alone: the screens that read these keys
 * fetch as soon as they mount, so the transactions and the security overview can answer before
 * `/me` does — the profile gate deliberately waits for the server — and seeding over them would
 * rewind the page somebody is already reading. See `seedUnlessNewer`.
 */
export function hydrateAccountCache(
  queryClient: QueryClient,
  snapshot: WalletSnapshot,
  accountUserId: string,
): boolean {
  if (snapshot.user.id !== accountUserId) return false;
  const { savedAt: updatedAt } = snapshot;
  seedUnlessNewer(
    queryClient,
    serverStateKeys.transactions,
    {
      pages: [
        {
          transactions: snapshot.transactions,
          nextCursor: snapshot.nextCursor,
        } satisfies TransactionPage,
      ],
      pageParams: [null],
    } satisfies InfiniteData<TransactionPage, string | null>,
    updatedAt,
  );
  if (snapshot.security) {
    seedUnlessNewer(queryClient, serverStateKeys.security, snapshot.security, updatedAt);
  }
  return true;
}

/**
 * Writes one cache entry from the snapshot unless the cache already holds a newer answer.
 *
 * A mounted screen fetches as soon as it renders, so the answer for the transactions and for the
 * security overview can arrive before `/me` does. Seeding those keys afterwards would replace the
 * fresher answer with the snapshot's older copy, and nothing would ask again for a while: a hidden
 * tab does not refetch on focus, so the customer would read the older list until an explicit refresh
 * or a reconnect. An entry the cache knows nothing about (`dataUpdatedAt` 0), or one holding data no
 * newer than the snapshot, is still seeded — the tab cache is mirrored after every change, so the
 * copy it holds is never newer than the data it was written from.
 */
function seedUnlessNewer<TData>(
  queryClient: QueryClient,
  queryKey: readonly unknown[],
  data: TData,
  updatedAt: number,
): void {
  const cached = queryClient.getQueryState(queryKey);
  if (cached && cached.dataUpdatedAt > updatedAt) return;
  queryClient.setQueryData(queryKey, data, { updatedAt });
}

/**
 * Drops every session-scoped object from the cache and re-reads the ones that are mounted.
 *
 * This is for a sign-out the API did not confirm. The server revokes the session and then answers,
 * so a lost reply leaves the revocation unknown and neither outcome may be assumed. A reset takes the
 * data off the screens that are rendering it, which a removal does not: the mounted query keeps
 * holding its last result. The refetch that follows then asks the API which session is actually
 * live — a revoked one answers 401, which is the rejection path that ends the tab, while a session
 * that merely hit a transport failure is rebuilt. The account prefix and the notification list are
 * both session-scoped: the bell holds one account's private notices just as the wallet holds its
 * private transactions.
 */
export function resetSessionCache(queryClient: QueryClient): void {
  void queryClient.resetQueries({ queryKey: serverStateKeys.account });
  void queryClient.resetQueries({ queryKey: serverStateKeys.notifications });
}

/**
 * Drops every cached account object. Called at a session boundary — sign-out, or a session the API
 * rejected — so one account can never read another account's wallet out of the cache, and so a
 * sign-in always starts from the API rather than from whatever the tab was holding.
 */
export function clearAccountCache(queryClient: QueryClient): void {
  queryClient.clear();
}
