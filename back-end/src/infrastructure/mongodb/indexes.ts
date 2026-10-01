import { MongoServerError, type Db, type Document } from "mongodb";
import { LEDGER_AMOUNT_MAX_MINOR, LEDGER_BALANCE_MAX_MINOR } from "../../shared/types.js";
import { MAX_CLUSTER_ALIASES, MAX_NETWORK_TRUSTS } from "../../modules/mining-device/policy.js";

/**
 * How long each append-only log is kept.
 *
 * Notifications and security events are written on every transfer and every sign-in, and neither is
 * ever read as a whole: the bell pages one account's notices, and the security page shows one
 * account's recent events. Without a retention window both grow for the life of the deployment and
 * the collections become the largest thing in the database. A TTL index lets the server delete them
 * as it goes — no job to schedule, and no read path has to know the window.
 *
 * These are retention decisions, not technical limits: changing one changes how far back a customer
 * can scroll, and shortening it deletes what is already older than the new window.
 */
const NOTIFICATION_RETENTION_DAYS = 90;
const SECURITY_EVENT_RETENTION_DAYS = 180;
const DAY_MS = 24 * 60 * 60;

const schemas: Record<string, Document> = {
  users: {
    $jsonSchema: {
      bsonType: "object",
      required: ["publicId", "email", "passwordHash", "profile", "status", "emailVerifiedAt", "createdAt", "updatedAt"],
      properties: {
        publicId: { bsonType: "string" },
        email: { bsonType: "string" },
        passwordHash: { bsonType: "string" },
        profile: { bsonType: "object", required: ["displayName", "country"], properties: { displayName: { bsonType: "string" }, country: { bsonType: ["string", "null"] } } },
        status: { enum: ["active", "suspended"] },
        emailVerifiedAt: { bsonType: ["date", "null"] },
        createdAt: { bsonType: "date" },
        updatedAt: { bsonType: "date" },
      },
    },
  },
  wallets: {
    $and: [
      { $jsonSchema: { bsonType: "object", required: ["publicId", "address", "addressNormalized", "ownerUserId", "status", "financialVersion", "createdAt", "updatedAt", "customAddressChangedAt", "customAddress", "customAddressNormalized"], properties: { publicId: { bsonType: "string" }, address: { bsonType: "string" }, addressNormalized: { bsonType: "string" }, ownerUserId: { bsonType: "string" }, status: { enum: ["active", "frozen"] }, financialVersion: { bsonType: "int", minimum: 0 }, createdAt: { bsonType: "date" }, updatedAt: { bsonType: "date" }, customAddressChangedAt: { bsonType: ["date", "null"] }, customAddress: { bsonType: ["string", "null"] }, customAddressNormalized: { bsonType: ["string", "null"] } } } },
      { balance: { $exists: false } },
    ],
  },
  ledger_accounts: {
    // `$jsonSchema` speaks JSON Schema, so the account-type/wallet-id pairing is expressed with
    // allOf/anyOf (the query language's $and/$or are not valid inside it).
    $jsonSchema: {
      bsonType: "object",
      required: ["publicId", "walletId", "accountType", "currency", "balanceMinor", "createdAt"],
      properties: {
        publicId: { bsonType: "string" },
        walletId: { bsonType: ["string", "null"] },
        accountType: { enum: ["wallet", "fee_revenue", "system_treasury"] },
        currency: { enum: ["LMA"] },
        // A projection is cumulative, so it is bounded by the exact-integer range rather than by
        // the size of one movement: the bound only has to keep the number inside the safe range.
        balanceMinor: { bsonType: "number", minimum: 0, maximum: LEDGER_BALANCE_MAX_MINOR },
        createdAt: { bsonType: "date" },
      },
      allOf: [
        // A wallet account belongs to exactly one wallet; an offline account belongs to none.
        {
          anyOf: [
            { properties: { accountType: { enum: ["wallet"] }, walletId: { bsonType: "string" } }, required: ["accountType", "walletId"] },
            { properties: { accountType: { enum: ["fee_revenue", "system_treasury"] }, walletId: { bsonType: "null" } }, required: ["accountType", "walletId"] },
          ],
        },
      ],
    },
  },
  ledger_entries: {
    $jsonSchema: { bsonType: "object", required: ["publicId", "transactionId", "lineNumber", "walletId", "ledgerAccountId", "side", "amountMinor", "currency", "correlationId", "createdAt"], properties: { publicId: { bsonType: "string" }, transactionId: { bsonType: "string" }, lineNumber: { bsonType: "int", minimum: 1 }, walletId: { bsonType: ["string", "null"] }, ledgerAccountId: { bsonType: "string" }, side: { enum: ["debit", "credit"] }, amountMinor: { bsonType: "number", minimum: 1, maximum: LEDGER_AMOUNT_MAX_MINOR }, currency: { enum: ["LMA"] }, correlationId: { bsonType: "string" }, createdAt: { bsonType: "date" } } },
  },
  transactions: {
    // The journal of every financial movement: a transfer today, a mining issuance as well. The
    // shape each kind must carry is expressed with allOf/anyOf (as ledger_accounts does), so the
    // validator still rejects a transfer missing its addresses while accepting a mining header that
    // never had any.
    $jsonSchema: {
      bsonType: "object",
      required: ["publicId", "type", "currency", "status", "correlationId", "createdAt", "completedAt"],
      properties: {
        publicId: { bsonType: "string" },
        type: { enum: ["transfer", "mining"] },
        currency: { enum: ["LMA"] },
        status: { enum: ["completed"] },
        correlationId: { bsonType: "string" },
        createdAt: { bsonType: "date" },
        completedAt: { bsonType: "date" },
        transferId: { bsonType: "string" },
        idempotencyKey: { bsonType: "string" },
        requestFingerprint: { bsonType: "string" },
        participants: { bsonType: "array", minItems: 2, items: { bsonType: "string" } },
        // The sender's running balance, bounded like every other projection rather than like a line.
        balanceAfterMinor: { bsonType: "number", minimum: 0, maximum: LEDGER_BALANCE_MAX_MINOR },
        amountMinor: { bsonType: "number", minimum: 1, maximum: LEDGER_AMOUNT_MAX_MINOR },
        feeMinor: { bsonType: "number", minimum: 0, maximum: LEDGER_AMOUNT_MAX_MINOR },
        netAmountMinor: { bsonType: "number", minimum: 1, maximum: LEDGER_AMOUNT_MAX_MINOR },
      },
      allOf: [
        {
          anyOf: [
            {
              required: ["transferId", "senderUserId", "receiverUserId", "senderWalletId", "receiverWalletId", "senderAddress", "receiverAddress", "amountMinor", "feeMinor", "netAmountMinor", "note", "idempotencyKey", "requestFingerprint", "balanceAfterMinor"],
              properties: { type: { enum: ["transfer"] }, senderUserId: { bsonType: "string" }, receiverUserId: { bsonType: "string" }, senderWalletId: { bsonType: "string" }, receiverWalletId: { bsonType: "string" }, senderAddress: { bsonType: "string" }, receiverAddress: { bsonType: "string" }, note: { bsonType: "string" } },
            },
            {
              required: ["ownerUserId", "walletId", "miningSessionId", "sequenceNumber", "amountMinor", "treasuryAccountId"],
              properties: { type: { enum: ["mining"] }, ownerUserId: { bsonType: "string" }, walletId: { bsonType: "string" }, miningSessionId: { bsonType: "string" }, sequenceNumber: { bsonType: "int", minimum: 1 }, treasuryAccountId: { bsonType: "string" } },
            },
          ],
        },
      ],
    },
  },
  sessions: {
    $jsonSchema: { bsonType: "object", required: ["publicId", "ownerUserId", "refreshTokenHash", "previousRefreshTokenHash", "status", "twoFactorAttempts", "createdAt", "lastActiveAt", "expiresAt", "revokedAt"], properties: { publicId: { bsonType: "string" }, ownerUserId: { bsonType: "string" }, refreshTokenHash: { bsonType: ["string", "null"] }, previousRefreshTokenHash: { bsonType: ["string", "null"] }, status: { enum: ["active", "pending_two_factor", "revoked"] }, twoFactorAttempts: { bsonType: "int", minimum: 0 }, expiresAt: { bsonType: "date" } } },
  },
  security_events: {
    $jsonSchema: { bsonType: "object", required: ["publicId", "ownerUserId", "sessionId", "eventType", "outcome", "metadata", "correlationId", "createdAt"], properties: { publicId: { bsonType: "string" }, ownerUserId: { bsonType: ["string", "null"] }, sessionId: { bsonType: ["string", "null"] }, eventType: { bsonType: "string" }, outcome: { enum: ["success", "failure"] }, correlationId: { bsonType: "string" }, createdAt: { bsonType: "date" } } },
  },
  two_factor_credentials: {
    $jsonSchema: { bsonType: "object", required: ["ownerUserId", "encryptedSecret", "secretIv", "secretAuthTag", "pendingExpiresAt", "enabledAt", "recoveryCodeHashes", "createdAt", "updatedAt"], properties: { ownerUserId: { bsonType: "string" }, encryptedSecret: { bsonType: "string" }, secretIv: { bsonType: "string" }, secretAuthTag: { bsonType: "string" }, pendingExpiresAt: { bsonType: ["date", "null"] }, enabledAt: { bsonType: ["date", "null"] }, recoveryCodeHashes: { bsonType: "array", items: { bsonType: "string" } } } },
  },
  transfer_password_credentials: {
    $jsonSchema: { bsonType: "object", required: ["ownerUserId", "passwordHash", "changedAt"], properties: { ownerUserId: { bsonType: "string" }, passwordHash: { bsonType: "string" }, changedAt: { bsonType: "date" } } },
  },
  transfer_authorizations: {
    // The challenge half of a transfer: the intent the server computed, the credential snapshot the
    // proof was taken under, and whether it was spent. The money fields are bounded exactly like a
    // ledger line, so an approval can never name an amount the ledger could not carry.
    $jsonSchema: {
      bsonType: "object",
      required: ["publicId", "ownerUserId", "senderWalletId", "intent", "intentHash", "passwordChangedAt", "twoFactorEnabledAt", "consumedAt", "consumedByTransactionPublicId", "correlationId", "createdAt", "expiresAt", "retainUntil"],
      properties: {
        publicId: { bsonType: "string" },
        ownerUserId: { bsonType: "string" },
        senderWalletId: { bsonType: "string" },
        intent: {
          bsonType: "object",
          required: ["recipientWalletId", "recipientUserId", "recipientAddress", "amountMinor", "feeMinor", "netAmountMinor", "currency", "note"],
          properties: {
            recipientWalletId: { bsonType: "string" },
            recipientUserId: { bsonType: "string" },
            recipientAddress: { bsonType: "string" },
            amountMinor: { bsonType: "number", minimum: 1, maximum: LEDGER_AMOUNT_MAX_MINOR },
            feeMinor: { bsonType: "number", minimum: 0, maximum: LEDGER_AMOUNT_MAX_MINOR },
            netAmountMinor: { bsonType: "number", minimum: 1, maximum: LEDGER_AMOUNT_MAX_MINOR },
            currency: { enum: ["LMA"] },
            note: { bsonType: "string" },
          },
        },
        intentHash: { bsonType: "string" },
        passwordChangedAt: { bsonType: ["date", "null"] },
        twoFactorEnabledAt: { bsonType: ["date", "null"] },
        consumedAt: { bsonType: ["date", "null"] },
        consumedByTransactionPublicId: { bsonType: ["string", "null"] },
        correlationId: { bsonType: "string" },
        createdAt: { bsonType: "date" },
        expiresAt: { bsonType: "date" },
        retainUntil: { bsonType: "date" },
      },
    },
  },
  two_factor_uses: {
    // One row per accepted authenticator step. The row is inserted inside the financial transaction
    // it authorises, so it exists exactly when the money it approved exists.
    $jsonSchema: {
      bsonType: "object",
      required: ["ownerUserId", "purpose", "timeStep", "intentHash", "correlationId", "createdAt", "retainUntil"],
      properties: {
        ownerUserId: { bsonType: "string" },
        purpose: { enum: ["transfer"] },
        timeStep: { bsonType: "int", minimum: 0 },
        intentHash: { bsonType: "string" },
        correlationId: { bsonType: "string" },
        createdAt: { bsonType: "date" },
        retainUntil: { bsonType: "date" },
      },
    },
  },
  financial_controls: {
    // One operator-controlled row. It carries policy, never money: balances are explained by the
    // ledger alone, so pausing writes cannot itself move a balance.
    $jsonSchema: {
      bsonType: "object",
      required: ["transfersPaused", "payoutsPaused", "reason", "updatedAt", "updatedBy"],
      properties: {
        _id: { bsonType: "string" },
        transfersPaused: { bsonType: "bool" },
        payoutsPaused: { bsonType: "bool" },
        reason: { bsonType: "string" },
        updatedAt: { bsonType: "date" },
        updatedBy: { bsonType: "string" },
      },
    },
  },
  notifications: {
    $jsonSchema: { bsonType: "object", required: ["ownerUserId", "kind", "title", "body", "readAt", "createdAt"], properties: { ownerUserId: { bsonType: "string" }, kind: { bsonType: "string" }, title: { bsonType: "string" }, body: { bsonType: "string" }, readAt: { bsonType: ["date", "null"] }, createdAt: { bsonType: "date" } } },
  },
  mining_sessions: {
    $jsonSchema: {
      bsonType: "object",
      required: ["publicId", "ownerUserId", "walletId", "ledgerAccountId", "status", "cycleNumber", "startedAt", "endsAt", "durationSeconds", "rateUnits", "rateScale", "rateDecimals", "rate", "rateUnit", "settledMinor", "settlementSequence", "lastSettledAt", "createdAt", "updatedAt"],
      properties: {
        publicId: { bsonType: "string" },
        ownerUserId: { bsonType: "string" },
        walletId: { bsonType: "string" },
        ledgerAccountId: { bsonType: "string" },
        status: { enum: ["active", "settled"] },
        cycleNumber: { bsonType: "int", minimum: 1 },
        startedAt: { bsonType: "date" },
        endsAt: { bsonType: "date" },
        durationSeconds: { bsonType: "int", minimum: 1 },
        rateUnits: { bsonType: "number", minimum: 1 },
        rateScale: { bsonType: "number", minimum: 1 },
        rateDecimals: { bsonType: "int", minimum: 0 },
        rate: { bsonType: "string" },
        rateUnit: { enum: ["LMA/hour"] },
        // Cumulative, so bounded by the exact-integer range rather than by one movement's size.
        settledMinor: { bsonType: "number", minimum: 0, maximum: LEDGER_BALANCE_MAX_MINOR },
        settlementSequence: { bsonType: "int", minimum: 0 },
        lastSettledAt: { bsonType: ["date", "null"] },
        createdAt: { bsonType: "date" },
        updatedAt: { bsonType: "date" },
      },
    },
  },
  mining_devices: {
    $jsonSchema: {
      bsonType: "object",
      required: ["publicId", "deviceKeyHash", "firstSeenAt", "lastSeenAt", "status", "createdAt", "updatedAt"],
      properties: {
        publicId: { bsonType: "string" },
        deviceKeyHash: { bsonType: "string" },
        browserKeyPublicKey: { bsonType: ["string", "null"] },
        fingerprintVisitorIdHash: { bsonType: ["string", "null"] },
        normalizedSignalHash: { bsonType: ["string", "null"] },
        status: { enum: ["active", "quarantined", "blocked"] },
        // Server-owned enrollment state; see MiningDeviceTrustState. Optional for rows written
        // before the enrollment model existed.
        trustState: { enum: ["provisional", "established", "suspicious", "blocked"] },
        anchorHash: { bsonType: ["string", "null"] },
        aliasHashes: { bsonType: "array", items: { bsonType: "string" }, maxItems: MAX_CLUSTER_ALIASES },
        enrollmentUserId: { bsonType: ["string", "null"] },
        admissionCount: { bsonType: "int", minimum: 0 },
        proofCount: { bsonType: "int", minimum: 0 },
        establishedAt: { bsonType: ["date", "null"] },
        findingCount: { bsonType: "int", minimum: 0 },
        // Credited mining activity per network context (bounded); the network lock reads the entry
        // for the current network, so trust is "mined here, recently", never "trusted everywhere".
        networkTrusts: {
          bsonType: "array",
          maxItems: MAX_NETWORK_TRUSTS,
          items: {
            bsonType: "object",
            required: ["ipHash", "admissions", "proofs", "firstAt", "lastAt"],
            properties: {
              ipHash: { bsonType: "string" },
              admissions: { bsonType: "int", minimum: 0 },
              proofs: { bsonType: "int", minimum: 0 },
              firstAt: { bsonType: "date" },
              lastAt: { bsonType: "date" },
            },
          },
        },
        firstSeenAt: { bsonType: "date" },
        lastSeenAt: { bsonType: "date" },
        createdAt: { bsonType: "date" },
        updatedAt: { bsonType: "date" },
      },
    },
  },
  mining_device_quotas: {
    $jsonSchema: {
      bsonType: "object",
      required: ["scope", "subject", "windowMs", "at", "identityKey", "refs", "expiresAt"],
      properties: {
        // `_id` is the consumed-slot key `${scope}:${windowMs}:${windowIndex}:${subject}:${identity}`,
        // which makes spending the same machine's slot twice inside one window impossible; the
        // rolling limit itself is the count of `at` values inside the window.
        _id: { bsonType: "string" },
        scope: { enum: ["account", "network"] },
        subject: { bsonType: "string" },
        windowMs: { bsonType: ["int", "long", "double"] },
        at: { bsonType: "date" },
        identityKey: { bsonType: "string" },
        // Requests relying on the slot; a refused request releases its reference instead of
        // deleting the row, so it cannot take the slot away from a concurrent enrollment.
        refs: { bsonType: "int", minimum: 0 },
        expiresAt: { bsonType: "date" },
      },
    },
  },
  mining_device_leases: {
    $jsonSchema: {
      bsonType: "object",
      required: ["publicId", "deviceClusterId", "ownerUserId", "miningSessionId", "leasedAt", "leaseEndsAt", "status", "createdAt", "updatedAt"],
      properties: {
        publicId: { bsonType: "string" },
        deviceClusterId: { bsonType: "string" },
        deviceId: { bsonType: ["string", "null"] },
        ownerUserId: { bsonType: "string" },
        // The network the cycle was taken from; the network lock queries live leases by it.
        ipHash: { bsonType: ["string", "null"] },
        miningSessionId: { bsonType: "string" },
        leasedAt: { bsonType: "date" },
        leaseEndsAt: { bsonType: "date" },
        status: { enum: ["active", "released"] },
        createdAt: { bsonType: "date" },
        updatedAt: { bsonType: "date" },
      },
    },
  },
  mining_device_nonces: {
    $jsonSchema: {
      bsonType: "object",
      required: ["publicId", "ownerUserId", "nonce", "issuedAt", "expiresAt", "consumedAt"],
      properties: {
        publicId: { bsonType: "string" },
        ownerUserId: { bsonType: "string" },
        nonce: { bsonType: "string" },
        issuedAt: { bsonType: "date" },
        expiresAt: { bsonType: "date" },
      },
    },
  },
  mining_device_observations: {
    $jsonSchema: {
      bsonType: "object",
      required: ["deviceId", "ownerUserId", "observedAt", "riskScore", "decision"],
      properties: {
        deviceId: { bsonType: "string" },
        ownerUserId: { bsonType: "string" },
        observedAt: { bsonType: "date" },
        riskScore: { bsonType: "number" },
        decision: { bsonType: "string" },
      },
    },
  },
  mining_settlements: {
    $jsonSchema: {
      bsonType: "object",
      required: ["publicId", "ownerUserId", "walletId", "sessionPublicId", "sequenceNumber", "amountMinor", "treasuryAccountId", "walletAccountId", "correlationId", "idempotencyKey", "createdAt"],
      properties: {
        publicId: { bsonType: "string" },
        ownerUserId: { bsonType: "string" },
        walletId: { bsonType: "string" },
        sessionPublicId: { bsonType: "string" },
        sequenceNumber: { bsonType: "int", minimum: 1 },
        amountMinor: { bsonType: "number", minimum: 1, maximum: LEDGER_AMOUNT_MAX_MINOR },
        treasuryAccountId: { bsonType: "string" },
        walletAccountId: { bsonType: "string" },
        correlationId: { bsonType: "string" },
        idempotencyKey: { bsonType: "string" },
        createdAt: { bsonType: "date" },
      },
    },
  },
  mining_settings: {
    // One document per setting key. `value` is deliberately unconstrained: booleans and
    // room/rate objects share this collection, and each key is validated by the settings
    // module on write (operator gets the error) and on read (a bad row never bricks mining).
    $jsonSchema: {
      bsonType: "object",
      required: ["key", "value", "updatedAt", "updatedBy"],
      properties: {
        key: { bsonType: "string" },
        updatedAt: { bsonType: "date" },
        updatedBy: { bsonType: "string" },
      },
    },
  },
  mining_pool_members: {
    $jsonSchema: {
      bsonType: "object",
      required: ["ownerUserId", "poolId", "joinedAt", "updatedAt"],
      properties: {
        ownerUserId: { bsonType: "string" },
        poolId: { enum: ["low", "medium"] },
        joinedAt: { bsonType: "date" },
        updatedAt: { bsonType: "date" },
      },
    },
  },
};

