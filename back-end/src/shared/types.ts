import type { ObjectId } from "mongodb";

export const CURRENCY = "LMA";
export const MONEY_DECIMALS = 4;
export const MONEY_SCALE = 10_000;
/**
 * The largest amount a single transfer may carry, in minor units.
 *
 * There is no longer a product ceiling here: a wallet must be able to move any amount it can hold,
 * so the only bound left is the one the arithmetic itself imposes. Money is an exact integer of
 * minor units, and a JavaScript number — and therefore a BSON number — represents every integer up
 * to 2^53 exactly.
 *
 * This is the largest whole amount below that boundary. Stopping at a whole amount leaves slack for
 * the fee's rounding step (it adds half a minor unit before dividing), so every intermediate the
 * money arithmetic produces — the fee, the recipient's net, each ledger line — stays an exact
 * integer rather than relying on a rounding that is itself unrepresentable.
 */
export const MAX_TRANSFER_MINOR = Math.floor(Number.MAX_SAFE_INTEGER / MONEY_SCALE) * MONEY_SCALE;
export const MIN_TRANSFER_MINOR = 1;
export const FEE_PERCENT = 1;
export const MAX_NOTE_LENGTH = 240;
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
export const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const PENDING_2FA_TTL_MS = 5 * 60 * 1000;

export type AccountStatus = "active" | "suspended";
export type WalletStatus = "active" | "frozen";
export type SessionStatus = "active" | "pending_two_factor" | "revoked";
export type LedgerSide = "debit" | "credit";
export type TransactionDirection = "sent" | "received";
/**
 * Offline (non-customer) ledger account types. None of them is owned by a wallet, none is reachable
 * through a customer endpoint, and no public API can post to them: they exist so every LMA in the
 * system has a ledger home — revenue taken in, and currency issued from a controlled source.
 */
export type SystemAccountType = "fee_revenue" | "system_treasury";

/**
 * The largest amount a single ledger line may carry, in minor units. It equals the maximum transfer
 * amount — the largest movement the product can produce — so every financial document (account
 * projection, ledger entry, transaction amount) is bounded by it, which keeps every persisted money
 * integer inside the safe-integer range no matter how many operations land.
 */
export const LEDGER_AMOUNT_MAX_MINOR = MAX_TRANSFER_MINOR;

/**
 * The largest value an account projection may hold, in minor units. Unlike a single ledger line
 * (bounded by `LEDGER_AMOUNT_MAX_MINOR`, the largest movement the product can produce), a projection
 * accumulates every movement that lands on the account, so it is bounded by the exact-integer range
 * instead: a wallet or the fee account must not hit a ceiling just because it has been used a lot.
 */
export const LEDGER_BALANCE_MAX_MINOR = Number.MAX_SAFE_INTEGER;

/**
 * Where an account signed up from: the connecting address, captured with the account, plus whatever
 * the ipinfo.io lookup reports for it moments later. The country a person *chooses* is a different
 * field (`profile.country`), because a chosen country and an observed country are not the same fact.
 */
export interface SignupLocation {
  ipAddress: string;
  city: string | null;
  region: string | null;
  country: string | null;
  org: string | null;
  timezone: string | null;
  capturedAt: Date;
  /** Null until the background lookup has run; it stays null when the lookup is disabled. */
  resolvedAt: Date | null;
}

