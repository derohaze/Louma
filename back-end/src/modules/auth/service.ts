import { randomBytes, randomUUID } from "node:crypto";
import argon2 from "argon2";
import type { MongoClient } from "mongodb";
import type { AppConfig } from "../../config/env.js";
import type { Collections } from "../../infrastructure/mongodb/collections.js";
import type { RedisHandle } from "../../infrastructure/redis/client.js";
import { displayNameKey, invalidate } from "../../infrastructure/redis/cache.js";
import { recordSecurityEvent } from "../security/audit.js";
import { createAccessToken, verifyAccessToken } from "../security/access-token.js";
import { createOpaqueToken, decryptSecret, hashRecoveryCode, hashToken } from "../security/crypto.js";
import { verifyTotpToken } from "../security/totp.js";
import { formatMoney } from "../ledger/money.js";
import { isPublicIp, lookupIpLocation, type IpLocation } from "../geo/ipinfo.js";
import {
  ACCESS_TOKEN_TTL_SECONDS,
  PENDING_2FA_TTL_MS,
  REFRESH_TOKEN_TTL_MS,
  type PublicUser,
  type SessionRecord,
  type SignupLocation,
  type UserRecord,
  type WalletRecord,
} from "../../shared/types.js";
import { badRequest, conflict, forbidden, notFound, unauthorized } from "../../shared/errors.js";

