import type { Database } from "@/integrations/supabase/types";
import { CURRENCY } from "@/lib/wallet-format";

/**
 * The wallet UI is being built before the backend and auth exist, so every wallet
 * read and write goes through this in-memory store. Replace the calls below with
 * the real API layer once the backend is ready.
 */
export type Wallet = Database["public"]["Tables"]["wallets"]["Row"];
export type Transaction = Database["public"]["Tables"]["wallet_transactions"]["Row"];

export const DEMO_USER_ID = "demo-user";
export const DEMO_USER_EMAIL = "demo@louma.local";

const isoAt = (daysAgo: number, hour: number, minute = 0) => {
  const date = new Date();
  date.setHours(hour, minute, 0, 0);
  date.setDate(date.getDate() - daysAgo);
  return date.toISOString();
};

const wallet: Wallet = {
  user_id: DEMO_USER_ID,
  address: "LMA-4H8Q-2M7T-9K3D",
  balance: 2480.75,
  // Still a column on the wallets table, but no screen reads it: the wallet has no account tiers.
  is_premium: true,
  privacy_mode: false,
  backup_confirmed: true,
  custom_address_changed_at: null,
  created_at: isoAt(180, 9),
  updated_at: isoAt(0, 8),
};

interface TransferSeed {
  daysAgo: number;
  hour: number;
  direction: "sent" | "received";
  counterpartyAddress: string;
  amount: number;
  note: string;
  rating: number | null;
}

const seedTransfers: TransferSeed[] = [
  {
    daysAgo: 6,
    hour: 10,
    direction: "received",
    counterpartyAddress: "LMA-7K2M-5P9R-1X4B",
    amount: 320.5,
    note: "Payout",
    rating: null,
  },
  {
    daysAgo: 6,
    hour: 16,
    direction: "sent",
    counterpartyAddress: "@nour_store",
    amount: 45.25,
    note: "Order #4821",
    rating: 5,
  },
  {
    daysAgo: 5,
    hour: 9,
    direction: "sent",
    counterpartyAddress: "LMA-3D8F-6N1Q-0Z7C",
    amount: 128,
    note: "Design work",
    rating: 4,
  },
  {
    daysAgo: 5,
    hour: 20,
    direction: "received",
    counterpartyAddress: "@layla_codes",
    amount: 76.4,
    note: "Refund",
    rating: null,
  },
  {
    daysAgo: 4,
    hour: 12,
    direction: "sent",
    counterpartyAddress: "LMA-9V4S-2B7H-5T1L",
    amount: 210.9,
    note: "Hosting share",
    rating: 5,
  },
  {
    daysAgo: 4,
    hour: 21,
    direction: "received",
    counterpartyAddress: "LMA-1Q6N-8R3W-4Y9K",
    amount: 540,
    note: "Client payment",
    rating: null,
  },
  {
    daysAgo: 3,
    hour: 11,
    direction: "sent",
    counterpartyAddress: "@omar_dev",
    amount: 64.75,
    note: "API credits",
    rating: 4,
  },
  {
    daysAgo: 3,
    hour: 18,
    direction: "received",
    counterpartyAddress: "@sara_media",
    amount: 132.25,
    note: "Invoice 1042",
    rating: null,
  },
  {
    daysAgo: 2,
    hour: 14,
    direction: "sent",
    counterpartyAddress: "LMA-5H1T-7C3M-9A6P",
    amount: 87.6,
    note: "Equipment",
    rating: 3,
  },
  {
    daysAgo: 1,
    hour: 10,
    direction: "received",
    counterpartyAddress: "@karim_lma",
    amount: 415.8,
    note: "Monthly retainer",
    rating: null,
  },
  {
    daysAgo: 1,
    hour: 19,
    direction: "sent",
    counterpartyAddress: "@hala_studio",
    amount: 52.3,
    note: "Print order",
    rating: 5,
  },
  {
    daysAgo: 0,
    hour: 9,
    direction: "sent",
    counterpartyAddress: "LMA-2B9E-4F6J-8L0N",
    amount: 96.15,
    note: "Team split",
    rating: 4,
  },
];

let transferSequence = seedTransfers.length;

const nextTransferId = () => `LMA-TRF-${String(++transferSequence).padStart(4, "0")}`;