async function applyValidator(db: Db, name: string, validator: Document): Promise<void> {
  await db.command({ collMod: name, validator, validationLevel: "strict", validationAction: "error" });
}

async function ensureCollection(db: Db, name: string, validator: Document): Promise<void> {
  const [existing] = await db.listCollections({ name }, { nameOnly: false }).toArray();
  if (existing) {
    // `collMod` is a metadata write that takes the collection's lock, and every process applies the
    // same schema at boot: re-sending an unchanged validator is pure cost on every deploy and every
    // restart. Both sides of this comparison are produced by this module, so a string comparison is
    // enough to tell "the same schema" from "a schema that changed".
    //
    // The validator alone is not the whole enforcement story: a collection whose level or action was
    // relaxed (for example `moderate`/`warn` during an incident) compares equal here yet keeps
    // accepting records the application expects MongoDB to reject. Startup previously reapplied
    // `strict`/`error`, so those settings are checked before skipping `collMod`.
    if (
      JSON.stringify(existing.options?.["validator"] ?? null) === JSON.stringify(validator) &&
      (existing.options?.["validationLevel"] ?? "strict") === "strict" &&
      (existing.options?.["validationAction"] ?? "error") === "error"
    ) return;
    await applyValidator(db, name, validator);
    return;
  }
  try {
    await db.createCollection(name, { validator, validationLevel: "strict", validationAction: "error" });
  } catch (error) {
    // Another process created it between the listing above and this call.
    if (!(error instanceof MongoServerError) || error.code !== 48) throw error;
    await applyValidator(db, name, validator);
  }
}

