export interface ApiUser {
  id: string;
  email: string;
  displayName: string;
  country: string | null;
  emailVerifiedAt: string | null;
  createdAt: string;
}

export interface ApiWallet {
  id: string;
  address: string;
  status: "active" | "frozen";
  balance: string;
  currency: "LMA";
  createdAt: string;
  customAddressChangedAt: string | null;
  customAddress: string | null;
}

/**
 * One mining cycle as the API reports it. It carries the persisted window and rate plus the live
 * accrual the server computed, and it carries the rate as exact integers as well so the page can
 * advance the counter between responses without the server ever being out of the loop.
 */
export interface ApiMiningSession {
  id: string;
  poolId: string | null;
  status: "active" | "completed" | "settled";
  cycleNumber: number;
  startedAt: string;
  endsAt: string;
  durationSeconds: number;
  rate: string;
  rateUnit: "LMA/hour";
  rateUnits: number;
  rateScale: number;
  serverNow: string;
  elapsedSeconds: number;
  remainingSeconds: number;
  accruedMinor: number;
  accrued: string;
  settledMinor: number;
  settled: string;
  totalAccruedMinor: number;
  totalAccrued: string;
  progress: number;
  canSettle: boolean;
  lastSettledAt: string | null;
  /** Each posted payout of the cycle, oldest first. Present on mining history; may be absent on older payloads. */
  settlements?: { amount: string; at: string }[];
}

export interface ApiMiningState {
  status: "idle" | "active" | "completed" | "settled";
  serverNow: string;
  enabled: boolean;
  canStart: boolean;
  cycleDurationSeconds: number;
  session: ApiMiningSession | null;
  /** Pool the account mines in; null until it joins one (start is refused then). */
  poolId: string | null;
  /** True when the account must join a pool before Start is accepted. */
  poolRequired: boolean;
}

export interface ApiMiningPool {
  id: string;
  name: string;
  riskLevel: "low" | "medium";
  baseHashrate: number;
  activeMiners: number;
  maxMembers: number;
  full: boolean;
  effectivePower: number;
  mySharePercent: number;
  rewardRangeText: string;
  description: string;
  joined: boolean;
}

export interface ApiMiningPoolsState {
  pools: ApiMiningPool[];
  poolId: string | null;
}

export interface ApiTransaction {
  id: string;
  transferId: string;
  direction: "sent" | "received";
  counterpartyAddress: string;
  amount: string;
  fee: string;
  netAmount: string;
  balanceAfter?: string;
  currency: "LMA";
  status: "completed";
  type: "transfer";
  note: string;
  correlationId: string;
  createdAt: string;
  completedAt: string;
}

/**
 * What the staged transfer form needs before it can offer an amount: the resolved recipient, and —
 * once an amount is offered — the tax, the balance, and what the balance becomes, all computed by
 * the same backend arithmetic the transfer itself uses.
 */
export interface ApiTransferPreview {
  recipient: { address: string; displayName: string | null };
  quote: {
    amount: string;
    fee: string;
    netAmount: string;
    balance: string;
    balanceAfter: string;
    sufficient: boolean;
  } | null;
  /**
   * The server's approval of exactly this intent. The transfer consumes it, and the page only
   * carries it: the recipient, amount and fee the transfer executes are the ones inside it, not
   * whatever the form holds by the time the request is sent.
   */
  authorization: {
    id: string;
    expiresAt: string;
    intent: {
      recipientAddress: string;
      amount: string;
      fee: string;
      netAmount: string;
      currency: string;
    };
  } | null;
}

export interface ApiSecurityOverview {
  wallet: { status: "active" | "frozen" };
  twoFactor: { enabled: boolean; enabledAt: string | null; recoveryCodesRemaining: number };
  transferPassword: { enabled: boolean; changedAt: string | null };
  activeSessions: number;
  events: { id: string; type: string; outcome: "success" | "failure"; createdAt: string }[];
}

export interface ApiSession {
  id: string;
  device: string;
  userAgent: string | null;
  current: boolean;
  createdAt: string;
  lastActiveAt: string;
  expiresAt: string;
}

export interface ApiNotification {
  id: string;
  kind: string;
  title: string;
  body: string;
  readAt: string | null;
  createdAt: string;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}
