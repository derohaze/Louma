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
      required: ["scope", "subject", "windowMs", "at", "identityKey", "expiresAt"],
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