export interface EnsureDatabaseIndexesOptions {
  /**
   * Whether the retention TTL indexes may be created. Deleting notifications older than 90 days and
   * security events older than 180 days destroys customer-visible history — including unread
   * notices — on first install against a database that already holds older records, with no archive
   * and no delete reporting on the notification stream. The rollout is therefore explicit: an
   * operator enables `RETENTION_TTL_ENABLED` only after existing history has been archived or its
   * deletion accepted. Until then the collections keep growing, which is the safe direction.
   */
  retentionTtlEnabled?: boolean;
  /**
   * Device-observation retention in seconds (`LMDG_DEVICE_OBSERVATION_TTL_SECONDS`). Unlike the
   * retention indexes above this is routine evidence expiry, not customer-visible history deletion,
   * so it applies whenever the value is provided. Absent (tests, older callers), the TTL is left
   * untouched rather than guessed.
   */
  observationTtlSeconds?: number;
}

async function dropIndexIfExists(db: Db, collection: string, name: string): Promise<void> {
  try {
    await db.collection(collection).dropIndex(name);
  } catch (error) {
    // Another startup (or a previous run) already removed it.
    if (error instanceof MongoServerError && (error.code === 27 || error.codeName === "IndexNotFound")) return;
    throw error;
  }
}

async function createIndexMigratingOptions(db: Db, collection: string, key: Document, options: Document): Promise<void> {
  try {
    await db.collection(collection).createIndex(key, options);
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code;
    if (!(error instanceof MongoServerError) || (code !== 85 && code !== 86)) throw error;
    // A database started by the previous release already holds this name with different options
    // (the notifications index had no partial filter; the transactions indexes were not yet scoped
    // to transfers). Failing startup here would wedge the API on every boot, so the old definition
    // is replaced instead.
    await dropIndexIfExists(db, collection, options["name"] as string);
    await db.collection(collection).createIndex(key, options);
  }
}