const EMAIL_MAX_LENGTH = 254;
const DISPLAY_NAME_MAX_LENGTH = 32;
const PASSWORD_MAX_LENGTH = 128;
const PASSWORD_MIN_LENGTH = 8;
const ARGON2_OPTIONS = { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;
let dummyPasswordHash: Promise<string> | null = null;
/**
 * A refresh token that is exactly one rotation old is either a second tab racing the first (both
 * send the cookie they read before either rotation landed) or a token that leaked. Inside this
 * window the rotation is served normally; outside it the token counts as stolen and the whole
 * account is signed out — which is what reuse detection exists for.
 */
const REFRESH_REUSE_GRACE_MS = 30_000;

function getDummyPasswordHash(): Promise<string> {
  dummyPasswordHash ??= argon2.hash(randomBytes(32).toString("hex"), ARGON2_OPTIONS);
  return dummyPasswordHash;
}

function normalizeEmail(input: unknown): string {
  if (typeof input !== "string" || input.length > EMAIL_MAX_LENGTH) throw badRequest("invalid_email", "Enter a valid email address.");
  const email = input.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw badRequest("invalid_email", "Enter a valid email address.");
  return email;
}

function validatePassword(input: unknown): asserts input is string {
  if (typeof input !== "string" || input.length < PASSWORD_MIN_LENGTH || input.length > PASSWORD_MAX_LENGTH || !/[A-Za-z]/.test(input) || !/\d/.test(input)) {
    throw badRequest("weak_password", "Use at least 8 characters, including a letter and a number.");
  }
}

function toPublicUser(user: UserRecord): PublicUser {
  return {
    id: user.publicId,
    email: user.email,
    displayName: user.profile.displayName,
    country: user.profile.country,
    emailVerifiedAt: user.emailVerifiedAt?.toISOString() ?? null,
    createdAt: user.createdAt.toISOString(),
  };
}

function safeUserAgent(value: string | undefined): string | null {
  return value ? value.slice(0, 256) : null;
}

async function issueSession(input: {
  collections: Collections;
  config: AppConfig;
  user: UserRecord;
  requestId: string;
  userAgent: string | undefined;
  status?: "active" | "pending_two_factor";
}): Promise<{ user: PublicUser; accessToken: string | null; refreshToken: string; accessTokenTtlSeconds: number; sessionId: string }> {
  const sessionId = randomUUID();
  const refreshToken = createOpaqueToken();
  const now = new Date();
  const session = {
    publicId: sessionId,
    ownerUserId: input.user.publicId,
    refreshTokenHash: hashToken(refreshToken),
    previousRefreshTokenHash: null,
    status: input.status ?? "active",
    twoFactorAttempts: 0,
    userAgent: safeUserAgent(input.userAgent),
    createdAt: now,
    lastActiveAt: now,
    // A pending two-factor session lives for the challenge window, not for the 30 days a real
    // session gets: it holds no usable credentials, and a stale one would only be a way back in.
    expiresAt: new Date(now.getTime() + (input.status === "pending_two_factor" ? PENDING_2FA_TTL_MS : REFRESH_TOKEN_TTL_MS)),
    revokedAt: null,
  } satisfies Omit<SessionRecord, "_id">;
  await input.collections.sessions.insertOne(session as SessionRecord);
  const accessToken = session.status === "active"
    ? await createAccessToken({ userId: input.user.publicId, sessionId }, input.config.accessTokenSecret)
    : null;
  await recordSecurityEvent({ collections: input.collections, ownerUserId: input.user.publicId, sessionId, eventType: session.status === "active" ? "login" : "login_pending_two_factor", outcome: "success", correlationId: input.requestId });
  return { user: toPublicUser(input.user), accessToken, refreshToken, accessTokenTtlSeconds: ACCESS_TOKEN_TTL_SECONDS, sessionId };
}

export async function register(input: {
  collections: Collections;
  mongoClient: MongoClient;
  config: AppConfig;
  email: unknown;
  password: unknown;
  displayName: unknown;
  requestId: string;
  userAgent: string | undefined;
  /** The address the request came from, as Fastify resolved it (see `trustProxy` in config/env.ts). */
  ipAddress: string;
}): Promise<Awaited<ReturnType<typeof issueSession>> & { wallet: { id: string; address: string } }> {
  const email = normalizeEmail(input.email);
  validatePassword(input.password);
  const displayName = typeof input.displayName === "string" ? input.displayName.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, DISPLAY_NAME_MAX_LENGTH) : "";
  if (!displayName) throw badRequest("invalid_display_name", "Enter your name.");

  const now = new Date();
  const user = {
    publicId: randomUUID(),
    email,
    passwordHash: await argon2.hash(input.password, ARGON2_OPTIONS),
    profile: { displayName, country: null },
    // Stored as it arrives, before any third party is asked anything: the address is the part of
    // "where did this account come from" that must never depend on a lookup being up.
    signupLocation: { ipAddress: input.ipAddress, city: null, region: null, country: null, org: null, timezone: null, capturedAt: now, resolvedAt: null } satisfies SignupLocation,
    status: "active",
    emailVerifiedAt: null,
    createdAt: now,
    updatedAt: now,
  } satisfies Omit<UserRecord, "_id">;
  const walletPublicId = randomUUID();
  const walletAddress = `LMA-${randomBytes(6).toString("hex").toUpperCase().match(/.{1,4}/g)?.join("-")}`;
  const wallet = {
    publicId: walletPublicId,
    address: walletAddress,
    addressNormalized: walletAddress,
    ownerUserId: user.publicId,
    status: "active",
    financialVersion: 0,
    createdAt: now,
    updatedAt: now,
    customAddressChangedAt: null,
    customAddress: null,
    customAddressNormalized: null,
  } satisfies Omit<WalletRecord, "_id">;
  const mongoSession = input.mongoClient.startSession();
  let userId: string | undefined;

  try {
    await mongoSession.withTransaction(async () => {
      try {
        await input.collections.users.insertOne(user as UserRecord, { session: mongoSession });
      } catch (error) {
        if (typeof error === "object" && error !== null && "code" in error && error.code === 11000) throw conflict("account_exists", "An account with this email already exists.");
        throw error;
      }
      userId = user.publicId;
      await input.collections.wallets.insertOne(wallet as WalletRecord, { session: mongoSession });
      await input.collections.ledgerAccounts.insertOne({ publicId: randomUUID(), walletId: walletPublicId, accountType: "wallet", currency: "LMA", balanceMinor: 0, createdAt: now } as never, { session: mongoSession });
      await input.collections.ledgerAccounts.updateOne(
        { accountType: "fee_revenue", currency: "LMA" },
        { $setOnInsert: { publicId: randomUUID(), walletId: null, accountType: "fee_revenue", currency: "LMA", balanceMinor: 0, createdAt: now } },
        { upsert: true, session: mongoSession },
      );
      await recordSecurityEvent({ collections: input.collections, ownerUserId: user.publicId, eventType: "registration", outcome: "success", correlationId: input.requestId, mongoSession });
    });
  } catch (error) {
    if (!userId && typeof error === "object" && error !== null && "code" in error && error.code === 11000) throw conflict("account_exists", "An account with this email already exists.");
    throw error;
  } finally {
    await mongoSession.endSession();
  }
  const result = await input.collections.users.findOne({ publicId: user.publicId });
  if (!result) throw new Error("Registration did not create the account");
  const tokens = await issueSession({ ...input, user: result });
  return { ...tokens, wallet: { id: walletPublicId, address: walletAddress } };
}

