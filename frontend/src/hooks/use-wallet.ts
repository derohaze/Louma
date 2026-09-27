import { createContext, useContext } from "react";

import type { Transaction, Wallet } from "@/lib/demo-wallet";

export interface WalletContextValue {
  userId: string | null;
  email: string | null;
  wallet: Wallet | null;
  transactions: Transaction[];
  loading: boolean;
  error: string;
  refresh: () => Promise<void>;
}

export const WalletContext = createContext<WalletContextValue | null>(null);

export function useWallet() {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("Wallet context missing");
  return ctx;
}