/** One backfill write touches at most this many documents, so startup never holds one unbounded op. */
const PARTICIPANT_BACKFILL_BATCH_SIZE = 500;

/** Same bound for the LMDG transition backfills below; those collections are far smaller. */
const LMDG_BACKFILL_BATCH_SIZE = 200;

/**
 * Leases taken by the previous release carry no network, and the network lock reads live leases by
 * `ipHash` alone — so an un-backfilled lease stays invisible to it for the rest of its 24-hour
 * cycle, and a new identity could start on a network where another account is already mining. The
 * attribution comes from the device observation recorded for the start that took the lease (the
 * network observed at `leasedAt`), never from the device record's `lastIpHash`: that field is the
 * latest observation, and when two starts race it can already hold the loser's network while the
 * winner's lease commits — copying it would protect the wrong network and leave the real one open.
 * Bounded and idempotent: a lease with no attributable observation is marked `ipHash: null` so the
 * scan advances past it (it stays invisible to the lock and expires with its cycle), and every
 * other lease is written once.
 */
async function backfillLeaseNetworks(db: Db): Promise<void> {
  const leases = db.collection("mining_device_leases");
  for (;;) {
    const batch = await leases
      .find({ status: "active", ipHash: { $exists: false } }, { projection: { _id: 1, deviceId: 1, leasedAt: 1 } })
      .limit(LMDG_BACKFILL_BATCH_SIZE)
      .toArray();
    if (batch.length === 0) return;
    const deviceIds = [...new Set(batch.map((lease) => lease["deviceId"]).filter((value): value is string => typeof value === "string" && value.length > 0))];
    const leasedTimes = batch
      .map((lease) => lease["leasedAt"])
      .filter((value): value is Date => value instanceof Date)
      .map((date) => date.getTime());
    const maxLeasedAt = leasedTimes.length > 0 ? Math.max(...leasedTimes) : Date.now();
    const minLeasedAt = leasedTimes.length > 0 ? Math.min(...leasedTimes) : Date.now();
    // Observations sampled around each start; the one recorded for the winning start is the
    // network its cycle was actually taken from.
    const observations = deviceIds.length > 0
      ? await db
        .collection("mining_device_observations")
        .find(
          {
            deviceId: { $in: deviceIds },
            observedAt: { $gte: new Date(minLeasedAt - 60 * 60 * 1000), $lte: new Date(maxLeasedAt + 60 * 1000) },
          },
          { projection: { deviceId: 1, observedAt: 1, ipHash: 1 } },
        )
        .toArray()
        .catch(() => [])
      : [];
    const observationsByDevice = new Map<string, { observedAt: number; ipHash: string }[]>();
    for (const observation of observations) {
      const deviceId = observation["deviceId"];
      const observedAt = observation["observedAt"];
      const ipHashValue = observation["ipHash"];
      if (typeof deviceId !== "string" || !(observedAt instanceof Date)) continue;
      if (typeof ipHashValue !== "string" || ipHashValue.length === 0) continue;
      const list = observationsByDevice.get(deviceId) ?? [];
      list.push({ observedAt: observedAt.getTime(), ipHash: ipHashValue });
      observationsByDevice.set(deviceId, list);
    }
    for (const list of observationsByDevice.values()) list.sort((left, right) => left.observedAt - right.observedAt);
    for (const lease of batch) {
      const deviceId = typeof lease["deviceId"] === "string" ? (lease["deviceId"] as string) : null;
      const leasedAt = lease["leasedAt"] instanceof Date ? (lease["leasedAt"] as Date).getTime() : null;
      let network: string | null = null;
      if (deviceId && leasedAt !== null) {
        // The lease's network is the observation for the winning start (at or before
        // `leasedAt`). A competing start on the same device can record a later observation
        // within the +60s fetch window; attributing that later network would protect the
        // wrong network and leave the actual one unlocked.
        const candidates = observationsByDevice.get(deviceId) ?? [];
        for (const candidate of candidates) {
          if (candidate.observedAt <= leasedAt) network = candidate.ipHash;
          else break;
        }
      }
      if (network) {
        await leases.updateOne({ _id: lease["_id"], ipHash: { $exists: false } }, { $set: { ipHash: network } });
      } else {
        // No attributable observation (records rotated out, or the start predates them): mark the
        // lease so this scan advances past it instead of stopping. `null` never matches the lock's
        // per-network query, so the lease stays invisible exactly as an un-backfilled one would.
        await leases.updateOne({ _id: lease["_id"], ipHash: { $exists: false } }, { $set: { ipHash: null } });
      }
    }
    if (batch.length < LMDG_BACKFILL_BATCH_SIZE) return;
  }
}

