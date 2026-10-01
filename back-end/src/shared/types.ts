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
/**
 * How long a server-issued transfer authorization stays usable, in milliseconds.
 *
 * Ten minutes is the window between the sender seeing the quote the server computed (recipient,
 * amount, fee, net) and proving a transfer credential over it. It is long enough for a slow
 * authenticator entry and short enough that an authorization left behind on a shared device is not
 * a standing licence to move that amount later. Validity is enforced by the conditional consume in
 * the transfer's own transaction, never by a timer.
 */
export const TRANSFER_AUTHORIZATION_TTL_MS = 10 * 60 * 1000;
/**
 * How long a consumed or expired transfer authorization is kept for audit, in milliseconds.
 *
 * The row is the only record tying a factor proof to the exact intent it authorised, so it outlives
 * its own validity by a month: an incident review can still answer "what did this approval cover?"
 * long after the transfer settled. Short enough that the collection stays proportional to a month of
 * quoting rather than growing for the life of the deployment.
 */
export const TRANSFER_AUTHORIZATION_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
/**
 * The RFC 6238 time step, in seconds. It is what a consumed authenticator code is recorded against:
 * one accepted step authorises exactly one financial operation, no matter how many requests race.
 */
export const TOTP_PERIOD_SECONDS = 30;
/**
 * How long a consumed authenticator step is remembered, in milliseconds.
 *
 * Only replay inside the accepted window matters for correctness — the row is inserted in the same
 * transaction as the money it authorised — so the record is purely audit after thirty seconds. A
 * week keeps the trail long enough to correlate with the security log (which is kept for months)
 * without keeping every step of every account forever.
 */
export const TWO_FACTOR_USE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

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
  /** Set on `orphan_entry`: the ids the finding is about, so callers can attribute it without parsing `detail`. */
  entryPublicId?: string;
  transactionId?: string;
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
  /**
   * Where and when this cluster actually mined: one entry per network context (server-observed IP
   * hash) that has credited an admission or proof, most recent first and bounded (see
   * `MAX_NETWORK_TRUSTS`). This is what the network lock reads — trust is not a property the cluster
   * carries everywhere, it is "this identity has mined *here*, recently", so an identity that
   * earned trust elsewhere cannot appear next to another account's live cycle on this network.
   */
  networkTrusts?: MiningDeviceNetworkTrust[];
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Credited mining activity of one device cluster on one network context.
 *
 * `admissions` and `proofs` are counts of *committed* events — a start whose session and lease
 * transaction landed, or a verified single-use proof — never of requests that were merely assessed.
 */
export interface MiningDeviceNetworkTrust {
  /** HMAC of the server-observed peer address; never the address itself. */
  ipHash: string;
  admissions: number;
  proofs: number;
  firstAt: Date;
  lastAt: Date;
}

/**
 * One consumed enrollment slot.
 *
 * The budget is a sliding window, so a slot is a row with the instant it was consumed rather than a
 * counter on a calendar bucket: counting the rows inside `now - windowMs` is exactly the rolling
 * limit, with no double-rate window straddling an hour or day boundary. `identityKey` makes the
 * consumption idempotent per machine within the window (a retry or a racing duplicate of the same
 * machine consumes one slot, not two). `refs` counts the requests relying on the slot right now: a
 * refusal releases its own reference instead of deleting the row, so the release cannot take a
 * slot away from a concurrent request that did enroll on the same machine, while a refused attempt
 * (all references released) stops counting immediately. `expiresAt` is a TTL index — a slot's row is
 * deleted when it can no longer affect any window.
 */