const transactions: Transaction[] = seedTransfers.map((seed, index) => {
  const createdAt = isoAt(seed.daysAgo, seed.hour);
  return {
    id: `demo-tx-${index + 1}`,
    owner_id: DEMO_USER_ID,
    transfer_id: nextTransferId(),
    direction: seed.direction,
    counterparty_address: seed.counterpartyAddress,
    amount: seed.amount,
    note: seed.note,
    recipient_rating: seed.rating,
    created_at: createdAt,
    updated_at: createdAt,
  };
});

export const readWallet = (): Wallet => wallet;

export const readTransactions = (): Transaction[] =>
  [...transactions].sort((first, second) => second.created_at.localeCompare(first.created_at));

export const sendDemoTransfer = (input: {
  recipientAddress: string;
  amount: number;
  note: string;
}): string => {
  const now = new Date().toISOString();
  const transferId = nextTransferId();
  transactions.push({
    id: `demo-tx-${transactions.length + 1}`,
    owner_id: DEMO_USER_ID,
    transfer_id: transferId,
    direction: "sent",
    counterparty_address: input.recipientAddress,
    amount: input.amount,
    note: input.note,
    recipient_rating: null,
    created_at: now,
    updated_at: now,
  });
  wallet.balance = Number((wallet.balance - input.amount).toFixed(2));
  wallet.updated_at = now;
  return transferId;
};

/** The handle of a public profile: `@nour_store` belongs to the profile `nour_store`. */
export const handleOf = (address: string): string | null =>
  address.startsWith("@") ? address.slice(1) : null;

export interface AddressLookup {
  status: "own" | "known" | "unknown" | "invalid";
  /** Shown next to the input: who the address belongs to, or why it was rejected. */
  detail: string;
}

const WALLET_ADDRESS_PATTERN = /^LMA(-[A-Z0-9]{4}){3}$/;
const HANDLE_PATTERN = /^@[a-z0-9_]{4,24}$/;

/**
 * The wallets this account has already transacted with, which is what makes an address "known"
 * while the address-book endpoint does not exist. A brand new address is still allowed: the form
 * only asks for one extra confirmation instead of pretending it can verify the network.
 */
const addressDirectory = (): Map<string, string> => {
  const owned = new Map<string, string>();
  for (const transaction of transactions) {
    const handle = handleOf(transaction.counterparty_address);
    owned.set(transaction.counterparty_address, handle ? `@${handle}` : "a wallet address");
  }
  return owned;
};

export const lookupAddress = (value: string): AddressLookup => {
  const address = value.trim();
  if (!address) return { status: "invalid", detail: "Enter a wallet address or a @handle." };
  if (!WALLET_ADDRESS_PATTERN.test(address) && !HANDLE_PATTERN.test(address)) {
    return { status: "invalid", detail: `Use @handle or ${CURRENCY}-XXXX-XXXX-XXXX.` };
  }
  if (address === wallet.address) return { status: "own", detail: "This is your own address." };
  const known = addressDirectory().get(address);
  return known
    ? { status: "known", detail: `In your address book: ${known}.` }
    : { status: "unknown", detail: "This address has never transacted with your wallet." };
};

/** The demo store has no status column, so a transfer from today counts as still confirming. */
export const transactionStatus = (transaction: Transaction): "Confirming" | "Final" =>
  new Date(transaction.created_at).toDateString() === new Date().toDateString()
    ? "Confirming"
    : "Final";

export const findTransaction = (transferId: string): Transaction | undefined =>
  transactions.find((transaction) => transaction.transfer_id === transferId);

/** Records the recipient rating, which is the only rating field the transactions table owns. */
export const setTransferRating = (transferId: string, stars: number): void => {
  const transaction = findTransaction(transferId);
  if (!transaction) return;
  transaction.recipient_rating = stars > 0 ? stars : null;
  transaction.updated_at = new Date().toISOString();
};

export const setDemoCustomAddress = (newAddress: string): void => {
  const now = new Date().toISOString();
  wallet.address = newAddress;
  wallet.custom_address_changed_at = now;
  wallet.updated_at = now;
};

export const updateDemoWallet = (
  preferences: Partial<Pick<Wallet, "privacy_mode" | "backup_confirmed">>,
): void => {
  Object.assign(wallet, preferences);
  wallet.updated_at = new Date().toISOString();
};
