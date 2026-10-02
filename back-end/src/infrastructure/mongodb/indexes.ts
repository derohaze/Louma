import { type Db } from "mongodb";
import { ensureCollection } from "./validators.js";
import {
  backfillLeaseNetworks,
  backfillTransactionParticipants,
  backfillWalletFields,
  migrateLegacyEnrollmentSlots,
  migrateMiningSettlementsToTransactions,
} from "./backfills.js";
import { createIndexMigratingOptions, dropIndexIfExists, ensureCoreIndexes } from "./definitions.js";
import { schemas } from "./schemas.js";

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
const DAY_SECONDS = 24 * 60 * 60;

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

export async function ensureDatabaseIndexes(db: Db, options: EnsureDatabaseIndexesOptions = {}): Promise<void> {
  await backfillWalletFields(db);

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

  await ensureCoreIndexes(db);

  // Settlement → journal migration (see ADR-003). Runs after the validators and the new journal
  // uniqueness indexes exist: inserted headers must satisfy the tightened validator, and the
  // unique indexes are what make overlapping migrators converge instead of duplicating. Bounded,
  // idempotent and insert-only — a second instance starting at the same time re-verifies rather
  // than duplicating. Mismatches are logged, never auto-fixed; the operator runs the
  // `migrate:mining-settlements` script for the full verification report.
  const settlementMigration = await migrateMiningSettlementsToTransactions(db);
  if (settlementMigration.mismatchedPublicIds.length > 0 || settlementMigration.unresolvableWalletAccountIds.length > 0) {
    console.warn(
      `[migration] mining_settlements→transactions needs review: ` +
        `${settlementMigration.mismatchedPublicIds.length} mismatched, ` +
        `${settlementMigration.unresolvableWalletAccountIds.length} without a wallet account ` +
        `(see docs/migrations.md; run npm run migrate:mining-settlements for detail)`,
    );
  }

  if (options.retentionTtlEnabled) {
    // Unread notices are never eligible for expiry: only a notice the customer has seen
    // (`readAt` set) may age out. Expiring unread notices would silently delete information
    // the customer was never shown.
    await createIndexMigratingOptions(db, "notifications", { createdAt: 1 }, { expireAfterSeconds: NOTIFICATION_RETENTION_DAYS * DAY_SECONDS, name: "notifications_retain", partialFilterExpression: { readAt: { $type: "date" } } });
    await createIndexMigratingOptions(db, "security_events", { createdAt: 1 }, { expireAfterSeconds: SECURITY_EVENT_RETENTION_DAYS * DAY_SECONDS, name: "security_events_retain" });
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
