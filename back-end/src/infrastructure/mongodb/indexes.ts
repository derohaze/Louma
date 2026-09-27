import { MongoServerError, type Db, type Document } from "mongodb";

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
      { $jsonSchema: { bsonType: "object", required: ["publicId", "address", "addressNormalized", "ownerUserId", "status", "createdAt", "updatedAt", "customAddressChangedAt", "customAddress", "customAddressNormalized"], properties: { publicId: { bsonType: "string" }, address: { bsonType: "string" }, addressNormalized: { bsonType: "string" }, ownerUserId: { bsonType: "string" }, status: { enum: ["active", "frozen"] }, createdAt: { bsonType: "date" }, updatedAt: { bsonType: "date" }, customAddressChangedAt: { bsonType: ["date", "null"] }, customAddress: { bsonType: ["string", "null"] }, customAddressNormalized: { bsonType: ["string", "null"] } } } },
      { balance: { $exists: false } },
    ],
  },
  ledger_accounts: {
    $jsonSchema: { bsonType: "object", required: ["publicId", "walletId", "accountType", "currency", "balanceMinor", "createdAt"], properties: { publicId: { bsonType: "string" }, walletId: { bsonType: ["string", "null"] }, accountType: { enum: ["wallet", "fee_revenue"] }, currency: { enum: ["LMA"] }, balanceMinor: { bsonType: "number", minimum: 0 }, createdAt: { bsonType: "date" } } },
  },
  ledger_entries: {
    $jsonSchema: { bsonType: "object", required: ["publicId", "transactionId", "lineNumber", "walletId", "ledgerAccountId", "side", "amountMinor", "currency", "correlationId", "createdAt"], properties: { publicId: { bsonType: "string" }, transactionId: { bsonType: "string" }, lineNumber: { bsonType: "int", minimum: 1 }, walletId: { bsonType: ["string", "null"] }, ledgerAccountId: { bsonType: "string" }, side: { enum: ["debit", "credit"] }, amountMinor: { bsonType: "number", minimum: 1 }, currency: { enum: ["LMA"] }, correlationId: { bsonType: "string" }, createdAt: { bsonType: "date" } } },
  },
  transactions: {
    $jsonSchema: { bsonType: "object", required: ["publicId", "transferId", "senderUserId", "receiverUserId", "senderWalletId", "receiverWalletId", "senderAddress", "receiverAddress", "amountMinor", "feeMinor", "netAmountMinor", "currency", "status", "type", "note", "idempotencyKey", "requestFingerprint", "balanceAfterMinor", "correlationId", "createdAt", "completedAt"], properties: { publicId: { bsonType: "string" }, transferId: { bsonType: "string" }, idempotencyKey: { bsonType: "string" }, requestFingerprint: { bsonType: "string" }, correlationId: { bsonType: "string" }, balanceAfterMinor: { bsonType: "number", minimum: 0 }, amountMinor: { bsonType: "number", minimum: 1 }, feeMinor: { bsonType: "number", minimum: 0 }, netAmountMinor: { bsonType: "number", minimum: 1 }, currency: { enum: ["LMA"] }, status: { enum: ["completed"] }, type: { enum: ["transfer"] }, createdAt: { bsonType: "date" }, completedAt: { bsonType: "date" } } },
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
  password_reset_tokens: {
    $jsonSchema: { bsonType: "object", required: ["ownerUserId", "tokenHash", "createdAt", "expiresAt", "usedAt"], properties: { ownerUserId: { bsonType: "string" }, tokenHash: { bsonType: "string" }, expiresAt: { bsonType: "date" } } },
  },
  notifications: {
    $jsonSchema: { bsonType: "object", required: ["ownerUserId", "kind", "title", "body", "readAt", "createdAt"], properties: { ownerUserId: { bsonType: "string" }, kind: { bsonType: "string" }, title: { bsonType: "string" }, body: { bsonType: "string" }, readAt: { bsonType: ["date", "null"] }, createdAt: { bsonType: "date" } } },
  },
};

async function ensureCollection(db: Db, name: string, validator: Document): Promise<void> {
  try {
    await db.createCollection(name, { validator, validationLevel: "strict", validationAction: "error" });
  } catch (error) {
    if (!(error instanceof MongoServerError) || error.code !== 48) throw error;
    await db.command({ collMod: name, validator, validationLevel: "strict", validationAction: "error" });
  }
}

export async function ensureDatabaseIndexes(db: Db): Promise<void> {
  for (const [name, validator] of Object.entries(schemas)) await ensureCollection(db, name, validator);

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
    db.collection("ledger_entries").createIndex({ publicId: 1 }, { unique: true, name: "ledger_entries_public_id_unique" }),
    db.collection("ledger_entries").createIndex({ transactionId: 1, lineNumber: 1 }, { unique: true, name: "ledger_entries_transaction_line_unique" }),
    db.collection("ledger_entries").createIndex({ ledgerAccountId: 1, createdAt: -1, publicId: -1 }, { name: "ledger_entries_account_history" }),
    db.collection("transactions").createIndex({ publicId: 1 }, { unique: true, name: "transactions_public_id_unique" }),
    db.collection("transactions").createIndex({ transferId: 1 }, { unique: true, name: "transactions_transfer_id_unique" }),
    db.collection("transactions").createIndex({ senderUserId: 1, idempotencyKey: 1 }, { unique: true, name: "transactions_idempotency_unique" }),
    db.collection("transactions").createIndex({ senderUserId: 1, createdAt: -1, publicId: -1 }, { name: "transactions_sender_history" }),
    db.collection("transactions").createIndex({ receiverUserId: 1, createdAt: -1, publicId: -1 }, { name: "transactions_receiver_history" }),
    db.collection("sessions").createIndex({ publicId: 1 }, { unique: true, name: "sessions_public_id_unique" }),
    db.collection("sessions").createIndex({ ownerUserId: 1, status: 1, lastActiveAt: -1 }, { name: "sessions_owner_active" }),
    db.collection("sessions").createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0, name: "sessions_expire_at" }),
    db.collection("security_events").createIndex({ publicId: 1 }, { unique: true, name: "security_events_public_id_unique" }),
    db.collection("security_events").createIndex({ ownerUserId: 1, createdAt: -1 }, { name: "security_events_owner_history" }),
    db.collection("two_factor_credentials").createIndex({ ownerUserId: 1 }, { unique: true, name: "two_factor_owner_unique" }),
    db.collection("transfer_password_credentials").createIndex({ ownerUserId: 1 }, { unique: true, name: "transfer_password_owner_unique" }),
    db.collection("password_reset_tokens").createIndex({ tokenHash: 1 }, { unique: true, name: "password_reset_hash_unique" }),
    db.collection("password_reset_tokens").createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0, name: "password_reset_expire_at" }),
    db.collection("notifications").createIndex({ ownerUserId: 1, createdAt: -1 }, { name: "notifications_owner_history" }),
  ]);
}