/**
 * Geo-enriches the account a registration just created. It runs after the response, never on the
 * registration path: the IP is already stored with the account, so a missing token, a slow lookup,
 * or an ipinfo outage costs the extra fields and nothing else. Returns what it stored, so the caller
 * can record it; throws only when the lookup itself failed.
 */
export async function captureSignupLocation(input: {
  collections: Collections;
  config: AppConfig;
  ownerUserId: string;
  ipAddress: string;
}): Promise<IpLocation | null> {
  if (!input.config.ipinfoToken || !isPublicIp(input.ipAddress)) return null;
  const location = await lookupIpLocation({
    ipAddress: input.ipAddress,
    token: input.config.ipinfoToken,
    timeoutMs: input.config.ipinfoTimeoutMs,
  });
  await input.collections.users.updateOne(
    { publicId: input.ownerUserId },
    {
      $set: {
        "signupLocation.city": location.city,
        "signupLocation.region": location.region,
        "signupLocation.country": location.country,
        "signupLocation.org": location.org,
        "signupLocation.timezone": location.timezone,
        "signupLocation.resolvedAt": new Date(),
      },
    },
  );
  return location;
}

export async function login(input: {
  collections: Collections;
  config: AppConfig;
  email: unknown;
  password: unknown;
  requestId: string;
  userAgent: string | undefined;
}): Promise<Awaited<ReturnType<typeof issueSession>>> {
  let email: string;
  try { email = normalizeEmail(input.email); } catch { email = "invalid"; }
  const user = await input.collections.users.findOne({ email });
  const password = typeof input.password === "string" && input.password.length <= PASSWORD_MAX_LENGTH ? input.password : "invalid-password";
  const matches = user
    ? await argon2.verify(user.passwordHash, password).catch(() => false)
    : await argon2.verify(await getDummyPasswordHash(), password).catch(() => false);
  if (!user || !matches || user.status !== "active") {
    await recordSecurityEvent({ collections: input.collections, ownerUserId: user?.publicId ?? null, eventType: "login_failed", outcome: "failure", correlationId: input.requestId });
    throw unauthorized();
  }
  const wallet = await input.collections.wallets.findOne({ ownerUserId: user.publicId });
  if (wallet?.status === "frozen") {
    await recordSecurityEvent({ collections: input.collections, ownerUserId: user.publicId, eventType: "login_blocked_wallet_frozen", outcome: "failure", correlationId: input.requestId });
    throw forbidden("wallet_frozen", "This wallet is frozen. Unfreeze it from an active session before signing in.");
  }
  const twoFactor = await input.collections.twoFactorCredentials.findOne({ ownerUserId: user.publicId, enabledAt: { $ne: null } });
  return issueSession({ ...input, user, ...(twoFactor ? { status: "pending_two_factor" as const } : {}) });
}

