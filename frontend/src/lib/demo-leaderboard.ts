import { readTransactions, readWallet } from "@/lib/demo-wallet";
import { readMining } from "@/lib/demo-mining";

/**
 * Stand-in rankings until the leaderboard endpoint exists. The other wallets are fixed demo data,
 * while the signed-in wallet's row is derived from the wallet and mining stores so the ranking can
 * never disagree with the balance shown everywhere else in the app.
 */
export type LeaderboardSort = "balance" | "transactions" | "mining";

export interface LeaderboardEntry {
  id: string;
  address: string;
  balance: number;
  transactions: number;
  /** LMA earned by mining, used as a secondary ranking. */
  miningEarnings: number;
  /** Balance change over the last 7 days, in percent. */
  change: number;
  miner: boolean;
  /** True for the signed-in demo wallet, so the table can highlight it. */
  isYou: boolean;
}

export interface RankedEntry extends LeaderboardEntry {
  rank: number;
}

export const leaderboardSorts: readonly { id: LeaderboardSort; label: string }[] = [
  { id: "balance", label: "Balance" },
  { id: "transactions", label: "Transactions" },
  { id: "mining", label: "Mining" },
];

const demoEntries: Omit<LeaderboardEntry, "isYou">[] = [
  {
    id: "lma-01",
    address: "LMA-9V4S-2B7H-5T1L",
    balance: 18420.4,
    transactions: 812,
    miningEarnings: 9240.5,
    change: 6.4,
    miner: true,
  },
  {
    id: "lma-02",
    address: "@dinar_capital",
    balance: 15280.15,
    transactions: 640,
    miningEarnings: 4180.2,
    change: 2.1,
    miner: false,
  },
  {
    id: "lma-03",
    address: "LMA-1Q6N-8R3W-4Y9K",
    balance: 12960.8,
    transactions: 731,
    miningEarnings: 11250.75,
    change: 9.8,
    miner: true,
  },
  {
    id: "lma-04",
    address: "@nour_store",
    balance: 9740.6,
    transactions: 486,
    miningEarnings: 0,
    change: -1.2,
    miner: false,
  },
  {
    id: "lma-05",
    address: "LMA-3D8F-6N1Q-0Z7C",
    balance: 8215.3,
    transactions: 402,
    miningEarnings: 2140.4,
    change: 3.6,
    miner: true,
  },
  {
    id: "lma-06",
    address: "@sara_media",
    balance: 6490.25,
    transactions: 358,
    miningEarnings: 0,
    change: 0.8,
    miner: false,
  },
  {
    id: "lma-07",
    address: "LMA-5H1T-7C3M-9A6P",
    balance: 5120.9,
    transactions: 297,
    miningEarnings: 640.1,
    change: -2.4,
    miner: true,
  },
  {
    id: "lma-08",
    address: "@layla_codes",
    balance: 4310.45,
    transactions: 264,
    miningEarnings: 0,
    change: 1.9,
    miner: false,
  },
  {
    id: "lma-09",
    address: "LMA-2B9E-4F6J-8L0N",
    balance: 3280.7,
    transactions: 219,
    miningEarnings: 1280.35,
    change: 4.2,
    miner: true,
  },
  {
    id: "lma-10",
    address: "@omar_dev",
    balance: 1980.2,
    transactions: 173,
    miningEarnings: 0,
    change: -0.6,
    miner: false,
  },
  {
    id: "lma-11",
    address: "LMA-7K2M-5P9R-1X4B",
    balance: 1240.6,
    transactions: 96,
    miningEarnings: 310.8,
    change: 0.4,
    miner: false,
  },
];

export const readLeaderboard = (): LeaderboardEntry[] => {
  const wallet = readWallet();
  const mine = readMining();
  return [
    ...demoEntries.map((entry) => ({ ...entry, isYou: false })),
    {
      id: "you",
      address: wallet.address,
      balance: wallet.balance,
      transactions: readTransactions().length,
      miningEarnings: mine.lifetimeEarnings,
      change: 1.4,
      miner: mine.lifetimeEarnings > 0,
      isYou: true,
    },
  ];
};

const sortValue = (entry: LeaderboardEntry, sort: LeaderboardSort): number => {
  switch (sort) {
    case "balance":
      return entry.balance;
    case "transactions":
      return entry.transactions;
    case "mining":
      return entry.miningEarnings;
  }
};

/**
 * Ranks by the selected metric. Ranks are assigned before any row is hidden, so hiding a wallet in
 * Privacy never renumbers the wallets below it.
 */
export const rankLeaderboard = (
  entries: LeaderboardEntry[],
  sort: LeaderboardSort,
): RankedEntry[] =>
  [...entries]
    .sort((first, second) => sortValue(second, sort) - sortValue(first, sort))
    .map((entry, index) => ({ ...entry, rank: index + 1 }));
