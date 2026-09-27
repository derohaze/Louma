import { readMining } from "@/lib/demo-mining";
import { readProfile } from "@/lib/demo-profile";
import { readSettings } from "@/lib/demo-settings";
import {
  findTransaction,
  handleOf,
  readTransactions,
  readWallet,
  setTransferRating,
} from "@/lib/demo-wallet";

/**
 * Ratings and public profiles are what the wallet shows about its owner to other wallets.
 *
 * The wallet UI exists before the ratings API does, so this store holds three things: what the owner
 * publishes (settings), the ratings other wallets left (deterministic demo data plus the ratings
 * this account leaves on its own transfers), and the public view of a handle. The public view is
 * derived from the wallet, mining, and settings stores so it can never disagree with what the rest
 * of the app shows — and it applies the owner's settings, so the preview is what visitors see.
 */
export interface RatingsSettings {
  /** Other wallets may leave a rating after a transfer with this account. */
  allowIncoming: boolean;
  /** The average score is published. */
  showAverage: boolean;
  /** Written feedback is published next to the score. */
  showNotes: boolean;
  /** Balance, transfer count, and mining totals are published. */
  showActivity: boolean;
}

export interface Rating {
  id: string;
  /** Handle of the wallet that left the rating, without the `@`. */
  from: string;
  /** Headline of that wallet, so a visitor knows who rated. */
  fromHeadline: string;
  stars: number;
  note: string;
  at: string;
}

export interface GivenRating {
  transferId: string;
  /** Address or handle the rating was left for, as the transaction recorded it. */
  to: string;
  stars: number;
  note: string;
  at: string;
}

export interface PublicProfile {
  handle: string;
  displayName: string;
  headline: string;
  countryCode: string;
  joinedAt: string;
  /** True for the signed-in wallet, so the page can label it as your own public view. */
  own: boolean;
  transfers: number;
  miningEarnings: number;
  balance: number;
  ratings: Rating[];
  /** What the wallet publishes; a visitor never sees a field that is switched off. */
  visibility: { average: boolean; notes: boolean; activity: boolean };
}

const state: RatingsSettings = {
  allowIncoming: true,
  showAverage: true,
  showNotes: true,
  showActivity: false,
};

export const readRatingsSettings = (): RatingsSettings => ({ ...state });

export const updateRatingsSettings = (changes: Partial<RatingsSettings>): void => {
  Object.assign(state, changes);
};

const isoAt = (daysAgo: number, hour: number, minute = 0): string => {
  const date = new Date();
  date.setHours(hour, minute, 0, 0);
  date.setDate(date.getDate() - daysAgo);
  return date.toISOString();
};

/** Ratings other wallets left on this account. Fixed demo data, dated relative to today. */
const receivedRatings: Rating[] = [
  {
    id: "rating-1",
    from: "karim_lma",
    fromHeadline: "Infrastructure partner",
    stars: 5,
    note: "Always settles on time, and the transfer notes made reconciliation easy.",
    at: isoAt(1, 20, 15),
  },
  {
    id: "rating-2",
    from: "sara_media",
    fromHeadline: "Content studio",
    stars: 4,
    note: "Clear notes on every invoice. One transfer arrived a few hours late.",
    at: isoAt(3, 18, 40),
  },
  {
    id: "rating-3",
    from: "omar_dev",
    fromHeadline: "API tooling",
    stars: 5,
    note: "Quick and easy to work with.",
    at: isoAt(8, 12, 5),
  },
  {
    id: "rating-4",
    from: "nour_store",
    fromHeadline: "Hardware supplier",
    stars: 5,
    note: "Paid the same day the order shipped.",
    at: isoAt(14, 9, 25),
  },
];

/** Ratings other wallets left on this account, newest first. */
export const readReceivedRatings = (): Rating[] => [...receivedRatings];

interface ProfileSeed {
  displayName: string;
  headline: string;
  countryCode: string;
  joinedAt: string;
  transfers: number;
  miningEarnings: number;
  balance: number;
  ratings: Rating[];
}