/**
 * Issues the next refresh token for one active session. The update only lands while the session
 * still looks the way the caller saw it (`guard`), so two concurrent rotations cannot both win: the
 * loser is answered 401 and simply refreshes again. The displaced token is kept as the previous
 * hash, which is what lets reuse detection recognise it later.
 */
async function rotateSession(input: {
  collections: Collections;
  config: AppConfig;
  session: SessionRecord;
  guard: Record<string, unknown>;
  now: Date;
}): Promise<{ user: PublicUser; accessToken: string; refreshToken: string; accessTokenTtlSeconds: number; sessionId: string }> {
  const user = await input.collections.users.findOne({ publicId: input.session.ownerUserId, status: "active" });
  if (!user) throw unauthorized();
  const nextRefreshToken = createOpaqueToken();
  const result = await input.collections.sessions.updateOne(
    { _id: input.session._id, status: "active", ...input.guard },
    { $set: { previousRefreshTokenHash: input.session.refreshTokenHash, refreshTokenHash: hashToken(nextRefreshToken), lastActiveAt: input.now, expiresAt: new Date(input.now.getTime() + REFRESH_TOKEN_TTL_MS) } },
  );
  if (result.modifiedCount !== 1) throw unauthorized();
  return { user: toPublicUser(user), accessToken: await createAccessToken({ userId: user.publicId, sessionId: input.session.publicId }, input.config.accessTokenSecret), refreshToken: nextRefreshToken, accessTokenTtlSeconds: ACCESS_TOKEN_TTL_SECONDS, sessionId: input.session.publicId };
}

export async function refreshSession(input: {
  collections: Collections;
  config: AppConfig;
  refreshToken: string;
  requestId: string;
}): Promise<{ user: PublicUser; accessToken: string; refreshToken: string; accessTokenTtlSeconds: number; sessionId: string }> {
  const tokenHash = hashToken(input.refreshToken);
  const now = new Date();
  const session = await input.collections.sessions.findOne({ refreshTokenHash: tokenHash, status: "active", expiresAt: { $gt: now } });
  if (!session) {
    const raced = await input.collections.sessions.findOne({ previousRefreshTokenHash: tokenHash, status: "active" });
    if (!raced) throw unauthorized();
    if (now.getTime() - raced.lastActiveAt.getTime() > REFRESH_REUSE_GRACE_MS) {
      await input.collections.sessions.updateMany({ ownerUserId: raced.ownerUserId, status: "active" }, { $set: { status: "revoked", revokedAt: now, refreshTokenHash: null } });
      await recordSecurityEvent({ collections: input.collections, ownerUserId: raced.ownerUserId, sessionId: raced.publicId, eventType: "refresh_token_reuse_detected", outcome: "failure", correlationId: input.requestId });
      throw unauthorized();
    }
    // Inside the grace window this is a second tab, not a replay: the session is rotated again so
    // both callers end up with a usable token, and nothing is revoked.
    return rotateSession({ collections: input.collections, config: input.config, session: raced, guard: { previousRefreshTokenHash: tokenHash }, now });
  }
  return rotateSession({ collections: input.collections, config: input.config, session, guard: { refreshTokenHash: tokenHash }, now });
}

