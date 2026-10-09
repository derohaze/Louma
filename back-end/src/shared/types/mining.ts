import type { ObjectId } from "mongodb";

/**
 * Lifecycle of a persisted mining cycle. The stored status only ever says whether the cycle is
 * still open or has been closed and fully settled; whether an open cycle has run out of time is a
 * property of the clock, computed on read (`MiningEffectiveStatus`), so expiry never requires a
 * scheduled write.
 */
export type MiningSessionStatus = "active" | "settled";
/** What the customer sees: idle with no cycle, running, out of time, or closed and fully settled. */
export type MiningEffectiveStatus = "idle" | "active" | "completed" | "settled";

/**
 * One mining cycle. The rate and the window are fixed at creation and never rewritten: every reward
 * number the API ever returns is recomputed from these fields, so a cycle is reproducible from the
 * record alone and no random seed is kept in memory.
 */
export interface MiningSessionRecord {
  _id: ObjectId;
  publicId: string;
  ownerUserId: string;
  walletId: string;
  ledgerAccountId: string;
  status: MiningSessionStatus;
  cycleNumber: number;
  startedAt: Date;
  /** Exactly `startedAt + durationSeconds`, fixed at creation and never extended (stop truncates both together). */
  endsAt: Date;
  durationSeconds: number;
  /**
   * Anchor of the 10h/24h account quota window this segment belongs to.
   * The first start anchors a fresh 24h window; stop/resume never move it.
   * Missing on rows written before the quota (treated as `startedAt`).
   */
  accountWindowStart?: Date | null;
  /**
   * Canonical device quota subject: the resolved cluster's stable machine anchor, else the
   * cluster id (see `deviceQuotaKeyFor`). Null when no device identity was available — with
   * the admission guard switched off and no machine traits in the evidence.
   */
  deviceQuotaKey?: string | null;
  /** Anchor of the shared 10h/24h device window; null when no device was bound. */
  deviceWindowStart?: Date | null;
  /** Resolved device cluster (`publicId`); null when no device was bound. */
  deviceId?: string | null;
  /** The drawn rate as an exact integer count of `1 / rateScale` LMA per hour. */
  rateUnits: number;
  rateScale: number;
  rateDecimals: number;
  /** `rateUnits / rateScale` rendered once, for display; the integers above stay the source of truth. */
  rate: string;
  rateUnit: "LMA/hour";
  /** Pool the cycle started in (null for cycles opened before pools existed). */
  poolId?: string | null;
  /** Total already posted to the ledger, in minor units. Never exceeds the 24-hour accrual. */
  settledMinor: number;
  /** How many settlements this cycle has posted; the sequence number of the next one. */
  settlementSequence: number;
  lastSettledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

import type { MiningTransactionRecord } from "./wallet-ledger.js";

/**
 * @deprecated The pre-merge settlement document. `mining_settlements` is no longer written: the
 * authoritative financial record of a mining reward is the `MiningTransactionRecord` header in
 * `transactions` (see ADR-003). This type survives only for the one-way migration that copies
 * legacy settlement rows into the journal; do not use it in new code.
 */
export interface MiningSettlementRecord {
  _id: ObjectId;
  /** Doubles as the ledger `transactionId` of the settlement's two lines. */
  publicId: string;
  ownerUserId: string;
  walletId: string;
  sessionPublicId: string;
  sequenceNumber: number;
  amountMinor: number;
  treasuryAccountId: string;
  walletAccountId: string;
  correlationId: string;
  idempotencyKey: string;
  createdAt: Date;
}

/**
 * The `transactions` row a mining settlement writes: an issuance, not a transfer.
 * Canonical shape lives in wallet-ledger.ts (`MiningTransactionRecord`); this alias keeps the
 * mining module's existing imports working.
 */
export type MiningJournalRecord = MiningTransactionRecord;

/** A mining cycle as the customer-facing API reports it, with the live accrual already computed. */
export interface PublicMiningSession {
  id: string;
  poolId: string | null;
  status: MiningEffectiveStatus;
  cycleNumber: number;
  startedAt: string;
  endsAt: string;
  durationSeconds: number;
  rate: string;
  rateUnit: "LMA/hour";
  /** Rates as exact integers, so the renderer can extend the accrual without a second guess. */
  rateUnits: number;
  rateScale: number;
  serverNow: string;
  elapsedSeconds: number;
  remainingSeconds: number;
  accruedMinor: number;
  accrued: string;
  settledMinor: number;
  settled: string;
  /** The most this cycle can ever pay, i.e. the 24-hour accrual. */
  totalAccruedMinor: number;
  totalAccrued: string;
  progress: number;
  canSettle: boolean;
  lastSettledAt: string | null;
  /**
   * Each posted payout of this cycle, oldest first. A cycle can pay out more than once (a settle
   * during the window, then the close-out), so a dashboard places each amount on the day it landed
   * instead of booking the whole cumulative `settled` total at `lastSettledAt`, which would move a
   * payout earned before a selected range into that range. Empty when the cycle has never settled.
   */
  settlements: { amount: string; at: string }[];
}

export interface MiningQuotaView {
  /** Actual mining allowed per window (10h). */
  dailyQuotaSeconds: number;
  /** Window length (24h). */
  windowSeconds: number;
  /** Consumption of the limiting account/device allowance in its current window. */
  consumedSeconds: number;
  /** `dailyQuotaSeconds - consumedSeconds`, never negative. */
  remainingSeconds: number;
  /** End of the limiting account/device window (anchor + 24h). Null when never mined. */
  windowEndsAt: string | null;
}

export interface PublicMiningState {
  status: MiningEffectiveStatus;
  serverNow: string;
  enabled: boolean;
  canStart: boolean;
  cycleDurationSeconds: number;
  session: PublicMiningSession | null;
  /** Pool the account mines in; null until it joins one (start is refused then). */
  poolId: string | null;
  /** True when the account must join a pool before Start is accepted. */
  poolRequired: boolean;
  /** Server-computed 10h/24h account quota; never taken from the client. */
  quota: MiningQuotaView;
}