/** The other wallets a transaction can point at, keyed by handle. */
const profileSeeds: Record<string, ProfileSeed> = {
  nour_store: {
    displayName: "Nour Store",
    headline: "Hardware supplier",
    countryCode: "EG",
    joinedAt: isoAt(420, 10),
    transfers: 486,
    miningEarnings: 0,
    balance: 9740.6,
    ratings: [
      {
        id: "nour-1",
        from: "hazem",
        fromHeadline: "Wallet owner",
        stars: 5,
        note: "Ships fast and answers the same day.",
        at: isoAt(6, 16, 20),
      },
      {
        id: "nour-2",
        from: "omar_dev",
        fromHeadline: "API tooling",
        stars: 4,
        note: "Good stock, invoices take a while.",
        at: isoAt(21, 11, 10),
      },
    ],
  },
  layla_codes: {
    displayName: "Layla Codes",
    headline: "Backend engineer",
    countryCode: "AE",
    joinedAt: isoAt(300, 12),
    transfers: 264,
    miningEarnings: 0,
    balance: 4310.45,
    ratings: [
      {
        id: "layla-1",
        from: "hazem",
        fromHeadline: "Wallet owner",
        stars: 5,
        note: "Refunded an overpayment without being asked.",
        at: isoAt(5, 20, 20),
      },
    ],
  },
  omar_dev: {
    displayName: "Omar",
    headline: "API tooling",
    countryCode: "DE",
    joinedAt: isoAt(260, 9),
    transfers: 173,
    miningEarnings: 0,
    balance: 1980.2,
    ratings: [
      {
        id: "omar-1",
        from: "hazem",
        fromHeadline: "Wallet owner",
        stars: 4,
        note: "Credits arrived as agreed, documentation is thin.",
        at: isoAt(3, 11, 15),
      },
      {
        id: "omar-2",
        from: "sara_media",
        fromHeadline: "Content studio",
        stars: 5,
        note: "Reliable for small API top-ups.",
        at: isoAt(30, 14, 5),
      },
    ],
  },
  sara_media: {
    displayName: "Sara Media",
    headline: "Content studio",
    countryCode: "SA",
    joinedAt: isoAt(500, 8),
    transfers: 358,
    miningEarnings: 0,
    balance: 6490.25,
    ratings: [
      {
        id: "sara-1",
        from: "hazem",
        fromHeadline: "Wallet owner",
        stars: 4,
        note: "Invoices are precise, payments sometimes wait for approval.",
        at: isoAt(3, 18, 45),
      },
    ],
  },
  karim_lma: {
    displayName: "Karim",
    headline: "Infrastructure partner",
    countryCode: "EG",
    joinedAt: isoAt(620, 11),
    transfers: 812,
    miningEarnings: 9240.5,
    balance: 18420.4,
    ratings: [
      {
        id: "karim-1",
        from: "hazem",
        fromHeadline: "Wallet owner",
        stars: 5,
        note: "Ran our hosting share for a year without a single miss.",
        at: isoAt(1, 10, 5),
      },
      {
        id: "karim-2",
        from: "nour_store",
        fromHeadline: "Hardware supplier",
        stars: 5,
        note: "Pays the same day, every month.",
        at: isoAt(40, 9, 30),
      },
    ],
  },
  hala_studio: {
    displayName: "Hala Studio",
    headline: "Print and branding",
    countryCode: "EG",
    joinedAt: isoAt(210, 13),
    transfers: 96,
    miningEarnings: 310.8,
    balance: 1240.6,
    ratings: [
      {
        id: "hala-1",
        from: "hazem",
        fromHeadline: "Wallet owner",
        stars: 5,
        note: "Print quality matches the samples exactly.",
        at: isoAt(1, 19, 10),
      },
    ],
  },
  dinar_capital: {
    displayName: "Dinar Capital",
    headline: "Treasury desk",
    countryCode: "AE",
    joinedAt: isoAt(700, 10),
    transfers: 640,
    miningEarnings: 4180.2,
    balance: 15280.15,
    ratings: [
      {
        id: "dinar-1",
        from: "karim_lma",
        fromHeadline: "Infrastructure partner",
        stars: 5,
        note: "Settles large transfers without delays.",
        at: isoAt(12, 15, 40),
      },
    ],
  },
};

/** The public handle of the signed-in wallet: the display name, lower case, e.g. "Hazem" → hazem. */
export const ownHandle = (): string => {
  const cleaned = readProfile()
    .displayName.toLowerCase()
    .replace(/[^a-z0-9_]/g, "");
  return cleaned || "louma_wallet";
};