export async function completeTwoFactor(input: {
  collections: Collections;
  mongoClient: MongoClient;
  config: AppConfig;
  sessionId: string;
  refreshToken: string;
  code: unknown;
  requestId: string;
}): Promise<{ user: PublicUser; accessToken: string; refreshToken: string; accessTokenTtlSeconds: number; sessionId: string }> {
  const tokenHash = hashToken(input.refreshToken);
  // The pending session expires with the challenge it was created for; without this check a code
  // generated much later could still promote a challenge that was never completed in time.
  const session = await input.collections.sessions.findOne({ publicId: input.sessionId, status: "pending_two_factor", refreshTokenHash: tokenHash, expiresAt: { $gt: new Date() } });
  if (!session || session.twoFactorAttempts >= 5) throw unauthorized();
  const user = await input.collections.users.findOne({ publicId: session.ownerUserId, status: "active" });
  const credential = await input.collections.twoFactorCredentials.findOne({ ownerUserId: session.ownerUserId, enabledAt: { $ne: null } });
  if (!user || !credential || typeof input.code !== "string") throw unauthorized();
  const secret = decryptSecret({ encryptedSecret: credential.encryptedSecret, iv: credential.secretIv, authTag: credential.secretAuthTag }, input.config.encryptionKey);
  let valid = await verifyTotpToken(secret, input.code.trim());
  let remainingRecoveryCodes = credential.recoveryCodeHashes;
  if (!valid) {
    const recoveryHash = hashRecoveryCode(input.code, input.config.encryptionKey);
    const index = remainingRecoveryCodes.indexOf(recoveryHash);
    if (index >= 0) { remainingRecoveryCodes = remainingRecoveryCodes.filter((_, item) => item !== index); valid = true; }
  }
  if (!valid) {
    await input.collections.sessions.updateOne({ _id: session._id, status: "pending_two_factor", twoFactorAttempts: { $lt: 5 } }, { $inc: { twoFactorAttempts: 1 } });
    await recordSecurityEvent({ collections: input.collections, ownerUserId: user.publicId, sessionId: session.publicId, eventType: "two_factor_login_failed", outcome: "failure", correlationId: input.requestId });
    throw unauthorized();
  }

  const nextRefreshToken = createOpaqueToken();
  const now = new Date();
  const mongoSession = input.mongoClient.startSession();
  try {
    await mongoSession.withTransaction(async () => {
      // The pending cookie is deliberately not carried into `previousRefreshTokenHash`. That field
      // exists so a real rotation can recognise the token it just displaced; a challenge's cookie was
      // never an active credential, and keeping it there would make the pending cookie itself a
      // "recently displaced" token for the refresh grace window — a stolen challenge cookie could be
      // replayed within 30 seconds to mint active tokens without the second factor.
      const updated = await input.collections.sessions.updateOne({ _id: session._id, status: "pending_two_factor", refreshTokenHash: tokenHash, twoFactorAttempts: { $lt: 5 } }, { $set: { status: "active", previousRefreshTokenHash: null, refreshTokenHash: hashToken(nextRefreshToken), lastActiveAt: now, expiresAt: new Date(now.getTime() + REFRESH_TOKEN_TTL_MS) } }, { session: mongoSession });
      if (updated.modifiedCount !== 1) throw unauthorized();
      if (remainingRecoveryCodes.length !== credential.recoveryCodeHashes.length) {
        const recoveryUpdate = await input.collections.twoFactorCredentials.updateOne({ _id: credential._id, recoveryCodeHashes: credential.recoveryCodeHashes }, { $set: { recoveryCodeHashes: remainingRecoveryCodes, updatedAt: now } }, { session: mongoSession });
        if (recoveryUpdate.modifiedCount !== 1) throw unauthorized();
      }
      await recordSecurityEvent({ collections: input.collections, ownerUserId: user.publicId, sessionId: session.publicId, eventType: "two_factor_login_succeeded", outcome: "success", correlationId: input.requestId, metadata: { recoveryCodeUsed: remainingRecoveryCodes.length !== credential.recoveryCodeHashes.length }, mongoSession });
    });
  } finally { await mongoSession.endSession(); }
  return { user: toPublicUser(user), accessToken: await createAccessToken({ userId: user.publicId, sessionId: session.publicId }, input.config.accessTokenSecret), refreshToken: nextRefreshToken, accessTokenTtlSeconds: ACCESS_TOKEN_TTL_SECONDS, sessionId: session.publicId };
}