/**
 * Enrollment slots written by the previous release are fixed-window counters
 * (`{ scope, windowMs, bucketStart, count }`), not per-machine rows, so the rolling-window count
 * cannot see them: an account or network that had already spent its limit would get the whole new
 * limit again inside the same window. Each live legacy counter is converted into the rows it stands
 * for — `count` placeholder identities stamped inside the current window — so the spend it
 * represents keeps counting until it ages out. The counter row is then deleted, which makes the
 * conversion idempotent and stops it from ever counting twice.
 */
async function migrateLegacyEnrollmentSlots(db: Db): Promise<void> {
  // The previous release's rows are described here rather than by the collection's default schema:
  // their `_id` is a slot key string, not the ObjectId the driver infers from an untyped collection.
  const quotas = db.collection<{
    _id: string;
    scope?: unknown;
    windowMs?: unknown;
    bucketStart?: unknown;
    count?: unknown;
    expiresAt?: unknown;
  }>("mining_device_quotas");
  // Per-machine rows written before reference tracking carry `at` but no `refs`. The live count
  // now treats a missing `refs` as counted, so they keep enforcing their window without a rewrite —
  // but backfilling `refs: 1` (and `expiresAt` when absent) brings them under the current schema
  // and TTL, so they age out on the same schedule as new slots instead of lingering.
  for (;;) {
    const batch = await quotas
      .find(
        { at: { $exists: true }, refs: { $exists: false } },
        { projection: { _id: 1, at: 1, windowMs: 1, expiresAt: 1 } },
      )
      .limit(LMDG_BACKFILL_BATCH_SIZE)
      .toArray();
    if (batch.length === 0) break;
    for (const row of batch) {
      const atValue = (row as { at?: unknown })["at"];
      const at = atValue instanceof Date ? atValue : null;
      const windowValue = (row as { windowMs?: unknown })["windowMs"];
      const windowMs = typeof windowValue === "number" && windowValue > 0 ? windowValue : null;
      const set: Record<string, unknown> = { refs: 1 };
      if (!((row as { expiresAt?: unknown })["expiresAt"] instanceof Date) && at && windowMs) {
        set["expiresAt"] = new Date(at.getTime() + windowMs);
      }
      await quotas.updateOne({ _id: row["_id"], refs: { $exists: false } }, { $set: set });
    }
    if (batch.length < LMDG_BACKFILL_BATCH_SIZE) break;
  }
  for (;;) {
    const batch = await quotas
      .find(
        { at: { $exists: false }, bucketStart: { $exists: true } },
        { projection: { _id: 1, scope: 1, windowMs: 1, bucketStart: 1, count: 1, expiresAt: 1 } },
      )
      .limit(LMDG_BACKFILL_BATCH_SIZE)
      .toArray();
    if (batch.length === 0) return;
    for (const row of batch) {
      const scope = row["scope"] === "network" ? "network" : row["scope"] === "account" ? "account" : null;
      const windowMs = typeof row["windowMs"] === "number" && row["windowMs"] > 0 ? row["windowMs"] : null;
      const count = typeof row["count"] === "number" && row["count"] > 0 ? Math.floor(row["count"]) : 0;
      const bucketStart = row["bucketStart"] instanceof Date ? row["bucketStart"] : null;
      // The legacy key is `${scope}:${windowMs}:${bucketStart}:${subject}`; the subject is the tail.
      const segments = String(row["_id"]).split(":");
      const subject = segments.length >= 4 ? segments.slice(3).join(":") : null;
      if (scope && windowMs && count > 0 && bucketStart && subject) {
        const now = Date.now();
        const at = new Date(Math.max(bucketStart.getTime(), now - windowMs + 1));
        const expiresAt = row["expiresAt"] instanceof Date ? row["expiresAt"] : new Date(at.getTime() + windowMs);
        for (let index = 0; index < count; index += 1) {
          await quotas.updateOne(
            { _id: `${scope}:${windowMs}:${Math.floor(at.getTime() / windowMs)}:${subject}:legacy-${index}` },
            { $setOnInsert: { scope, subject, windowMs, at, identityKey: `legacy-${index}`, refs: 1, expiresAt } },
            { upsert: true },
          );
        }
      }
      await quotas.deleteOne({ _id: row["_id"] });
    }
    if (batch.length < LMDG_BACKFILL_BATCH_SIZE) return;
  }
}

