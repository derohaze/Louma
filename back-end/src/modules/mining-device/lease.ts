import { randomUUID } from "node:crypto";
import { ObjectId, type ClientSession } from "mongodb";
import type { Collections } from "../../infrastructure/mongodb/collections.js";
import { ipHash } from "./identity.js";
import { NETWORK_LOCK_KEY_PREFIX } from "./policy.js";
import { findLiveLeasesForOwner } from "./repository.js";

/**
 * The reserved `deviceClusterId` of one network's admission token.
 *
 * A start that must pass the network rule (not a resident of its network) takes this lease along
 * with its device leases. Two fresh identities racing on one network then collide on the unique
 * active-lease index: one commits, and the loser's transaction is refused and re-reads the committed
 * state, where the winner's live lease turns the race into the ordinary "network already mining"
 * refusal. The token is released with its cycle and cleaned by `releaseInactiveLeases` like any
 * other lease row; device identities are server-derived digests and can never carry this prefix.
 */
export function networkLockKeyFor(ipHashValue: string): string {
  return `${NETWORK_LOCK_KEY_PREFIX}${ipHashValue}`;
}

/**
 * Inserts the lease rows inside the caller's transaction. The partial unique index is the lock.
 *
 * Every device identity the session is known to cover gets its own row (`deviceClusterId` holds the
 * device key hash), and the caller passes a set rather than a single key on purpose: a start also
 * leases the exact duplicates it correlated with, so two first-time starts racing on one machine
 * cannot each lease a different row and open two cycles.
 */
export async function insertLeaseInSession(input: {
  collections: Collections;
  leaseKeys: string[];
  /** The device record (`publicId`) the lease is taken for — keeps the backstop reachable by record even after a key change. */
  deviceId: string | null;
  /** Server-observed peer address of this start; hashed here so the network identity never leaves this module. */
  ip: string | null;
  secret: Buffer;
  ownerUserId: string;
  miningSessionId: string;
  leaseEndsAt: Date;
  mongoSession: ClientSession;
}): Promise<void> {
  const now = new Date();
  const networkHash = input.ip ? ipHash(input.secret, input.ip) : null;
  await input.collections.miningDeviceLeases.insertMany(
    [...new Set(input.leaseKeys)].map((deviceClusterId) => ({
      _id: new ObjectId(),
      publicId: randomUUID(),
      deviceClusterId,
      deviceId: input.deviceId,
      ownerUserId: input.ownerUserId,
      miningSessionId: input.miningSessionId,
      ipHash: networkHash,
      leasedAt: now,
      leaseEndsAt: input.leaseEndsAt,
      status: "active",
      createdAt: now,
      updatedAt: now,
    })) as never,
    { session: input.mongoSession, ordered: true },
  );
}

/** Safe public view: never exposes other accounts, IPs, fingerprints, or risk internals. */
export async function getDeviceStatus(input: {
  collections: Collections;
  ownerUserId: string;
  nowMs?: number;
}): Promise<{ bound: boolean; leaseEndsAt: string | null; deviceId: string | null }> {
  const nowMs = input.nowMs ?? Date.now();
  // A row still marked active is not proof of a binding (see `findLiveLeasesForOwner`): the
  // referenced session must still be running and owned by this account, so a cycle that ended by
  // any path stops claiming the device the moment it is over.
  const lease = (await findLiveLeasesForOwner(input.collections, input.ownerUserId, nowMs))[0] ?? null;
  if (!lease) return { bound: false, leaseEndsAt: null, deviceId: null };
  return { bound: true, leaseEndsAt: lease.leaseEndsAt.toISOString(), deviceId: lease.deviceClusterId };
}