export async function revokeSession(input: { collections: Collections; ownerUserId: string; sessionId: string; requestId: string; currentSessionId: string }): Promise<void> {
  if (input.sessionId === input.currentSessionId) throw notFound();
  const result = await input.collections.sessions.updateOne({ publicId: input.sessionId, ownerUserId: input.ownerUserId, status: "active" }, { $set: { status: "revoked", refreshTokenHash: null, previousRefreshTokenHash: null, revokedAt: new Date() } });
  if (result.matchedCount === 0) throw notFound();
  await recordSecurityEvent({ collections: input.collections, ownerUserId: input.ownerUserId, sessionId: input.sessionId, eventType: "session_revoked", outcome: "success", correlationId: input.requestId });
}

export async function revokeCurrentSession(input: { collections: Collections; ownerUserId: string; sessionId: string; requestId: string }): Promise<void> {
  const now = new Date();
  await input.collections.sessions.updateOne({ publicId: input.sessionId, ownerUserId: input.ownerUserId, status: { $ne: "revoked" } }, { $set: { status: "revoked", refreshTokenHash: null, previousRefreshTokenHash: null, revokedAt: now } });
  await recordSecurityEvent({ collections: input.collections, ownerUserId: input.ownerUserId, sessionId: input.sessionId, eventType: "logout", outcome: "success", correlationId: input.requestId });
}

export async function listSessions(input: { collections: Collections; ownerUserId: string; currentSessionId: string }) {
  const sessions = await input.collections.sessions.find({ ownerUserId: input.ownerUserId, status: "active", expiresAt: { $gt: new Date() } }, { projection: { _id: 0, publicId: 1, userAgent: 1, createdAt: 1, lastActiveAt: 1, expiresAt: 1 } }).sort({ lastActiveAt: -1 }).limit(100).toArray();
  return sessions.map((session) => ({ id: session.publicId, device: session.userAgent ?? "Unknown device", userAgent: session.userAgent, current: session.publicId === input.currentSessionId, createdAt: session.createdAt.toISOString(), lastActiveAt: session.lastActiveAt.toISOString(), expiresAt: session.expiresAt.toISOString() }));
}

export async function getCurrentUser(input: { collections: Collections; ownerUserId: string }) {
  const user = await input.collections.users.findOne({ publicId: input.ownerUserId, status: "active" });
  if (!user) throw unauthorized();
  const wallet = await input.collections.wallets.findOne({ ownerUserId: user.publicId });
  const ledgerAccount = wallet ? await input.collections.ledgerAccounts.findOne({ walletId: wallet.publicId, accountType: "wallet" }, { projection: { balanceMinor: 1 } }) : null;
  return { user: toPublicUser(user), wallet: wallet ? { id: wallet.publicId, address: wallet.customAddress ?? wallet.address, status: wallet.status, balance: formatMoney(ledgerAccount?.balanceMinor ?? 0), currency: "LMA", createdAt: wallet.createdAt.toISOString(), customAddressChangedAt: wallet.customAddressChangedAt?.toISOString() ?? null, customAddress: wallet.customAddress } : null };
}