export interface UserRecord {
  _id: ObjectId;
  publicId: string;
  email: string;
  passwordHash: string;
  profile: { displayName: string; country: string | null };
  signupLocation: SignupLocation | null;
  status: AccountStatus;
  emailVerifiedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface WalletRecord {
  _id: ObjectId;
  publicId: string;
  address: string;
  addressNormalized: string;
  ownerUserId: string;
  status: WalletStatus;
  /**
   * Write-conflict guard for wallet-affecting financial operations, not a balance: a transfer
   * increments it inside its transaction and refuses to commit when the increment did not land,
   * which makes a freeze that races a transfer serialize against it. It carries no money meaning —
   * balances live on the ledger account and are explained by the ledger entries.
   */
  financialVersion: number;
  createdAt: Date;
  updatedAt: Date;
  customAddressChangedAt: Date | null;
  customAddress: string | null;
  customAddressNormalized: string | null;
}

export interface LedgerAccountRecord {
  _id: ObjectId;
  publicId: string;
  /** Null for offline accounts (fee revenue, treasury), which belong to no wallet. */
  walletId: string | null;
  accountType: "wallet" | SystemAccountType;
  currency: typeof CURRENCY;
  /**
   * Concurrency-safe projection of the account's ledger-derived balance, kept in the same
   * transaction as the entries that produce it. The ledger entries remain authoritative: a
   * reconciler can always recompute this number from them alone. Never negative for any account
   * type — issuance credits the user side and debits the treasury side, it never overdraws it.
   */
  balanceMinor: number;
  createdAt: Date;
}

export interface LedgerEntryRecord {
  _id: ObjectId;
  publicId: string;
  transactionId: string;
  lineNumber: number;
  walletId: string | null;
  ledgerAccountId: string;
  side: LedgerSide;
  amountMinor: number;
  currency: typeof CURRENCY;
  correlationId: string;
  createdAt: Date;
}

export interface ReconciliationIssue {
  kind: "projection_mismatch" | "negative_balance" | "unbalanced_transaction" | "empty_transaction" | "orphan_entry" | "duplicate_transaction" | "currency_mismatch" | "invalid_reference";
  severity: "error" | "critical";
  detail: string;
}

export interface TransactionRecord {
  _id: ObjectId;
  publicId: string;
  /** The customer-facing movement identifier; the API also accepts it for lookups. */
  transferId: string;
  senderUserId: string;
  receiverUserId: string;
  senderWalletId: string;
  receiverWalletId: string;
  /**
   * The account ids on both sides, in the order the history index reads them. The wallet asks for
   * one account's history as a single page across both directions, and a list of the participants
   * answers that from one index instead of an `$or` over two whose halves have to be sorted together.
   */
  participants: string[];
  senderAddress: string;
  receiverAddress: string;
  amountMinor: number;
  feeMinor: number;
  netAmountMinor: number;
  currency: typeof CURRENCY;
  /** Completed-at-write today; the state machine has room for pending states if async flows come. */
  status: "completed";
  type: "transfer";
  note: string;
  idempotencyKey: string;
  requestFingerprint: string;
  correlationId: string;
  balanceAfterMinor: number;
  createdAt: Date;
  completedAt: Date;
}

export interface SessionRecord {
  _id: ObjectId;
  publicId: string;
  ownerUserId: string;
  refreshTokenHash: string | null;
  previousRefreshTokenHash: string | null;
  status: SessionStatus;
  twoFactorAttempts: number;
  userAgent: string | null;
  createdAt: Date;
  lastActiveAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
}

export interface SecurityEventRecord {
  _id: ObjectId;
  publicId: string;
  ownerUserId: string | null;
  sessionId: string | null;
  eventType: string;
  outcome: "success" | "failure";
  metadata: Record<string, string | number | boolean | null>;
  correlationId: string;
  createdAt: Date;
}

export interface TwoFactorCredentialRecord {
  _id: ObjectId;
  ownerUserId: string;
  encryptedSecret: string;
  secretIv: string;
  secretAuthTag: string;
  pendingExpiresAt: Date | null;
  enabledAt: Date | null;
  recoveryCodeHashes: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface TransferPasswordCredentialRecord {
  _id: ObjectId;
  ownerUserId: string;
  passwordHash: string;
  changedAt: Date;
}

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
  /** Exactly `startedAt + durationSeconds`, fixed at creation and never extended. */
  endsAt: Date;
  durationSeconds: number;
  /** The drawn rate as an exact integer count of `1 / rateScale` LMA per hour. */
  rateUnits: number;
  rateScale: number;
  rateDecimals: number;
  /** `rateUnits / rateScale` rendered once, for display; the integers above stay the source of truth. */
  rate: string;
  rateUnit: "LMA/hour";
  /** Total already posted to the ledger, in minor units. Never exceeds the 24-hour accrual. */
  settledMinor: number;
  /** How many settlements this cycle has posted; the sequence number of the next one. */
  settlementSequence: number;
  lastSettledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * The journal header of one mining settlement, so a reward's ledger lines resolve to a transaction
 * the way every other financial movement in this codebase does.
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

/** The `transactions` row a mining settlement writes: an issuance, not a transfer. */
export interface MiningJournalRecord {
  _id: ObjectId;
  publicId: string;
  type: "mining";
  currency: typeof CURRENCY;
  status: "completed";
  ownerUserId: string;
  walletId: string;
  miningSessionId: string;
  sequenceNumber: number;
  amountMinor: number;
  treasuryAccountId: string;
  correlationId: string;
  idempotencyKey: string;
  createdAt: Date;
  completedAt: Date;
}

/** A mining cycle as the customer-facing API reports it, with the live accrual already computed. */
export interface PublicMiningSession {
  id: string;
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
}

export interface PublicMiningState {
  status: MiningEffectiveStatus;
  serverNow: string;
  enabled: boolean;
  canStart: boolean;
  cycleDurationSeconds: number;
  session: PublicMiningSession | null;
}

/**
 * Louma Mining Device Guard (LMDG): server-side device identity for the mining feature.
 *
 * Honest scope: this is multi-signal correlation + proof-of-possession, not a cryptographically
 * guaranteed physical-machine identity. A browser cannot provide that across profiles/VMs/private
 * windows, and FingerprintJS output is spoofable evidence — never the decision by itself.
 */
export type MiningDeviceStatus = "active" | "quarantined" | "blocked";

/**
 * Learned, bounded feature history for one device: per feature key, the last few keyed digests
 * (most recent last) plus how often it was observed.
 *
 * Values are keyed digests, never raw fingerprint data, and the ring is bounded (see
 * MAX_FEATURE_VALUES in mining-device/identity.ts) so a hostile client cannot grow the document.
 * Keeping a small history is what lets a device with one drifting field (a browser update, a driver
 * update) still compare as the same machine instead of forking into a new identity.
 */
export interface MiningDeviceFeatureProfile {
  [featureKey: string]: {
    digests: string[];
    count: number;
    /**
     * Bounded log of digests this observation stream contradicted the ring with, not yet seen
     * often enough consecutively to be trusted. Evidence, never identity: a contradictory value
     * does not enter `digests` until it repeats (see learnFeatureProfileChecked).
     */
    drift?: string[];
  };
}

/**
 * Server-owned trust state of one device cluster. Distinct from `status`, which is the operator's
 * enforcement flag: an `active` device can still be `provisional` (not yet worth trusting).
 *
 *   - `provisional` — enrolled from an observation, not yet corroborated by independent evidence.
 *   - `established` — corroborated across admissions (and/or a bound proof): trusted for merging.
 *   - `suspicious`  — repeated contradictions / churn findings; stricter risk, never silently trusted.
 *   - `blocked`     — terminal (mirrors `status`).
 */
export type MiningDeviceTrustState = "provisional" | "established" | "suspicious" | "blocked";

export interface MiningDeviceRecord {
  _id: ObjectId;
  publicId: string;
  /**
   * HMAC(secret, browser public key) when a key is registered, else HMAC(secret, signature).
   * Identifies the *browser*: it changes with a profile, a private window or cleared storage.
   */
  deviceKeyHash: string;
  /**
   * HMAC over the engine-stable machine traits only (CPU and touch class, audio device, display
   * gamut and HDR capability, panel colour depth — see CORE_MACHINE_FEATURES). Identifies the
   * *computer and its operating system*: two browsers on one machine produce the same value, and a
   * user-agent change or a new browser profile does not move it. It is what a mining lease is taken
   * on. Null when the client reported too few machine traits for the key to mean anything.
   */
  machineKeyHash: string | null;
  browserKeyPublicKey: string | null;
  fingerprintVisitorIdHash: string | null;
  fingerprintVersion: string | null;
  fingerprintConfidence: number | null;
  normalizedSignalHash: string | null;
  osFamily: string | null;
  browserFamily: string | null;
  platform: string | null;
  screenClass: string | null;
  timezone: string | null;
  languageClass: string | null;
  webglFingerprintHash: string | null;
  hardwareConcurrencyBucket: number | null;
  deviceMemoryBucket: number | null;
  /** Latest normalized observation, mirroring the columns above, as one comparable snapshot. */
  featureSnapshot: Record<string, string> | null;
  /** Learned digest history per feature; the correlation primitive. Null on records from before it existed. */
  featureProfile: MiningDeviceFeatureProfile | null;
  /** The same history, restricted to the machine traits that form `machineKeyHash`. */
  machineFeatureProfile: MiningDeviceFeatureProfile | null;
  firstSeenAt: Date;
  lastSeenAt: Date;
  lastIpHash: string | null;
  lastAsn: string | null;
  lastCountry: string | null;
  status: MiningDeviceStatus;
  /**
   * Server-owned trust state. Optional so device rows written before this model existed stay
   * readable; readers default a missing value to `provisional`, never to `established`.
   */
  trustState?: MiningDeviceTrustState;
  /**
   * The immutable machine anchor recorded at enrollment: the keyed digest over the machine core the
   * server derived when it created this cluster. It is NEVER rewritten from a later observation —
   * a device that reports different traits is either the same cluster (accepted through the
   * append-only alias list) or a different observation, never an identity rewrite.
   */
  anchorHash?: string | null;
  /**
   * Append-only machine-key aliases the server accepted for this cluster (a browser/driver update
   * that moved a core trait, or a tolerant cross-engine match). Bounded; only appended on an
   * allowed admission, never by a rejected request.
   */
  aliasHashes?: string[];
  /** The account whose start enrolled this cluster. Evidence for abuse budgets, not ownership. */
  enrollmentUserId?: string | null;
  /** Allowed admissions folded into this cluster (a start that passed admission, not a rejected try). */
  admissionCount?: number;
  /** Verified single-use proof-of-possession handshakes bound to this cluster. */
  proofCount?: number;
  /** When the cluster became `established`; null while provisional. */
  establishedAt?: Date | null;
  /** Bounded counter of consistency/drift findings; feeds the risk engine, never a verdict alone. */
  findingCount?: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * One enrollment-rate counter bucket.
 *
 * `_id` is `${scope}:${window}:${bucketStartMs}`, so the `$inc` upsert that consumes a unit is a
 * single atomic document write — the rate limit is enforced by MongoDB, not by a read-then-write in
 * the application. `expiresAt` is a TTL index: buckets are evidence with a short life, not history.
 */
export interface MiningDeviceQuotaRecord {
  _id: string;
  scope: "account" | "network";
  windowMs: number;
  bucketStart: Date;
  count: number;
  expiresAt: Date;
}

export type MiningDeviceLeaseStatus = "active" | "released";

/**
 * One mining-cycle device lease. Validity is derived from the clock
 * (`serverNow < leaseEndsAt`): no timers, no jobs. An expired row is simply not active.
 */
export interface MiningDeviceLeaseRecord {
  _id: ObjectId;
  publicId: string;
  deviceClusterId: string;
  /** The device record (its `publicId`) this lease was taken for — survives a later key change. */
  deviceId: string | null;
  ownerUserId: string;
  miningSessionId: string;
  leasedAt: Date;
  leaseEndsAt: Date;
  status: MiningDeviceLeaseStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface MiningDeviceNonceRecord {
  _id: ObjectId;
  publicId: string;
  ownerUserId: string;
  deviceKeyHash: string | null;
  /**
   * Server-resolved device binding recorded when the challenge is issued: the machine anchor the
   * evidence describes and (when it resolves to one) the enrolled cluster. The signed payload
   * commits to the anchor, and a proof can only be spent on the enrollment it was issued for.
   */
  boundAnchorHash?: string | null;
  boundClusterId?: string | null;
  nonce: string;
  issuedAt: Date;
  expiresAt: Date;
  consumedAt: Date | null;
  /** Public browser key proven through this nonce, set when the proof is consumed. */
  verifiedBrowserKey?: string | null;
}

export interface MiningDeviceObservationRecord {
  _id: ObjectId;
  deviceId: string;
  ownerUserId: string;
  observedAt: Date;
  ipHash: string | null;
  asn: string | null;
  country: string | null;
  riskScore: number;
  decision: string;
}

export interface NotificationRecord {
  _id: ObjectId;
  ownerUserId: string;
  kind: string;
  title: string;
  body: string;
  readAt: Date | null;
  createdAt: Date;
}

export interface PublicUser {
  id: string;
  email: string;
  displayName: string;
  country: string | null;
  emailVerifiedAt: string | null;
  createdAt: string;
}

export interface PublicWallet {
  id: string;
  address: string;
  status: WalletStatus;
  balance: string;
  currency: typeof CURRENCY;
  createdAt: string;
  customAddressChangedAt: string | null;
  customAddress: string | null;
}

export interface PublicTransaction {
  id: string;
  transferId: string;
  direction: TransactionDirection;
  counterpartyAddress: string;
  amount: string;
  fee: string;
  netAmount: string;
  balanceAfter?: string;
  currency: typeof CURRENCY;
  status: "completed";
  type: "transfer";
  note: string;
  correlationId: string;
  createdAt: string;
  completedAt: string;
}
