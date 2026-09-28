import argon2 from "argon2";
import { ObjectId, type MongoClient } from "mongodb";
import { generateSecret, generateURI } from "otplib";
import type { AppConfig } from "../../config/env.js";
import type { Collections } from "../../infrastructure/mongodb/collections.js";
import { recordSecurityEvent } from "./audit.js";
import { decryptSecret, encryptSecret, generateRecoveryCodes, hashRecoveryCode } from "./crypto.js";
import { verifyTotpToken } from "./totp.js";
import { getWallet } from "../wallets/service.js";
import { badRequest, forbidden, conflict, notFound } from "../../shared/errors.js";

const PENDING_2FA_TTL_MS = 5 * 60 * 1000;
/** A notification cursor is the previous page's `_id`, which is an ObjectId rendered as hex. */
const NOTIFICATION_CURSOR_PATTERN = /^[0-9a-f]{24}$/i;
const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_MAX_LENGTH = 128;
const ARGON2_OPTIONS = { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

async function verifyAccountPassword(collections: Collections, ownerUserId: string, password: unknown): Promise<void> {
  if (typeof password !== "string" || password.length > PASSWORD_MAX_LENGTH) throw forbidden("invalid_credentials", "The current password is incorrect.");
  const user = await collections.users.findOne({ publicId: ownerUserId }, { projection: { passwordHash: 1 } });
  if (!user || !(await argon2.verify(user.passwordHash, password).catch(() => false))) throw forbidden("invalid_credentials", "The current password is incorrect.");
}

async function verifyTotpOrRecovery(input: { config: AppConfig; collections: Collections; ownerUserId: string; code: unknown }) {
  if (typeof input.code !== "string" || input.code.length > 64) return false;
  const credential = await input.collections.twoFactorCredentials.findOne({ ownerUserId: input.ownerUserId, enabledAt: { $ne: null } });
  if (!credential) return false;
  const secret = decryptSecret({ encryptedSecret: credential.encryptedSecret, iv: credential.secretIv, authTag: credential.secretAuthTag }, input.config.encryptionKey);
  if (await verifyTotpToken(secret, input.code.trim())) {
    return { credential, remainingHashes: credential.recoveryCodeHashes, recoveryCodeUsed: false };
  }
  const hash = hashRecoveryCode(input.code, input.config.encryptionKey);
  const index = credential.recoveryCodeHashes.indexOf(hash);
  if (index < 0) return false;
  return { credential, remainingHashes: credential.recoveryCodeHashes.filter((_, item) => item !== index), recoveryCodeUsed: true };
}

/**
 * Starts enrolment. The account password is required even though the caller already holds an
 * authenticated session: without it a stolen session could bind an authenticator the owner does not
 * hold, and that factor would outlive the session it was added from. The password is not the final
 * proof — the setup only counts once the new authenticator answers with a code — but it is what
 * stops a session alone from enrolling a device.
 */
export async function beginTwoFactorSetup(input: { collections: Collections; config: AppConfig; ownerUserId: string; password: unknown }) {
  await verifyAccountPassword(input.collections, input.ownerUserId, input.password);
  const current = await input.collections.twoFactorCredentials.findOne({ ownerUserId: input.ownerUserId });
  if (current?.enabledAt) throw conflict("two_factor_already_enabled", "Two-factor authentication is already enabled.");

  const secret = generateSecret();
  const encrypted = encryptSecret(secret, input.config.encryptionKey);
  const now = new Date();
  const credential = {
    ownerUserId: input.ownerUserId,
    encryptedSecret: encrypted.encryptedSecret,
    secretIv: encrypted.iv,
    secretAuthTag: encrypted.authTag,
    pendingExpiresAt: new Date(now.getTime() + PENDING_2FA_TTL_MS),
    enabledAt: null,
    recoveryCodeHashes: [],
    createdAt: current?.createdAt ?? now,
    updatedAt: now,
  };
  try {
    await input.collections.twoFactorCredentials.updateOne(
      { ownerUserId: input.ownerUserId, enabledAt: null },
      { $set: credential },
      { upsert: !current },
    );
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === 11000) throw conflict("two_factor_already_enabled", "Two-factor authentication changed. Refresh and try again.");
    throw error;
  }
  const uri = generateURI({ issuer: "Louma", label: input.ownerUserId, secret });
  return { secret, otpauthUri: uri, expiresAt: credential.pendingExpiresAt.toISOString() };
}

