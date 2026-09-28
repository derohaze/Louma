import { createContext, useContext } from "react";
import type {
  ApiSecurityOverview,
  ApiSession,
  ApiTransaction,
  ApiUser,
  ApiWallet,
} from "@/lib/api";

/**
 * The wallet screens read the API's own shapes: amounts stay decimal strings end to end, and the
 * balance is whatever the ledger-derived `/api/v1/wallet` reports. The values are projections of one
 * shared server-state cache, so a screen change never re-asks the API for data the tab already has.
 *
 * The context, its value type, and the hook live in this module (no components), while the provider
 * that fills it in lives in `components/wallet-provider.tsx`: a file that exports both a component
 * and other values cannot be hot-reloaded on its own.
 */
export type Wallet = ApiWallet;
export type Transaction = ApiTransaction;
export type Session = ApiSession;

export interface WalletContextValue {
  user: ApiUser | null;
  userId: string | null;
  email: string | null;
  wallet: Wallet | null;
  transactions: Transaction[];
  nextCursor: string | null;
  security: ApiSecurityOverview | null;
  loading: boolean;
  error: string;
  refresh: () => Promise<void>;
  /** Called by anything that may have created a notification, so the bell re-reads its own query. */
  refreshNotifications: () => void;
  refreshSecurity: () => Promise<void>;
  loadMore: () => Promise<void>;
  signOut: () => Promise<void>;
}

export const WalletContext = createContext<WalletContextValue | null>(null);

export function useWallet(): WalletContextValue {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("Wallet context missing");
  return ctx;
}
