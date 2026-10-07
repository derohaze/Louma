import { MongoServerError, type Db, type Document } from "mongodb";

export async function dropIndexIfExists(db: Db, collection: string, name: string): Promise<void> {
  try {
    await db.collection(collection).dropIndex(name);
  } catch (error) {
    // Another startup (or a previous run) already removed it.
    if (error instanceof MongoServerError && (error.code === 27 || error.codeName === "IndexNotFound")) return;
    throw error;
  }
}

export async function createIndexMigratingOptions(db: Db, collection: string, key: Document, options: Document): Promise<void> {
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

/**
 * Every index the API reads and writes through. Each one exists for a named query in the modules —
 * the comment says which — so an index without a comment is one whose query was removed and whose
 * definition should go with it.
 */
export async function ensureCoreIndexes(db: Db): Promise<void> {
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
    // The journal is the single home of mining issuance (see ADR-003): one header per reward.
    // The (cycle, sequence) pair is the real idempotency boundary of a reward — the compare-and-
    // set in settleSession converges concurrent attempts onto it — and this index is the
    // database-level statement of the same rule, so a second header for one sequence is refused
    // even if a future code path forgot the condition.
    db.collection("transactions").createIndex(
      { miningSessionId: 1, sequenceNumber: 1 },
      { unique: true, partialFilterExpression: { type: "mining" }, name: "transactions_mining_session_sequence_unique" },
    ),
    // Retry safety for settlement: the same `mining:<session>:<sequence>` key replays the posted
    // header instead of issuing twice. Scoped to mining headers, which are the only rows whose
    // idempotency key lives in the mining namespace.
    db.collection("transactions").createIndex(
      { idempotencyKey: 1 },
      { unique: true, partialFilterExpression: { type: "mining" }, name: "transactions_mining_idempotency_unique" },
    ),
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
    // 10h/24h quota window sums: membership is by stored anchor (`accountWindowStart` /
    // `deviceWindowStart` equality; anchors never move on stop/resume), with a `startedAt`
    // range fallback for pre-quota rows that carry no anchor. The device sum spans accounts
    // on one machine identity.
    // Migrating options: a database created by an earlier release holds this name over
    // `{ ownerUserId, accountWindowStart, startedAt }`, which conflicts with the anchor-equality
    // shape the quota sum actually queries (the `startedAt` range fallback has its own index
    // below). Replacing it keeps startup from wedging on every boot.
    createIndexMigratingOptions(db, "mining_sessions", { ownerUserId: 1, accountWindowStart: 1 }, { name: "mining_sessions_owner_quota_window" }),
    db.collection("mining_sessions").createIndex({ ownerUserId: 1, startedAt: 1 }, { name: "mining_sessions_owner_started" }),
    // Same migration as the account window above: an earlier release held this name over a key
    // that also carried `startedAt`.
    createIndexMigratingOptions(
      db,
      "mining_sessions",
      { deviceQuotaKey: 1, deviceWindowStart: 1 },
      { partialFilterExpression: { deviceQuotaKey: { $type: "string" } }, name: "mining_sessions_device_quota_window" },
    ),
    // LEGACY (see ADR-003): `mining_settlements` is no longer written — the journal header is the
    // authoritative record — but these indexes stay until the migration copies every legacy row
    // into `transactions` and the collection is dropped. Removing them first would leave the
    // un-migrated rows without their uniqueness guarantee during the migration window.
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
    // Backs the join race trim's bounded recency scan (`poolId` equality, `updatedAt`/`_id`
    // order, `ownerUserId` covered) so enforcing the cap never blocking-sorts the pool.
    db.collection("mining_pool_members").createIndex({ poolId: 1, updatedAt: 1, _id: 1, ownerUserId: 1 }, { name: "mining_pool_members_pool_recency" }),
    // A membership is a deadline: a join nobody started from, a cycle that ended, and a released
    // row kept only as the room-change throttle's anchor are all reaped once `expiresAt` passes.
    // No read depends on the sweep — every reader requires a live hold — so the documented TTL lag
    // can only leave an already-dead row on disk, never a membership.
    db.collection("mining_pool_members").createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0, name: "mining_pool_members_expires" }),
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
    // The same index serializes one non-resident cycle per network: a non-resident start takes the
    // reserved `net:` token as an extra lease key (see `networkLockKeyFor`), so two fresh identities
    // racing on one network cannot both pass the pre-transaction check and commit.
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
}