export async function confirmTwoFactorSetup(input: { collections: Collections; config: AppConfig; ownerUserId: string; code: unknown; requestId: string }) {
  if (typeof input.code !== "string" || !/^\d{6}$/.test(input.code)) throw forbidden("invalid_two_factor_code", "Enter a valid six-digit authenticator code.");
  const now = new Date();
  const credential = await input.collections.twoFactorCredentials.findOne({ ownerUserId: input.ownerUserId, enabledAt: null, pendingExpiresAt: { $gt: now } });
  if (!credential) throw conflict("two_factor_setup_expired", "Start two-factor setup again; the verification period expired.");
  const secret = decryptSecret({ encryptedSecret: credential.encryptedSecret, iv: credential.secretIv, authTag: credential.secretAuthTag }, input.config.encryptionKey);
  if (!(await verifyTotpToken(secret, input.code))) {
    await recordSecurityEvent({ collections: input.collections, ownerUserId: input.ownerUserId, eventType: "two_factor_setup_failed", outcome: "failure", correlationId: input.requestId });
    throw forbidden("invalid_two_factor_code", "That authenticator code is not valid.");
  }
  const recoveryCodes = generateRecoveryCodes();
  const result = await input.collections.twoFactorCredentials.updateOne(
    { _id: credential._id, enabledAt: null, pendingExpiresAt: { $gt: now } },
    { $set: { enabledAt: now, pendingExpiresAt: null, recoveryCodeHashes: recoveryCodes.map((code) => hashRecoveryCode(code, input.config.encryptionKey)), updatedAt: now } },
  );
  if (result.modifiedCount !== 1) throw conflict("two_factor_setup_expired", "Start two-factor setup again; the verification period expired.");
  await recordSecurityEvent({ collections: input.collections, ownerUserId: input.ownerUserId, eventType: "two_factor_enabled", outcome: "success", correlationId: input.requestId });
  return { enabledAt: now.toISOString(), recoveryCodes };
}

export async function disableTwoFactor(input: { collections: Collections; config: AppConfig; ownerUserId: string; password: unknown; code: unknown; requestId: string }) {
  // Turning the factor off weakens the account, so it asks for both what the account knows (the
  // password) and what the account is (the authenticator or recovery code), not only the code.
  await verifyAccountPassword(input.collections, input.ownerUserId, input.password);
  const verification = await verifyTotpOrRecovery(input);
  if (!verification) throw forbidden("invalid_two_factor_code", "The authenticator or recovery code is incorrect.");
  // The delete is conditional on the recovery-code set that was verified: a code invalidated by a
  // regeneration in the meantime must not still authorise turning the second factor off.
  const result = await input.collections.twoFactorCredentials.deleteOne({ _id: verification.credential._id, enabledAt: { $ne: null }, recoveryCodeHashes: verification.credential.recoveryCodeHashes });
  if (result.deletedCount !== 1) throw conflict("two_factor_changed", "Two-factor authentication changed. Refresh and try again.");
  await recordSecurityEvent({ collections: input.collections, ownerUserId: input.ownerUserId, eventType: "two_factor_disabled", outcome: "success", correlationId: input.requestId, metadata: { recoveryCodeUsed: verification.recoveryCodeUsed } });
  return { enabled: false };
}

export async function regenerateRecoveryCodes(input: { collections: Collections; config: AppConfig; ownerUserId: string; password: unknown; code: unknown; requestId: string }) {
  // Replacing every recovery code is the same class of change as disabling the factor, so it is
  // gated the same way: the account password plus a current authenticator or recovery code.
  await verifyAccountPassword(input.collections, input.ownerUserId, input.password);
  const verification = await verifyTotpOrRecovery(input);
  if (!verification) throw forbidden("invalid_two_factor_code", "The authenticator or recovery code is incorrect.");
  const recoveryCodes = generateRecoveryCodes();
  const result = await input.collections.twoFactorCredentials.updateOne(
    { _id: verification.credential._id, recoveryCodeHashes: verification.credential.recoveryCodeHashes, enabledAt: { $ne: null } },
    { $set: { recoveryCodeHashes: recoveryCodes.map((code) => hashRecoveryCode(code, input.config.encryptionKey)), updatedAt: new Date() } },
  );
  if (result.modifiedCount !== 1) throw conflict("two_factor_changed", "Two-factor authentication changed. Refresh and try again.");
  await recordSecurityEvent({ collections: input.collections, ownerUserId: input.ownerUserId, eventType: "recovery_codes_regenerated", outcome: "success", correlationId: input.requestId, metadata: { recoveryCodeUsed: verification.recoveryCodeUsed } });
  return { recoveryCodes };
}

