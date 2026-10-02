import type { Db } from "mongodb";

/** One backfill write touches at most this many documents, so startup never holds one unbounded op. */
const PARTICIPANT_BACKFILL_BATCH_SIZE = 500;

/** Same bound for the LMDG transition backfills below; those collections are far smaller. */
const LMDG_BACKFILL_BATCH_SIZE = 200;

/**
 * Wallets written by an earlier release have no `financialVersion` (or the custom-address fields),
 * while the validator requires them. Without this backfill a strict validator would reject
 * the first update to such a wallet — a custom-address change is the one that only touches the
 * address fields — leaving the account permanently unchangeable. One pipeline update sets every
 * missing field at once, so the resulting document satisfies the validator even on a database
 * where a stricter validator is already installed.
 */
export async function backfillWalletFields(db: Db): Promise<void> {
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
}

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
export async function backfillLeaseNetworks(db: Db): Promise<void> {
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
export async function migrateLegacyEnrollmentSlots(db: Db): Promise<void> {
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

/** Bounded scan size for the settlement migration: one settlement per settled window per cycle. */
const SETTLEMENT_MIGRATION_BATCH_SIZE = 200;

export interface SettlementMigrationOptions {
  /**
   * When true, nothing is written: each row is classified (would-insert / already-present /
   * mismatch) and reported. The standalone script defaults to this; writes require intent.
   */
  dryRun?: boolean;
}

export interface SettlementMigrationReport {
  dryRun: boolean;
  /** Legacy settlement rows seen. */
  settlements: number;
  /** Rows whose journal header already existed with matching financial fields. */
  alreadyMigrated: number;
  /** Headers created by this run. */
  inserted: number;
  /** Old mining headers that gained a `walletAccountId` (settlement-carried or derived). */
  backfilledWalletAccountId: number;
  /** Headers present but disagreeing on financial fields: manual review, never auto-fixed. */
  mismatchedPublicIds: string[];
  /** Settlement rows with no resolvable wallet account: header still written, account left null-marked. */
  unresolvableWalletAccountIds: string[];
}

/**
 * One-way migration: `mining_settlements` → `transactions` (see ADR-003).
 *
 * Each legacy settlement row becomes the journal header it always shadowed, under the SAME publicId
 * the settlement's ledger lines already reference — so no entry is rewritten and reconciliation
 * never sees an orphan. The migration is insert-if-missing keyed on that publicId: idempotent,
 * resumable, and safe under overlapping runs (a lost insert race re-reads the winner and verifies
 * it instead of failing). It never updates a financial field in place; a header that disagrees
 * with its settlement row is reported, not repaired.
 *
 * Mixed-version rollout is expected: an old process still writes both rows with the same publicId,
 * so "header already present" is the normal case, not a conflict. Old headers (and old
 * settlements) predate `walletAccountId`; it is backfilled from the settlement row, else derived
 * from the wallet's ledger account, so every header satisfies the tightened validator.
 */
export async function migrateMiningSettlementsToTransactions(db: Db, options: SettlementMigrationOptions = {}): Promise<SettlementMigrationReport> {
  const dryRun = options.dryRun === true;
  const settlements = db.collection("mining_settlements");
  const transactions = db.collection("transactions");
  const ledgerAccounts = db.collection("ledger_accounts");
  const report: SettlementMigrationReport = {
    dryRun,
    settlements: 0,
    alreadyMigrated: 0,
    inserted: 0,
    backfilledWalletAccountId: 0,
    mismatchedPublicIds: [],
    unresolvableWalletAccountIds: [],
  };

  const resolveWalletAccountId = async (walletId: string, fallback: unknown): Promise<string | null> => {
    if (typeof fallback === "string" && fallback.length > 0) return fallback;
    const account = await ledgerAccounts.findOne(
      { walletId, accountType: "wallet", currency: "LMA" },
      { projection: { publicId: 1 } },
    );
    const publicId = (account as { publicId?: unknown } | null)?.publicId;
    return typeof publicId === "string" ? publicId : null;
  };

  // `_id`-ordered paging: the legacy collection is write-frozen, but an old process mid-rollout
  // may still append rows; time-ordered ObjectIds keep the scan terminating and complete.
  let lastId: unknown = null;
  for (;;) {
    const filter: Record<string, unknown> = lastId === null ? {} : { _id: { $gt: lastId } };
    const batch = await settlements
      .find(filter, { sort: { _id: 1 } })
      .limit(SETTLEMENT_MIGRATION_BATCH_SIZE)
      .toArray();
    if (batch.length === 0) break;
    lastId = batch[batch.length - 1]?.["_id"] ?? null;
    for (const row of batch) {
      report.settlements += 1;
      const publicId = row["publicId"];
      if (typeof publicId !== "string" || publicId.length === 0) {
        report.mismatchedPublicIds.push(`<unreadable _id ${String(row["_id"])}>`);
        continue;
      }
      const header = await transactions.findOne({ publicId });
      const walletAccountId = await resolveWalletAccountId(row["walletId"] as string, row["walletAccountId"]);
      if (header) {
        const matches =
          header["type"] === "mining" &&
          header["miningSessionId"] === row["sessionPublicId"] &&
          header["sequenceNumber"] === row["sequenceNumber"] &&
          header["amountMinor"] === row["amountMinor"] &&
          header["ownerUserId"] === row["ownerUserId"] &&
          header["walletId"] === row["walletId"] &&
          header["idempotencyKey"] === row["idempotencyKey"];
        if (!matches) {
          report.mismatchedPublicIds.push(publicId);
          continue;
        }
        report.alreadyMigrated += 1;
        if (header["walletAccountId"] === undefined && walletAccountId) {
          // The ONLY in-place mutation this migration performs, guarded to headers that lack
          // the field: it fills a missing non-financial reference, never changes an amount,
          // a party, or a sequence. Skipped entirely in dry-run.
          if (!dryRun) {
            const updated = await transactions.updateOne({ publicId, walletAccountId: { $exists: false } }, { $set: { walletAccountId } });
            if (updated.modifiedCount === 1) report.backfilledWalletAccountId += 1;
          }
        } else if (header["walletAccountId"] === undefined) {
          report.unresolvableWalletAccountIds.push(publicId);
        }
        continue;
      }
      if (!walletAccountId) {
        // No header and no resolvable account: write the header with the settlement's own
        // account id when present, else record for manual review rather than inventing one.
        report.unresolvableWalletAccountIds.push(publicId);
        continue;
      }
      const createdAt = row["createdAt"] instanceof Date ? row["createdAt"] : new Date();
      if (dryRun) {
        report.inserted += 1;
        continue;
      }
      try {
        await transactions.insertOne({
          publicId,
          type: "mining",
          currency: "LMA",
          status: "completed",
          ownerUserId: row["ownerUserId"],
          walletId: row["walletId"],
          miningSessionId: row["sessionPublicId"],
          sequenceNumber: row["sequenceNumber"],
          amountMinor: row["amountMinor"],
          treasuryAccountId: row["treasuryAccountId"],
          walletAccountId,
          idempotencyKey: row["idempotencyKey"],
          correlationId: row["correlationId"],
          createdAt,
          completedAt: createdAt,
        });
        report.inserted += 1;
      } catch (error) {
        // A concurrent migrator (or a racing settlement) won the insert: verify the winner
        // instead of failing, exactly like the transfer path converges on the idempotency record.
        if ((error as { code?: unknown })?.code !== 11000) throw error;
        const winner = await transactions.findOne({ publicId });
        const matches =
          winner !== null &&
          winner["type"] === "mining" &&
          winner["miningSessionId"] === row["sessionPublicId"] &&
          winner["sequenceNumber"] === row["sequenceNumber"] &&
          winner["amountMinor"] === row["amountMinor"];
        if (!matches) report.mismatchedPublicIds.push(publicId);
        else report.alreadyMigrated += 1;
      }
    }
    if (batch.length < SETTLEMENT_MIGRATION_BATCH_SIZE) break;
  }

  // Headers written by the previous release predate `walletAccountId`: backfill them from the
  // wallet's ledger account. Bounded and idempotent; rows with no resolvable account are reported.
  for (;;) {
    const batch = await transactions
      .find({ type: "mining", walletAccountId: { $exists: false } }, { projection: { publicId: 1, walletId: 1 } })
      .limit(SETTLEMENT_MIGRATION_BATCH_SIZE)
      .toArray();
    if (batch.length === 0) break;
    for (const header of batch) {
      const walletId = header["walletId"];
      const account = typeof walletId === "string"
        ? await ledgerAccounts.findOne({ walletId, accountType: "wallet", currency: "LMA" }, { projection: { publicId: 1 } })
        : null;
      const accountPublicId = (account as { publicId?: unknown } | null)?.publicId;
      if (typeof accountPublicId !== "string") {
        report.unresolvableWalletAccountIds.push(header["publicId"] as string);
        continue;
      }
      if (dryRun) continue;
      const updated = await transactions.updateOne(
        { publicId: header["publicId"], walletAccountId: { $exists: false } },
        { $set: { walletAccountId: accountPublicId } },
      );
      if (updated.modifiedCount === 1) report.backfilledWalletAccountId += 1;
    }
    if (batch.length < SETTLEMENT_MIGRATION_BATCH_SIZE) break;
  }

  return report;
}

export async function backfillTransactionParticipants(db: Db): Promise<void> {
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
