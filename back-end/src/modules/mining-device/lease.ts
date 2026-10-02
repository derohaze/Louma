import { randomUUID } from "node:crypto";
import { ObjectId, type ClientSession } from "mongodb";
import type { Collections } from "../../infrastructure/mongodb/collections.js";
import { ipHash } from "./identity.js";

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
  const lease = await input.collections.miningDeviceLeases.findOne(
    { ownerUserId: input.ownerUserId, status: "active" },
    { sort: { leaseEndsAt: -1 } },
  );
  if (!lease || lease.leaseEndsAt.getTime() <= nowMs) return { bound: false, leaseEndsAt: null, deviceId: null };
  return { bound: true, leaseEndsAt: lease.leaseEndsAt.toISOString(), deviceId: lease.deviceClusterId };
}