export async function verifySensitiveAction(input: { collections: Collections; config: AppConfig; ownerUserId: string; password: unknown; code?: unknown; requestId: string; action: string }): Promise<void> {
  await verifyAccountPassword(input.collections, input.ownerUserId, input.password);
  const twoFactor = await input.collections.twoFactorCredentials.findOne({ ownerUserId: input.ownerUserId, enabledAt: { $ne: null } });
  let recoveryCodeUsed = false;
  if (twoFactor) {
    const verification = await verifyTotpOrRecovery({ collections: input.collections, config: input.config, ownerUserId: input.ownerUserId, code: input.code });
    if (!verification) throw forbidden("invalid_two_factor_code", "The authenticator or recovery code is incorrect.");
    recoveryCodeUsed = verification.recoveryCodeUsed;
    if (recoveryCodeUsed) {
      const updated = await input.collections.twoFactorCredentials.updateOne(
        { _id: verification.credential._id, recoveryCodeHashes: verification.credential.recoveryCodeHashes },
        { $set: { recoveryCodeHashes: verification.remainingHashes, updatedAt: new Date() } },
      );
      if (updated.modifiedCount !== 1) throw conflict("recovery_code_already_used", "That recovery code was already used.");
    }
  }
  await recordSecurityEvent({ collections: input.collections, ownerUserId: input.ownerUserId, eventType: input.action, outcome: "success", correlationId: input.requestId, metadata: { recoveryCodeUsed } });
}

export async function setTransferPassword(input: { collections: Collections; mongoClient: MongoClient; ownerUserId: string; currentPassword: unknown; newPassword: unknown; requestId: string }) {
  if (typeof input.newPassword !== "string" || input.newPassword.length < PASSWORD_MIN_LENGTH || input.newPassword.length > PASSWORD_MAX_LENGTH || !/[A-Za-z]/.test(input.newPassword) || !/\d/.test(input.newPassword)) {
    throw badRequest("weak_password", "Use at least 8 characters, including a letter and a number.");
  }
  const existing = await input.collections.transferPasswordCredentials.findOne({ ownerUserId: input.ownerUserId });
  if (existing) {
    if (typeof input.currentPassword !== "string" || !(await argon2.verify(existing.passwordHash, input.currentPassword).catch(() => false))) {
      throw forbidden("invalid_transfer_password", "The current transfer password is incorrect.");
    }
  }
  const now = new Date();
  const passwordHash = await argon2.hash(input.newPassword, ARGON2_OPTIONS);
  /**
   * The credential write stays conditional on the one that was just verified, so two requests that
   * both checked the old password cannot both replace it. On its own that is not enough: a transfer
   * holds a snapshot of this credential and never writes it, so a change landing mid-flight would not
   * conflict with the transfer and it could settle under the credential that was just replaced.
   * Bumping the wallet's `financialVersion` in the same transaction closes that hole — the transfer
   * already increments that field as its guard, so the two serialize and the transfer retries, re-reads
   * the credential from a fresh snapshot, and refuses to commit under the changed password.
   */
  const session = input.mongoClient.startSession();
  try {
    await session.withTransaction(async () => {
      const result = existing
        ? await input.collections.transferPasswordCredentials.updateOne(
            { ownerUserId: input.ownerUserId, passwordHash: existing.passwordHash, changedAt: existing.changedAt },
            { $set: { passwordHash, changedAt: now } },
            { session },
          )
        : await input.collections.transferPasswordCredentials.updateOne(
            { ownerUserId: input.ownerUserId },
            { $setOnInsert: { ownerUserId: input.ownerUserId, passwordHash, changedAt: now } },
            { upsert: true, session },
          );
      const applied = existing ? result.modifiedCount === 1 : Boolean(result.upsertedId);
      if (!applied) throw conflict("transfer_password_changed", "The transfer password changed. Try again.");
      await input.collections.wallets.updateOne(
        { ownerUserId: input.ownerUserId },
        { $inc: { financialVersion: 1 } },
        { session },
      );
    });
  } finally {
    await session.endSession();
  }
  await recordSecurityEvent({ collections: input.collections, ownerUserId: input.ownerUserId, eventType: existing ? "transfer_password_changed" : "transfer_password_set", outcome: "success", correlationId: input.requestId });
  return { enabled: true, changedAt: now.toISOString() };
}