/** What a visitor sees on the signed-in wallet's public profile, after its settings are applied. */
const ownPublicProfile = (): PublicProfile => {
  const profile = readProfile();
  const wallet = readWallet();
  const visibleActivity = state.showActivity && !readSettings().hideRanking;
  return {
    handle: ownHandle(),
    displayName: profile.displayName,
    headline: "Louma wallet member",
    countryCode: profile.country,
    joinedAt: profile.createdAt,
    own: true,
    transfers: visibleActivity ? readTransactions().length : 0,
    miningEarnings: visibleActivity ? readMining().lifetimeEarnings : 0,
    balance: visibleActivity && !wallet.privacy_mode ? wallet.balance : 0,
    ratings: state.allowIncoming ? receivedRatings : [],
    visibility: {
      average: state.showAverage,
      notes: state.showNotes,
      activity: visibleActivity,
    },
  };
};

const publicProfiles = (): Record<string, PublicProfile> =>
  Object.fromEntries(
    Object.entries(profileSeeds).map(([handle, seed]) => [
      handle,
      {
        handle,
        ...seed,
        // Ratings left from this wallet appear on the profile straight away.
        ratings: [...(liveRatings.get(handle) ?? []), ...seed.ratings],
        own: false,
        visibility: { average: true, notes: true, activity: true },
      },
    ]),
  );

/** Every handle that has a public profile, including this wallet's own. */
export const publicHandles = (): string[] => [...Object.keys(profileSeeds), ownHandle()];

/** Resolves `@handle`, `handle`, or an LMA address to the profile a visitor would open. */
export const publicProfile = (target: string): PublicProfile | null => {
  const handle = handleOf(target) ?? target.trim().replace(/^@/, "").toLowerCase();
  if (!handle) return null;
  if (handle === ownHandle() || target.trim() === readWallet().address) return ownPublicProfile();
  return publicProfiles()[handle] ?? null;
};

/** Notes this account wrote on its own transfers; the stars live on the transaction row itself. */
const ratingNotes = new Map<string, string>();

/** Ratings left in this session, per handle, merged into that wallet's public profile. */
const liveRatings = new Map<string, Rating[]>();

export const readGivenRatings = (): GivenRating[] =>
  readTransactions()
    .filter(
      (transaction) => transaction.direction === "sent" && (transaction.recipient_rating ?? 0) > 0,
    )
    .map((transaction) => ({
      transferId: transaction.transfer_id,
      to: transaction.counterparty_address,
      stars: transaction.recipient_rating ?? 0,
      note: ratingNotes.get(transaction.transfer_id) ?? "",
      at: transaction.updated_at,
    }))
    .sort((first, second) => second.at.localeCompare(first.at));

/**
 * Rates a counterparty after a transfer. The stars go on the transaction row (the only rating field
 * the transactions table owns) and the optional note stays beside it here.
 */
export const rateTransfer = (transferId: string, stars: number, note: string): void => {
  setTransferRating(transferId, stars);
  if (note.trim()) ratingNotes.set(transferId, note.trim());
  else ratingNotes.delete(transferId);
  const transaction = findTransaction(transferId);
  const handle = transaction ? handleOf(transaction.counterparty_address) : null;
  if (!handle) return;
  const others = (liveRatings.get(handle) ?? []).filter((rating) => rating.id !== transferId);
  if (stars === 0) {
    liveRatings.set(handle, others);
    return;
  }
  liveRatings.set(handle, [
    {
      id: transferId,
      from: ownHandle(),
      fromHeadline: "Louma wallet member",
      stars,
      note: note.trim(),
      at: new Date().toISOString(),
    },
    ...others,
  ]);
};

export interface RatingSummary {
  /** Mean of the scores, or null while nothing has been rated. */
  average: number | null;
  count: number;
  /** How many ratings gave 5, 4, 3, 2, and 1 stars, in that order. */
  distribution: number[];
}

export const ratingSummary = (ratings: Rating[]): RatingSummary => ({
  average: ratings.length
    ? Number(
        (ratings.reduce((total, rating) => total + rating.stars, 0) / ratings.length).toFixed(1),
      )
    : null,
  count: ratings.length,
  distribution: [5, 4, 3, 2, 1].map(
    (stars) => ratings.filter((rating) => rating.stars === stars).length,
  ),
});
