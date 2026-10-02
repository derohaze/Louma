import { type Document } from "mongodb";
import { LEDGER_AMOUNT_MAX_MINOR, LEDGER_BALANCE_MAX_MINOR } from "../../shared/types.js";
import { MAX_CLUSTER_ALIASES, MAX_NETWORK_TRUSTS } from "../../modules/mining-device/policy.js";

/**
 * Collection validators expressed as MongoDB `$jsonSchema` documents.
 *
 * Each entry is keyed by collection name. The validator is the collection's
 * contract: a document that does not match is rejected at insert/update time
 * with `validationAction: "error"`, so no application code has to defend
 * against a shape the database already forbids.
 */
export const schemas: Record<string, Document> = {
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
        // Exactly the two parties: history pagination assumes a bounded pair, and an unbounded
        // array here would let one document grow with every addendum ever attached to it.
        participants: { bsonType: "array", minItems: 2, maxItems: 2, items: { bsonType: "string" } },
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
              properties: { type: { enum: ["transfer"] }, senderUserId: { bsonType: "string" }, receiverUserId: { bsonType: "string" }, senderWalletId: { bsonType: "string" }, receiverWalletId: { bsonType: "string" }, senderAddress: { bsonType: "string" }, receiverAddress: { bsonType: "string" }, note: { bsonType: "string", maxLength: 240 } },
            },
            {
              required: ["ownerUserId", "walletId", "miningSessionId", "sequenceNumber", "amountMinor", "treasuryAccountId", "walletAccountId", "idempotencyKey"],
              properties: { type: { enum: ["mining"] }, ownerUserId: { bsonType: "string" }, walletId: { bsonType: "string" }, miningSessionId: { bsonType: "string" }, sequenceNumber: { bsonType: "int", minimum: 1 }, treasuryAccountId: { bsonType: "string" }, walletAccountId: { bsonType: "string" } },
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
    // `metadata` is a small fixed-shape diagnostic bag (every writer passes at most a handful of
    // scalar keys); the bound keeps one event from becoming a log sink that grows a document.
    $jsonSchema: { bsonType: "object", required: ["publicId", "ownerUserId", "sessionId", "eventType", "outcome", "metadata", "correlationId", "createdAt"], properties: { publicId: { bsonType: "string" }, ownerUserId: { bsonType: ["string", "null"] }, sessionId: { bsonType: ["string", "null"] }, eventType: { bsonType: "string" }, outcome: { enum: ["success", "failure"] }, metadata: { bsonType: "object", maxProperties: 16 }, correlationId: { bsonType: "string" }, createdAt: { bsonType: "date" } } },
  },
  two_factor_credentials: {
    $jsonSchema: { bsonType: "object", required: ["ownerUserId", "encryptedSecret", "secretIv", "secretAuthTag", "pendingExpiresAt", "enabledAt", "recoveryCodeHashes", "createdAt", "updatedAt"], properties: { ownerUserId: { bsonType: "string" }, encryptedSecret: { bsonType: "string" }, secretIv: { bsonType: "string" }, secretAuthTag: { bsonType: "string" }, pendingExpiresAt: { bsonType: ["date", "null"] }, enabledAt: { bsonType: ["date", "null"] }, recoveryCodeHashes: { bsonType: "array", maxItems: 16, items: { bsonType: "string", maxLength: 128 } } } },
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
            note: { bsonType: "string", maxLength: 240 },
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
    // Titles and bodies are server-rendered one-liners (amounts, addresses); the bounds keep a
    // notification a notice, never a payload sink. New kinds must fit inside them.
    $jsonSchema: { bsonType: "object", required: ["ownerUserId", "kind", "title", "body", "readAt", "createdAt"], properties: { ownerUserId: { bsonType: "string" }, kind: { bsonType: "string", maxLength: 64 }, title: { bsonType: "string", maxLength: 120 }, body: { bsonType: "string", maxLength: 1000 }, readAt: { bsonType: ["date", "null"] }, createdAt: { bsonType: "date" } } },
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
        // Learned digest history per feature key. Keys come from the fixed server-side signal
        // vocabulary (see normalizeSignals, ~40 keys) and each ring holds at most
        // MAX_FEATURE_VALUES digests — the database states the same bound the code enforces,
        // so a document can never grow toward the 16 MiB BSON limit no matter the input.
        featureProfile: {
          bsonType: ["object", "null"],
          maxProperties: 64,
          additionalProperties: {
            bsonType: "object",
            required: ["digests", "count"],
            properties: {
              digests: { bsonType: "array", maxItems: 5, items: { bsonType: "string", maxLength: 128 } },
              count: { bsonType: ["int", "long", "double"], minimum: 0 },
              drift: { bsonType: "array", maxItems: 5, items: { bsonType: "string", maxLength: 128 } },
            },
          },
        },
        machineFeatureProfile: {
          bsonType: ["object", "null"],
          maxProperties: 64,
          additionalProperties: {
            bsonType: "object",
            required: ["digests", "count"],
            properties: {
              digests: { bsonType: "array", maxItems: 5, items: { bsonType: "string", maxLength: 128 } },
              count: { bsonType: ["int", "long", "double"], minimum: 0 },
              drift: { bsonType: "array", maxItems: 5, items: { bsonType: "string", maxLength: 128 } },
            },
          },
        },
        // Latest normalized observation snapshot: one value per known signal key, same vocabulary.
        featureSnapshot: { bsonType: ["object", "null"], maxProperties: 64 },
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