export async function getSecurityOverview(input: { collections: Collections; config: AppConfig; ownerUserId: string }) {
  const [wallet, twoFactor, transferPassword, sessions, events] = await Promise.all([
    getWallet(input),
    input.collections.twoFactorCredentials.findOne({ ownerUserId: input.ownerUserId, enabledAt: { $ne: null } }, { projection: { enabledAt: 1, recoveryCodeHashes: 1 } }),
    input.collections.transferPasswordCredentials.findOne({ ownerUserId: input.ownerUserId }, { projection: { changedAt: 1 } }),
    input.collections.sessions.countDocuments({ ownerUserId: input.ownerUserId, status: "active", expiresAt: { $gt: new Date() } }),
    input.collections.securityEvents.find({ ownerUserId: input.ownerUserId }, { projection: { _id: 0, publicId: 1, eventType: 1, outcome: 1, metadata: 1, createdAt: 1 } }).sort({ createdAt: -1 }).limit(50).toArray(),
  ]);
  return {
    wallet: { status: wallet.status },
    twoFactor: { enabled: Boolean(twoFactor), enabledAt: twoFactor?.enabledAt?.toISOString() ?? null, recoveryCodesRemaining: twoFactor?.recoveryCodeHashes.length ?? 0 },
    transferPassword: { enabled: Boolean(transferPassword), changedAt: transferPassword?.changedAt.toISOString() ?? null },
    activeSessions: sessions,
    events: events.map((event) => ({ id: event.publicId, type: event.eventType, outcome: event.outcome, createdAt: event.createdAt.toISOString() })),
  };
}

/**
 * Marks notifications as read. With `ids` only those are touched; without it every unread
 * notification of the caller is. The filter is scoped to the owner and to `readAt: null`, so a
 * caller cannot read someone else's notice and a repeat call changes nothing.
 */
export async function markNotificationsRead(input: { collections: Collections; ownerUserId: string; ids: string[] | undefined }) {
  const filter: Record<string, unknown> = { ownerUserId: input.ownerUserId, readAt: null };
  if (input.ids) filter["_id"] = { $in: input.ids.map((id) => ObjectId.createFromHexString(id)) };
  const now = new Date();
  const result = await input.collections.notifications.updateMany(filter, { $set: { readAt: now } });
  const unread = await input.collections.notifications.countDocuments({ ownerUserId: input.ownerUserId, readAt: null });
  return { read: result.modifiedCount, unread, readAt: now.toISOString() };
}

export async function listNotifications(input: { collections: Collections; ownerUserId: string; cursor: string | undefined; limit: number }) {
  const pageSize = Math.min(Math.max(input.limit, 1), 50);
  const filter: Record<string, unknown> = { ownerUserId: input.ownerUserId };
  if (input.cursor) {
    // The cursor travels as a string over HTTP while `_id` is an ObjectId: it has to be converted
    // back before it can match a document, or every page after the first answers 404.
    if (!NOTIFICATION_CURSOR_PATTERN.test(input.cursor)) throw notFound();
    const cursor = await input.collections.notifications.findOne({ ownerUserId: input.ownerUserId, _id: ObjectId.createFromHexString(input.cursor) });
    if (!cursor) throw notFound();
    // A transfer notifies both sides in the same instant, so two notices regularly share a
    // millisecond: the cursor is the pair (createdAt, _id), because filtering on the timestamp
    // alone would skip every remaining notice from that millisecond.
    filter["$and"] = [
      { ownerUserId: input.ownerUserId },
      { $or: [{ createdAt: { $lt: cursor.createdAt } }, { createdAt: cursor.createdAt, _id: { $lt: cursor._id } }] },
    ];
  }
  // `unread` counts the whole account, not the page: a badge derived from the twenty notifications
  // a client happens to have loaded would silently under-report and never reach zero.
  const [notifications, unread] = await Promise.all([
    input.collections.notifications.find(filter, { projection: { _id: 1, kind: 1, title: 1, body: 1, readAt: 1, createdAt: 1 } }).sort({ createdAt: -1, _id: -1 }).limit(pageSize + 1).toArray(),
    input.collections.notifications.countDocuments({ ownerUserId: input.ownerUserId, readAt: null }),
  ]);
  const hasMore = notifications.length > pageSize;
  const page = notifications.slice(0, pageSize);
  return { notifications: page.map((notification) => ({ id: String(notification._id), kind: notification.kind, title: notification.title, body: notification.body, readAt: notification.readAt?.toISOString() ?? null, createdAt: notification.createdAt.toISOString() })), nextCursor: hasMore ? String(page.at(-1)?._id) : null, unread };
}