export interface MiningDeviceQuotaRecord {
  _id: string;
  scope: "account" | "network";
  /** The account id or network hash the slot belongs to. */
  subject: string;
  windowMs: number;
  /** Consumed instant; the rolling window counts rows newer than `now - windowMs`. */
  at: Date;
  /** The machine identity this slot was spent on (machine key, else browser key hash). */
  identityKey: string;
  /** Requests currently relying on this slot; only slots with a positive count are spend. */
  refs: number;
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
  /**
   * HMAC of the server-observed peer address the cycle was started from. The network lock reads
   * live leases by this value: a lease is tied to the network the cycle was actually taken on, so
   * neither a later IP change nor a truncated device sweep can hide a live cycle from it.
   */
  ipHash: string | null;
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

/**
 * The financially significant content of one transfer, as the server computed it.
 *
 * Every field here is derived server-side — the recipient from the canonical address the wallet
 * holds, the amounts from the ledger's own arithmetic — and the authorization names exactly this
 * object, so a request cannot authorise one intent and execute another.
 */
export interface TransferIntent {
  recipientWalletId: string;
  recipientUserId: string;
  /** The wallet's canonical address (`customAddress` when it has one), never the spelling typed. */
  recipientAddress: string;
  amountMinor: number;
  feeMinor: number;
  netAmountMinor: number;
  currency: typeof CURRENCY;
  note: string;
}

/**
 * A server-issued, single-use approval of one transfer intent.
 *
 * It is the challenge half of the transfer flow: the preview endpoint computes the intent and issues
 * one of these, the sender proves a credential over it, and the transfer's own transaction consumes
 * it atomically with the money. Because consumption happens inside the financial transaction, a
 * transfer that fails does not burn the approval — and two requests cannot both execute one.
 *
 * The credential versions are the snapshot the proof was taken under: a transfer refuses to settle
 * when the password or the second factor was replaced after the proof (see setTransferPassword and
 * the two-factor endpoints), which is what stops a transfer in flight from landing under a
 * credential its owner has just revoked.
 */
export interface TransferAuthorizationRecord {
  _id: ObjectId;
  publicId: string;
  ownerUserId: string;
  senderWalletId: string;
  intent: TransferIntent;
  /** sha256 over the canonical intent: the idempotency fingerprint and the mismatch guard. */
  intentHash: string;
  passwordChangedAt: Date | null;
  twoFactorEnabledAt: Date | null;
  consumedAt: Date | null;
  consumedByTransactionPublicId: string | null;
  correlationId: string;
  createdAt: Date;
  expiresAt: Date;
  /** TTL anchor (`expiresAt` + retention). Never used for validity. */
  retainUntil: Date;
}

/**
 * Which financial surface a consumed authenticator step belonged to. Scoped so a login-time code
 * and a transfer-time code are separate consumption windows (see `consumeTransferProof`).
 */
export type TwoFactorUsePurpose = "transfer";

/**
 * One accepted authenticator time step, consumed. The unique index on
 * `(ownerUserId, purpose, timeStep)` is the database guarantee that an accepted code cannot authorise
 * a second financial operation inside the same step — not a check-then-insert.
 */
export interface TwoFactorUseRecord {
  _id: ObjectId;
  ownerUserId: string;
  purpose: TwoFactorUsePurpose;
  /** RFC 6238 step the accepted code belonged to: floor(epoch / TOTP_PERIOD_SECONDS). */
  timeStep: number;
  /** The intent this step authorised, so a step can never be spent on a different transfer. */
  intentHash: string;
  correlationId: string;
  createdAt: Date;
  /** TTL anchor. Never used for validity: the accepted step is decided by the server clock. */
  retainUntil: Date;
}

/**
 * Operator controls for the financial surfaces, held as one document so an incident can stop writes
 * without a deploy. Absence of the document means "not paused": a database that has never been told
 * to stop must serve transfers.
 */
export interface FinancialControlsRecord {
  _id: "global";
  transfersPaused: boolean;
  payoutsPaused: boolean;
  reason: string;
  updatedAt: Date;
  updatedBy: string;
}

/** The approval the preview endpoint hands the wizard; the id is what the transfer consumes. */
export interface PublicTransferAuthorization {
  id: string;
  expiresAt: string;
  intent: {
    recipientAddress: string;
    amount: string;
    fee: string;
    netAmount: string;
    currency: typeof CURRENCY;
  };
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
