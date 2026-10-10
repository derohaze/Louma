import argon2 from "argon2";
import { ObjectId, type ClientSession, type MongoClient } from "mongodb";
import { generateSecret, generateURI } from "otplib";
import type { AppConfig } from "../../config/env.js";
import type { Collections } from "../../infrastructure/mongodb/collections.js";
import { logAuditFailure, recordSecurityEvent } from "./audit.js";
import { decryptSecret, encryptSecret, generateRecoveryCodes, hashRecoveryCode } from "./crypto.js";
import { verifyTotpToken } from "./totp.js";
import { getWallet } from "../wallets/service.js";
import { badRequest, forbidden, conflict, notFound } from "../../shared/errors.js";
import { TOTP_PERIOD_SECONDS, TWO_FACTOR_USE_RETENTION_MS } from "../../shared/types.js";

const PENDING_2FA_TTL_MS = 5 * 60 * 1000;
/** A notification cursor is the previous page's `_id`, which is an ObjectId rendered as hex. */
const NOTIFICATION_CURSOR_PATTERN = /^[0-9a-f]{24}$/i;
const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_MAX_LENGTH = 128;
const ARGON2_OPTIONS = { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

async function verifyAccountPassword(collections: Collections, ownerUserId: string, password: unknown): Promise<string> {
  if (typeof password !== "string" || password.length > PASSWORD_MAX_LENGTH) throw forbidden("invalid_credentials", "The current password is incorrect.");
  const user = await collections.users.findOne({ publicId: ownerUserId }, { projection: { passwordHash: 1 } });
  if (!user || !(await argon2.verify(user.passwordHash, password).catch(() => false))) throw forbidden("invalid_credentials", "The current password is incorrect.");
  return user.passwordHash;
}

export async function proveMiningAccount(input: {
  collections: Collections; config: Pick<AppConfig, "encryptionKey">; ownerUserId: string; password: unknown; twoFactorCode?: string | undefined;
}) {
  const passwordHash = await verifyAccountPassword(input.collections, input.ownerUserId, input.password);
  const factor = await input.collections.twoFactorCredentials.findOne({ ownerUserId: input.ownerUserId, enabledAt: { $ne: null } });
  const proof = factor ? await proveTransferCredential({ ...input, password: undefined, twoFactorCode: input.twoFactorCode }) : null;
  return { passwordHash, factorEnabledAt: factor?.enabledAt ?? null, proof };
}

export async function consumeMiningAccountProof(input: {
  collections: Collections; ownerUserId: string; proof: Awaited<ReturnType<typeof proveMiningAccount>>;
  session: ClientSession; intentHash: string; correlationId: string;
}) {
  const user = await input.collections.users.findOne({ publicId: input.ownerUserId, passwordHash: input.proof.passwordHash }, { session: input.session, projection: { _id: 1 } });
  const factor = await input.collections.twoFactorCredentials.findOne({ ownerUserId: input.ownerUserId, enabledAt: { $ne: null } }, { session: input.session });
  if (!user || (factor?.enabledAt?.getTime() ?? null) !== (input.proof.factorEnabledAt?.getTime() ?? null)) throw forbidden("mining_account_verification_required", "Account security changed. Verify again.");
  if (input.proof.proof) await consumeTransferCredentialProof({ ...input, proof: input.proof.proof, purpose: "mining" });
}

async function verifyTotpOrRecovery(input: { config: Pick<AppConfig, "encryptionKey">; collections: Collections; ownerUserId: string; code: unknown }) {
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
 * Consumes the recovery code a verification used, so the same code cannot authorise a second action.
 * `false` (an authenticator code) has nothing to consume.
 */
async function consumeRecoveryCode(input: {
  collections: Collections;
  verification: { credential: { _id: ObjectId; recoveryCodeHashes: string[] }; remainingHashes: string[] };
}): Promise<void> {
  const updated = await input.collections.twoFactorCredentials.updateOne(
    { _id: input.verification.credential._id, recoveryCodeHashes: input.verification.credential.recoveryCodeHashes },
    { $set: { recoveryCodeHashes: input.verification.remainingHashes, updatedAt: new Date() } },
  );
  if (updated.modifiedCount !== 1) throw conflict("recovery_code_already_used", "That recovery code was already used.");
}

/**
 * The RFC 6238 step an accepted code belongs to. Derived from the server clock only: a client never
 * supplies or influences it, and it is what a consumed step is recorded against.
 */
export function totpTimeStep(nowMs: number): number {
  return Math.floor(nowMs / 1000 / TOTP_PERIOD_SECONDS);
}

/**
 * What one transfer request proved about its account's credentials, before any money moves.
 *
 * The proof is data, not a permission: it names the step (or recovery code) that still has to be
 * consumed inside the financial transaction. Nothing is written here, so a request that fails
 * afterwards — insufficient funds, a conflict, a lost connection before commit — leaves the
 * credential exactly as usable as it was.
 */
export type TransferCredentialProof =
  | { kind: "none"; passwordChangedAt: Date | null; twoFactorEnabledAt: null }
  | { kind: "password"; passwordChangedAt: Date | null; twoFactorEnabledAt: Date | null }
  | { kind: "totp"; timeStep: number; passwordChangedAt: Date | null; twoFactorEnabledAt: Date }
  | {
      kind: "recovery_code";
      credentialId: ObjectId;
      /** The exact set that was verified; the consume is conditional on it still being current. */
      verifiedHashes: string[];
      remainingHashes: string[];
      passwordChangedAt: Date | null;
      twoFactorEnabledAt: Date;
    };

/**
 * Proves whichever credential the account holds, without consuming anything.
 *
 * The two factors are alternatives, not a pair: an account that set a transfer password proves it;
 * an account with an authenticator proves a code from it; an account with both only has to prove one
 * — a stolen session still cannot move funds, and an owner who lost access to one credential is not
 * locked out of their own money. An account with neither has nothing to prove, which the caller
 * records as `none` rather than pretending a factor was checked.
 */
export async function proveTransferCredential(input: {
  collections: Collections;
  /** Absent only for direct (non-HTTP) callers; a second factor needs the key to read its secret. */
  config: Pick<AppConfig, "encryptionKey"> | undefined;
  ownerUserId: string;
  password: unknown;
  twoFactorCode: unknown;
}): Promise<TransferCredentialProof> {
  const [passwordCredential, twoFactorCredential] = await Promise.all([
    input.collections.transferPasswordCredentials.findOne({ ownerUserId: input.ownerUserId }),
    input.collections.twoFactorCredentials.findOne({ ownerUserId: input.ownerUserId, enabledAt: { $ne: null } }),
  ]);
  const passwordChangedAt = passwordCredential?.changedAt ?? null;
  const twoFactorEnabledAt = twoFactorCredential?.enabledAt ?? null;
  if (!passwordCredential && !twoFactorCredential) return { kind: "none", passwordChangedAt, twoFactorEnabledAt: null };
  if (
    passwordCredential &&
    typeof input.password === "string" &&
    input.password.length <= PASSWORD_MAX_LENGTH &&
    (await argon2.verify(passwordCredential.passwordHash, input.password).catch(() => false))
  ) {
    return { kind: "password", passwordChangedAt, twoFactorEnabledAt };
  }
  if (twoFactorCredential && twoFactorEnabledAt) {
    if (!input.config) throw new Error("Two-factor verification requires the encryption key");
    const secret = decryptSecret(
      { encryptedSecret: twoFactorCredential.encryptedSecret, iv: twoFactorCredential.secretIv, authTag: twoFactorCredential.secretAuthTag },
      input.config.encryptionKey,
    );
    if (typeof input.twoFactorCode === "string" && await verifyTotpToken(secret, input.twoFactorCode.trim())) {
      // The accepted step is recorded, not merely checked: consuming it inside the transfer's own
      // transaction is what stops the same code from authorising a second financial operation.
      return { kind: "totp", timeStep: totpTimeStep(Date.now()), passwordChangedAt, twoFactorEnabledAt };
    }
    if (typeof input.twoFactorCode === "string" && input.twoFactorCode.length <= 64) {
      const hash = hashRecoveryCode(input.twoFactorCode, input.config.encryptionKey);
      const index = twoFactorCredential.recoveryCodeHashes.indexOf(hash);
      if (index >= 0) {
        return {
          kind: "recovery_code",
          credentialId: twoFactorCredential._id,
          verifiedHashes: twoFactorCredential.recoveryCodeHashes,
          remainingHashes: twoFactorCredential.recoveryCodeHashes.filter((_, item) => item !== index),
          passwordChangedAt,
          twoFactorEnabledAt,
        };
      }
    }
    throw forbidden("invalid_two_factor_code", "The authenticator or recovery code is incorrect.");
  }
  throw forbidden("invalid_transfer_authorization", "Enter your transfer password or your authenticator code.");
}

/**
 * Consumes the proof inside the financial transaction that the proof authorises.
 *
 * Call this from inside `withTransaction`, next to the money writes. Two properties follow from
 * that placement, and both are required:
 *
 * - the consume rolls back with everything else, so a transfer that fails does not burn the code or
 *   the recovery code the owner just used, and the owner can retry with it;
 * - the consume is atomic with the money, so an accepted code can never authorise money that did not
 *   commit, and money can never move on a code that was not consumed.
 *
 * A duplicate on the step index is the database refusing a second financial operation for one
 * accepted code. It is surfaced as a product rejection, never retried: a retry would be exactly the
 * reuse this defends against.
 */
export async function consumeTransferCredentialProof(input: {
  purpose?: "transfer" | "mining";
  collections: Collections;
  proof: TransferCredentialProof;
  ownerUserId: string;
  intentHash: string;
  correlationId: string;
  session: ClientSession | undefined;
}): Promise<void> {
  if (input.proof.kind === "none" || input.proof.kind === "password") return;
  const now = new Date();
  if (input.proof.kind === "totp") {
    try {
      await input.collections.twoFactorUses.insertOne(
        {
          _id: new ObjectId(),
          ownerUserId: input.ownerUserId,
          purpose: input.purpose ?? "transfer",
          timeStep: input.proof.timeStep,
          intentHash: input.intentHash,
          correlationId: input.correlationId,
          createdAt: now,
          retainUntil: new Date(now.getTime() + TWO_FACTOR_USE_RETENTION_MS),
        },
        input.session ? { session: input.session } : {},
      );
    } catch (error) {
      if (typeof error === "object" && error !== null && (error as { code?: unknown }).code === 11000) {
        throw conflict("two_factor_code_already_used", "That authenticator code was already used. Wait for the next code.");
      }
      throw error;
    }
    return;
  }
  // A recovery code is single-use for the same reason, and the consume is conditional on the exact
  // set that was verified: a code invalidated by a regeneration in the meantime cannot still approve
  // a transfer.
  const updated = await input.collections.twoFactorCredentials.updateOne(
    { _id: input.proof.credentialId, enabledAt: { $ne: null }, recoveryCodeHashes: input.proof.verifiedHashes },
    { $set: { recoveryCodeHashes: input.proof.remainingHashes, updatedAt: now } },
    input.session ? { session: input.session } : {},
  );
  if (updated.modifiedCount !== 1) throw conflict("recovery_code_already_used", "That recovery code was already used.");
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
    await recordSecurityEvent({ collections: input.collections, ownerUserId: input.ownerUserId, eventType: "two_factor_setup_failed", outcome: "failure", correlationId: input.requestId }).catch((error: unknown) => logAuditFailure("two_factor_setup_failed", error));
    throw forbidden("invalid_two_factor_code", "That authenticator code is not valid.");
  }
  const recoveryCodes = generateRecoveryCodes();
  const result = await input.collections.twoFactorCredentials.updateOne(
    { _id: credential._id, enabledAt: null, pendingExpiresAt: { $gt: now } },
    { $set: { enabledAt: now, pendingExpiresAt: null, recoveryCodeHashes: recoveryCodes.map((code) => hashRecoveryCode(code, input.config.encryptionKey)), updatedAt: now } },
  );
  if (result.modifiedCount !== 1) throw conflict("two_factor_setup_expired", "Start two-factor setup again; the verification period expired.");
  await recordSecurityEvent({ collections: input.collections, ownerUserId: input.ownerUserId, eventType: "two_factor_enabled", outcome: "success", correlationId: input.requestId }).catch((error: unknown) => logAuditFailure("two_factor_enabled", error));
  return { enabledAt: now.toISOString(), recoveryCodes };
}

export async function disableTwoFactor(input: { collections: Collections; config: AppConfig; ownerUserId: string; password: unknown; code: unknown; requestId: string; mongoClient?: MongoClient }) {
  // Turning the factor off weakens the account, so it asks for both what the account knows (the
  // password) and what the account is (the authenticator or recovery code), not only the code.
  await verifyAccountPassword(input.collections, input.ownerUserId, input.password);
  const verification = await verifyTotpOrRecovery(input);
  if (!verification) throw forbidden("invalid_two_factor_code", "The authenticator or recovery code is incorrect.");
  // The delete is conditional on the recovery-code set that was verified: a code invalidated by a
  // regeneration in the meantime must not still authorise turning the second factor off.
  // The wallet's `financialVersion` is bumped in the same transaction (as in
  // setTransferPassword): a transfer holds a snapshot of this credential and compares it inside
  // its own transaction, so without the shared guard a TOTP-proven transfer could commit after
  // its factor was disabled here.
  const deleteFilter = { _id: verification.credential._id, enabledAt: { $ne: null }, recoveryCodeHashes: verification.credential.recoveryCodeHashes };
  if (input.mongoClient) {
    const session = input.mongoClient.startSession();
    try {
      await session.withTransaction(async () => {
        const result = await input.collections.twoFactorCredentials.deleteOne(deleteFilter as never, { session });
        if (result.deletedCount !== 1) throw conflict("two_factor_changed", "Two-factor authentication changed. Refresh and try again.");
        await input.collections.wallets.updateMany({ ownerUserId: input.ownerUserId }, { $inc: { financialVersion: 1 } }, { session });
      });
    } finally {
      await session.endSession();
    }
  } else {
    const result = await input.collections.twoFactorCredentials.deleteOne(deleteFilter as never);
    if (result.deletedCount !== 1) throw conflict("two_factor_changed", "Two-factor authentication changed. Refresh and try again.");
    await input.collections.wallets.updateMany({ ownerUserId: input.ownerUserId }, { $inc: { financialVersion: 1 } });
  }
  await recordSecurityEvent({ collections: input.collections, ownerUserId: input.ownerUserId, eventType: "two_factor_disabled", outcome: "success", correlationId: input.requestId, metadata: { recoveryCodeUsed: verification.recoveryCodeUsed } }).catch((error: unknown) => logAuditFailure("two_factor_disabled", error));
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
  // Non-fatal, and the most important place in this file for that: the old codes are already gone,
  // so an audit write that threw here would answer 500 and the caller would never receive the new
  // ones — a lockout manufactured by the audit trail.
  await recordSecurityEvent({ collections: input.collections, ownerUserId: input.ownerUserId, eventType: "recovery_codes_regenerated", outcome: "success", correlationId: input.requestId, metadata: { recoveryCodeUsed: verification.recoveryCodeUsed } }).catch((error: unknown) => logAuditFailure("recovery_codes_regenerated", error));
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
    if (recoveryCodeUsed) await consumeRecoveryCode({ collections: input.collections, verification });
  }
  await recordSecurityEvent({ collections: input.collections, ownerUserId: input.ownerUserId, eventType: input.action, outcome: "success", correlationId: input.requestId, metadata: { recoveryCodeUsed } }).catch((error: unknown) => logAuditFailure(input.action, error));
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
      await input.collections.wallets.updateMany(
        { ownerUserId: input.ownerUserId },
        { $inc: { financialVersion: 1 } },
        { session },
      );
    });
  } finally {
    await session.endSession();
  }
  await recordSecurityEvent({ collections: input.collections, ownerUserId: input.ownerUserId, eventType: existing ? "transfer_password_changed" : "transfer_password_set", outcome: "success", correlationId: input.requestId }).catch((error: unknown) => logAuditFailure(existing ? "transfer_password_changed" : "transfer_password_set", error));
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
    input.collections.notifications.find(filter, { projection: { _id: 1, kind: 1, title: 1, body: 1, data: 1, readAt: 1, createdAt: 1 } }).sort({ createdAt: -1, _id: -1 }).limit(pageSize + 1).toArray(),
    input.collections.notifications.countDocuments({ ownerUserId: input.ownerUserId, readAt: null }),
  ]);
  const hasMore = notifications.length > pageSize;
  const page = notifications.slice(0, pageSize);
  return { notifications: page.map((notification) => ({ id: String(notification._id), kind: notification.kind, title: notification.title, body: notification.body, data: notification.data ?? null, readAt: notification.readAt?.toISOString() ?? null, createdAt: notification.createdAt.toISOString() })), nextCursor: hasMore ? String(page.at(-1)?._id) : null, unread };
}