async function backfillTransactionParticipants(db: Db): Promise<void> {
  // Bounded batches instead of one unbounded `updateMany`: on a database with many legacy
  // transactions a single multi-million-document write must finish before the API listens, and
  // several instances starting together multiply that work. Each batch is small and idempotent —
  // the value written is what the record already implies — so overlapping runs are harmless, and
  // the read path's legacy fallback (see listTransactions) keeps un-backfilled rows visible.
  for (;;) {
    // Scoped to transfers: a mining journal header is not a transfer and never carries a
    // participant list, so the backfill must leave it alone.
    const batch = await db
      .collection("transactions")
      .find({ type: "transfer", participants: null }, { projection: { _id: 1 } })
      .limit(PARTICIPANT_BACKFILL_BATCH_SIZE)
      .toArray();
    if (batch.length === 0) return;
    await db
      .collection("transactions")
      .updateMany({ _id: { $in: batch.map((doc) => doc._id) } }, [
        { $set: { participants: ["$senderUserId", "$receiverUserId"] } },
      ]);
    if (batch.length < PARTICIPANT_BACKFILL_BATCH_SIZE) return;
  }
}

export async function ensureDatabaseIndexes(db: Db, options: EnsureDatabaseIndexesOptions = {}): Promise<void> {
  // Wallets written by an earlier release have no `financialVersion` (or the custom-address fields),
  // while the validator below requires them. Without this backfill a strict validator would reject
  // the first update to such a wallet — a custom-address change is the one that only touches the
  // address fields — leaving the account permanently unchangeable. One pipeline update sets every
  // missing field at once, so the resulting document satisfies the validator even on a database
  // where a stricter validator is already installed.
  await db.collection("wallets").updateMany(
    {
      $or: [
        { financialVersion: { $exists: false } },
        { customAddressChangedAt: { $exists: false } },
        { customAddress: { $exists: false } },
        { customAddressNormalized: { $exists: false } },
      ],
    },
    [
      {
        $set: {
          financialVersion: { $ifNull: ["$financialVersion", 0] },
          customAddressChangedAt: { $ifNull: ["$customAddressChangedAt", null] },
          customAddress: { $ifNull: ["$customAddress", null] },
          customAddressNormalized: { $ifNull: ["$customAddressNormalized", null] },
        },
      },
    ],
  );

  // LMDG transition backfills. Like the wallet backfill above they run before the validators so a
  // row written by the previous release is never the subject of a rejected update, and each one is
  // bounded and idempotent so several instances can start together.
  await backfillLeaseNetworks(db);
  await migrateLegacyEnrollmentSlots(db);

  for (const [name, validator] of Object.entries(schemas)) await ensureCollection(db, name, validator);

  // A database created by an earlier release holds the unique form of the session index, which
  // cannot coexist with a lease per device identity (see the plain index below). It is removed
  // before the batch so no index build races the drop on the same collection.
  await dropIndexIfExists(db, "mining_device_leases", "mining_device_leases_session_unique");

  await Promise.all([
    db.collection("users").createIndex({ publicId: 1 }, { unique: true, name: "users_public_id_unique" }),
    db.collection("users").createIndex({ email: 1 }, { unique: true, name: "users_email_unique" }),
    db.collection("wallets").createIndex({ publicId: 1 }, { unique: true, name: "wallets_public_id_unique" }),
    db.collection("wallets").createIndex({ addressNormalized: 1 }, { unique: true, name: "wallets_address_unique" }),
    db.collection("wallets").createIndex({ ownerUserId: 1 }, { unique: true, name: "wallets_owner_unique" }),
    db.collection("wallets").createIndex({ customAddressNormalized: 1 }, { unique: true, partialFilterExpression: { customAddressNormalized: { $type: "string" } }, name: "wallets_custom_address_unique" }),
    db.collection("ledger_accounts").createIndex({ publicId: 1 }, { unique: true, name: "ledger_accounts_public_id_unique" }),
    db.collection("ledger_accounts").createIndex({ walletId: 1, accountType: 1 }, { unique: true, partialFilterExpression: { accountType: "wallet" }, name: "ledger_accounts_wallet_unique" }),
    db.collection("ledger_accounts").createIndex({ accountType: 1, currency: 1 }, { unique: true, partialFilterExpression: { accountType: "fee_revenue" }, name: "ledger_accounts_revenue_unique" }),
    // The treasury is the single controlled source of issuance. Making it unique is what lets an
    // ensure-and-upsert resolve to one account under concurrent first-use instead of minting two.
    db.collection("ledger_accounts").createIndex({ accountType: 1, currency: 1 }, { unique: true, partialFilterExpression: { accountType: "system_treasury" }, name: "ledger_accounts_treasury_unique" }),
    db.collection("ledger_entries").createIndex({ publicId: 1 }, { unique: true, name: "ledger_entries_public_id_unique" }),
    db.collection("ledger_entries").createIndex({ transactionId: 1, lineNumber: 1 }, { unique: true, name: "ledger_entries_transaction_line_unique" }),
    db.collection("ledger_entries").createIndex({ ledgerAccountId: 1, createdAt: -1, publicId: -1 }, { name: "ledger_entries_account_history" }),
    db.collection("transactions").createIndex({ publicId: 1 }, { unique: true, name: "transactions_public_id_unique" }),
    // Scoped to transfers: a mining header has neither a transfer id nor an idempotency key in the
    // customer's namespace, so it must not be forced to invent one to satisfy a unique index.
    createIndexMigratingOptions(db, "transactions", { transferId: 1 }, { unique: true, partialFilterExpression: { type: "transfer" }, name: "transactions_transfer_id_unique" }),
    createIndexMigratingOptions(db, "transactions", { senderUserId: 1, idempotencyKey: 1 }, { unique: true, partialFilterExpression: { type: "transfer" }, name: "transactions_idempotency_unique" }),
    db.collection("transactions").createIndex({ senderUserId: 1, createdAt: -1, publicId: -1 }, { name: "transactions_sender_history" }),
    db.collection("transactions").createIndex({ receiverUserId: 1, createdAt: -1, publicId: -1 }, { name: "transactions_receiver_history" }),
    // One index for the history as the wallet asks for it: both directions in one page, in one order.
    // The previous shape had to answer that with an `$or` over the two indexes above, which the
    // server resolves by fetching both halves and sorting them in memory — the cost grew with the
    // account's history instead of with the page.
    db.collection("transactions").createIndex({ participants: 1, createdAt: -1, publicId: -1 }, { name: "transactions_participants_history" }),
    db.collection("sessions").createIndex({ publicId: 1 }, { unique: true, name: "sessions_public_id_unique" }),
    db.collection("sessions").createIndex({ ownerUserId: 1, status: 1, lastActiveAt: -1 }, { name: "sessions_owner_active" }),
    db.collection("sessions").createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0, name: "sessions_expire_at" }),
    db.collection("security_events").createIndex({ publicId: 1 }, { unique: true, name: "security_events_public_id_unique" }),
    db.collection("security_events").createIndex({ ownerUserId: 1, createdAt: -1 }, { name: "security_events_owner_history" }),
    db.collection("two_factor_credentials").createIndex({ ownerUserId: 1 }, { unique: true, name: "two_factor_owner_unique" }),
    db.collection("transfer_password_credentials").createIndex({ ownerUserId: 1 }, { unique: true, name: "transfer_password_owner_unique" }),
    db.collection("transfer_authorizations").createIndex({ publicId: 1 }, { unique: true, name: "transfer_authorizations_public_id_unique" }),
    // One approval can be consumed by one transaction. Consumption already happens by a conditional
    // update inside the transfer's transaction; this index is the database-level statement of the
    // same rule, so even a future code path that forgot the condition cannot spend an approval twice.
    db.collection("transfer_authorizations").createIndex(
      { consumedByTransactionPublicId: 1 },
      { unique: true, partialFilterExpression: { consumedByTransactionPublicId: { $type: "string" } }, name: "transfer_authorizations_consumed_by_unique" },
    ),
    db.collection("transfer_authorizations").createIndex({ ownerUserId: 1, createdAt: -1 }, { name: "transfer_authorizations_owner_history" }),
    // Retention, not validity: an approval stops working when its `expiresAt` passes (the consume is
    // conditional on it), and the row is deleted a month later so the audit trail survives it.
    db.collection("transfer_authorizations").createIndex({ retainUntil: 1 }, { expireAfterSeconds: 0, name: "transfer_authorizations_retain" }),
    // The concurrency guarantee behind "one accepted code, one financial operation": an insert is
    // the only way to spend a step, and this index refuses a second one.
    db.collection("two_factor_uses").createIndex({ ownerUserId: 1, purpose: 1, timeStep: 1 }, { unique: true, name: "two_factor_uses_step_unique" }),
    db.collection("two_factor_uses").createIndex({ retainUntil: 1 }, { expireAfterSeconds: 0, name: "two_factor_uses_retain" }),
    db.collection("notifications").createIndex({ ownerUserId: 1, createdAt: -1 }, { name: "notifications_owner_history" }),
    db.collection("mining_sessions").createIndex({ publicId: 1 }, { unique: true, name: "mining_sessions_public_id_unique" }),
    // The product rule (one live cycle per account) enforced by the database, not by a check-then-
    // insert: a second concurrent start hits this index and converges on the cycle that won.
    db.collection("mining_sessions").createIndex({ ownerUserId: 1 }, { unique: true, partialFilterExpression: { status: "active" }, name: "mining_sessions_one_active_per_user" }),
    db.collection("mining_sessions").createIndex({ ownerUserId: 1, createdAt: -1, publicId: -1 }, { name: "mining_sessions_owner_history" }),
    // Serving "the running cycle" and sweep/reporting queries without a collection scan.
    db.collection("mining_sessions").createIndex({ ownerUserId: 1, endsAt: -1 }, { name: "mining_sessions_owner_ends" }),
    db.collection("mining_sessions").createIndex({ status: 1, endsAt: 1 }, { name: "mining_sessions_status_ends" }),
    db.collection("mining_settlements").createIndex({ publicId: 1 }, { unique: true, name: "mining_settlements_public_id_unique" }),
    // One settlement per (cycle, sequence), which is the real idempotency boundary of a reward.
    db.collection("mining_settlements").createIndex({ sessionPublicId: 1, sequenceNumber: 1 }, { unique: true, name: "mining_settlements_session_sequence_unique" }),
    db.collection("mining_settlements").createIndex({ idempotencyKey: 1 }, { unique: true, name: "mining_settlements_idempotency_unique" }),
    db.collection("mining_settlements").createIndex({ ownerUserId: 1, createdAt: -1 }, { name: "mining_settlements_owner_history" }),
    // Setting keys are unique: one live value per key, and the upsert in setMiningSetting converges on it.
    db.collection("mining_settings").createIndex({ key: 1 }, { unique: true, name: "mining_settings_key_unique" }),
    // One pool membership per account: the database guarantee behind "join a pool to mine".
    db.collection("mining_pool_members").createIndex({ ownerUserId: 1 }, { unique: true, name: "mining_pool_members_owner_unique" }),
    db.collection("mining_pool_members").createIndex({ poolId: 1 }, { name: "mining_pool_members_pool" }),
    db.collection("mining_devices").createIndex({ publicId: 1 }, { unique: true, name: "mining_devices_public_id_unique" }),
    db.collection("mining_devices").createIndex({ deviceKeyHash: 1 }, { name: "mining_devices_key_hash" }),
    // The machine identity is the fan-in of every browser/profile observation of one computer; the
    // resolution path looks it up directly rather than through the recent-activity sweep, so the
    // lookup needs its own index and never depends on `lastSeenAt` ordering.
    db.collection("mining_devices").createIndex({ machineKeyHash: 1 }, { name: "mining_devices_machine_key" }),
    // The immutable enrollment anchor: one server-owned identity per machine core. Partial-unique
    // (rows written before the enrollment model have no anchor) so a racing enrollment cannot create
    // a second cluster for one machine.
    db.collection("mining_devices").createIndex(
      { anchorHash: 1 },
      { unique: true, partialFilterExpression: { anchorHash: { $type: "string" } }, name: "mining_devices_anchor_unique" },
    ),
    // Append-only aliases the server accepted for a cluster (a moved core trait, a tolerant match);
    // a multikey index so those observations resolve to the established cluster by direct lookup.
    db.collection("mining_devices").createIndex({ aliasHashes: 1 }, { name: "mining_devices_alias_hashes" }),
    db.collection("mining_devices").createIndex({ normalizedSignalHash: 1 }, { name: "mining_devices_signal_hash" }),
    db.collection("mining_devices").createIndex({ lastSeenAt: -1 }, { name: "mining_devices_last_seen" }),
    db.collection("mining_devices").createIndex({ status: 1, lastSeenAt: -1 }, { name: "mining_devices_status_seen" }),
    // One active lease per device cluster: the database guarantee behind "one device, one cycle".
    db.collection("mining_device_leases").createIndex({ deviceClusterId: 1 }, { unique: true, partialFilterExpression: { status: "active" }, name: "mining_device_leases_one_active_per_device" }),
    db.collection("mining_device_leases").createIndex({ ownerUserId: 1, status: 1 }, { name: "mining_device_leases_owner_active" }),
    db.collection("mining_device_leases").createIndex({ deviceClusterId: 1, leaseEndsAt: -1 }, { name: "mining_device_leases_device_ends" }),
    // The network lock reads the live leases taken from one network directly; the index keeps that
    // query proportional to the cycles running on the network, never to the device population.
    db.collection("mining_device_leases").createIndex({ ipHash: 1, status: 1, leaseEndsAt: -1 }, { name: "mining_device_leases_network_active" }),
    // Deliberately NOT unique: one cycle leases every identity its machine is known by (the machine
    // key plus the browser key, and any duplicate record), so one session owns several rows. The
    // uniqueness that matters is one *active lease per device identity*, which is the index above.
    // A unique index here contradicts the multi-identity lease and made every multi-key start abort.
    db.collection("mining_device_leases").createIndex({ miningSessionId: 1 }, { name: "mining_device_leases_session" }),
    db.collection("mining_device_nonces").createIndex({ nonce: 1 }, { unique: true, name: "mining_device_nonces_unique" }),
    db.collection("mining_device_nonces").createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0, name: "mining_device_nonces_ttl" }),
    db.collection("mining_device_observations").createIndex({ deviceId: 1, observedAt: -1 }, { name: "mining_device_observations_device_time" }),
    db.collection("mining_device_observations").createIndex({ ownerUserId: 1, observedAt: -1 }, { name: "mining_device_observations_owner_time" }),
    // Enrollment slots are short-lived rows: the TTL index is what keeps them bounded.
    db.collection("mining_device_quotas").createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0, name: "mining_device_quotas_ttl" }),
    // The rolling-window count for one account or network: served by this index, one row per slot.
    db.collection("mining_device_quotas").createIndex({ scope: 1, subject: 1, windowMs: 1, at: -1 }, { name: "mining_device_quotas_window" }),
  ]);

  if (options.retentionTtlEnabled) {
    // Unread notices are never eligible for expiry: only a notice the customer has seen
    // (`readAt` set) may age out. Expiring unread notices would silently delete information
    // the customer was never shown.
    await createIndexMigratingOptions(db, "notifications", { createdAt: 1 }, { expireAfterSeconds: NOTIFICATION_RETENTION_DAYS * DAY_MS, name: "notifications_retain", partialFilterExpression: { readAt: { $type: "date" } } });
    await createIndexMigratingOptions(db, "security_events", { createdAt: 1 }, { expireAfterSeconds: SECURITY_EVENT_RETENTION_DAYS * DAY_MS, name: "security_events_retain" });
  } else {
    // The flag gates deletion, not just creation: a database that already holds these TTL indexes
    // from an earlier enabled run would otherwise keep deleting old notifications (including
    // unread ones) and security events while the operator believes retention is off.
    await Promise.all([
      dropIndexIfExists(db, "notifications", "notifications_retain"),
      dropIndexIfExists(db, "security_events", "security_events_retain"),
    ]);
  }

  // Device observations are sampled evidence, not customer history: without a TTL they accumulate
  // for the life of the deployment while the configured `LMDG_DEVICE_OBSERVATION_TTL_SECONDS`
  // claims a retention window. Migrating options (rather than a fixed definition) so a changed
  // window replaces the index instead of wedging startup on boot. Clamped to the 30-day history
  // window the risk engine reasons over: a shorter TTL would expire rows the device and account
  // checks still expect, silently understating risk.
  if (options.observationTtlSeconds !== undefined) {
    await createIndexMigratingOptions(
      db,
      "mining_device_observations",
      { observedAt: 1 },
      { expireAfterSeconds: Math.max(options.observationTtlSeconds, 30 * 24 * 60 * 60), name: "mining_device_observations_ttl" },
    );
  }

  // Transactions written before the participant list existed are filled in, in bounded batches.
  await backfillTransactionParticipants(db);
}