export async function updateProfile(input: { collections: Collections; ownerUserId: string; displayName?: unknown; country?: unknown; requestId: string; redis?: RedisHandle }) {
  const changes: Record<string, string | null> = {};
  if (input.displayName !== undefined) {
    if (typeof input.displayName !== "string") throw badRequest("invalid_display_name", "Enter a valid display name.");
    const name = input.displayName.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, DISPLAY_NAME_MAX_LENGTH);
    if (!name) throw badRequest("invalid_display_name", "Enter your name.");
    changes["profile.displayName"] = name;
  }
  if (input.country !== undefined) {
    if (input.country !== null && (typeof input.country !== "string" || !/^[A-Z]{2}$/.test(input.country))) throw badRequest("invalid_country", "Enter a valid country code.");
    changes["profile.country"] = input.country;
  }
  if (Object.keys(changes).length === 0) throw badRequest("empty_profile_update", "Provide at least one profile field.");
  const result = await input.collections.users.updateOne({ publicId: input.ownerUserId, status: "active" }, { $set: { ...changes, updatedAt: new Date() } });
  if (result.matchedCount !== 1) throw unauthorized();
  // The preview masks the recipient's display name from a brief cache: invalidate on change.
  // MongoDB first, cache second — a lost invalidation only mis-masks until the TTL.
  if ("profile.displayName" in changes && input.redis) {
    await invalidate(input.redis, displayNameKey(input.redis, input.ownerUserId));
  }
  await recordSecurityEvent({ collections: input.collections, ownerUserId: input.ownerUserId, eventType: "profile_updated", outcome: "success", correlationId: input.requestId, metadata: { displayNameChanged: "profile.displayName" in changes, countryChanged: "profile.country" in changes } });
  return (await getCurrentUser({ collections: input.collections, ownerUserId: input.ownerUserId })).user;
}

/**
 * Changes the account password, revoking every other session.
 *
 * Lives here (not in the HTTP layer) so the verify-hash-compare sessions-audit sequence has one
 * owner and one test surface. The conditional update on the current hash keeps a concurrent change
 * from silently winning, and revoking the sibling sessions (including a pending 2FA challenge
 * started with the old password) is what makes the change actually end the old credential.
 */
export async function changePassword(input: { collections: Collections; ownerUserId: string; sessionId: string; currentPassword: unknown; newPassword: unknown; requestId: string }): Promise<{ changed: true }> {
  if (typeof input.currentPassword !== "string" || typeof input.newPassword !== "string") throw badRequest("invalid_request", "The request data is invalid.");
  validatePassword(input.newPassword);
  const user = await input.collections.users.findOne({ publicId: input.ownerUserId });
  if (!user || !(await argon2.verify(user.passwordHash, input.currentPassword).catch(() => false))) throw forbidden("invalid_credentials", "The current password is incorrect.");
  const updated = await input.collections.users.updateOne({ _id: user._id, passwordHash: user.passwordHash }, { $set: { passwordHash: await argon2.hash(input.newPassword, ARGON2_OPTIONS), updatedAt: new Date() } });
  if (updated.modifiedCount !== 1) throw badRequest("password_change_conflict", "The password changed. Sign in again and retry.");
  await input.collections.sessions.updateMany({ ownerUserId: input.ownerUserId, status: { $in: ["active", "pending_two_factor"] }, publicId: { $ne: input.sessionId } }, { $set: { status: "revoked", refreshTokenHash: null, previousRefreshTokenHash: null, revokedAt: new Date() } });
  await recordSecurityEvent({ collections: input.collections, ownerUserId: input.ownerUserId, sessionId: input.sessionId, eventType: "password_changed", outcome: "success", correlationId: input.requestId });
  return { changed: true };
}

export async function authenticateUser(input: { collections: Collections; config: AppConfig; authorization: string | undefined }) {
  const token = input.authorization?.startsWith("Bearer ") ? input.authorization.slice(7) : "";
  if (!token) throw unauthorized();
  const claims = await verifyAccessToken(token, input.config.accessTokenSecret);
  const session = await input.collections.sessions.findOne({ publicId: claims.sessionId, ownerUserId: claims.userId, status: "active", expiresAt: { $gt: new Date() } }, { projection: { publicId: 1 } });
  if (!session) throw unauthorized();
  // Sign-in and refresh both refuse a suspended account, so an access token issued before the
  // suspension must stop working too: otherwise the account keeps acting until its token expires.
  const user = await input.collections.users.findOne({ publicId: claims.userId, status: "active" }, { projection: { publicId: 1 } });
  if (!user) throw unauthorized();
  return { userId: claims.userId, sessionId: claims.sessionId };
}
