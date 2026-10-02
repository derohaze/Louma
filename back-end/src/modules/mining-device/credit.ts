import type { AppConfig } from "../../config/env.js";
import type { Collections } from "../../infrastructure/mongodb/collections.js";
import type { MiningDeviceRecord } from "../../shared/types.js";
import { ipHash } from "./identity.js";
import { networkTrustEntry, nextTrustState } from "./enrollment.js";
import { MAX_NETWORK_TRUSTS } from "./policy.js";

/**
 * Credits one *committed* admission (and the findings of that observation) to a device cluster.
 *
 * This is the only writer of `admissionCount`, of the admission side of `networkTrusts`, and of the
 * `establishedAt` that admissions earn; it is called by the mining service only after the session and its lease
 * transaction has committed — so the number of admissions is the number of cycles that actually
 * started on the cluster, never the number of requests that merely reached admission control. A
 * burst of concurrent starts therefore credits one admission, not one per request, which is what
 * makes "established" mean several occasions instead of one fabricated moment.
 *
 * The credit is recorded against the network the cycle was taken from: trust is then readable as
 * "this identity has mined here, recently", which is the only statement the network lock is allowed
 * to accept from it.
 */
export async function creditGrantedStart(input: {
  collections: Collections;
  config: Pick<AppConfig, "encryptionKey" | "lmdg">;
  devicePublicId: string;
  ip: string | null;
  nowMs?: number;
}): Promise<void> {
  const nowMs = input.nowMs ?? Date.now();
  const now = new Date(nowMs);
  // Atomic increment, then a decision on the fresh document: two credits landing together cannot
  // overwrite each other's count the way a read-modify-write of the in-memory record would.
  const updated = await input.collections.miningDevices
    .findOneAndUpdate(
      { publicId: input.devicePublicId, status: { $ne: "blocked" } },
      { $inc: { admissionCount: 1 }, $set: { lastSeenAt: now, updatedAt: now } },
      { returnDocument: "after" },
    )
    .catch((error) => {
      reportCreditFailure("admission increment", input.devicePublicId, error);
      return null;
    });
  if (!updated) return;
  await applyCommittedCredit({
    collections: input.collections,
    cluster: updated,
    ipHashValue: input.ip ? ipHash(input.config.encryptionKey, input.ip) : null,
    credit: "admission",
    nowMs,
    minAdmissions: input.config.lmdg.establishMinAdmissions,
  });
}

/**
 * Recomputes and persists a cluster's trust after one committed credit.
 *
 * Shared by the admission credit (a cycle that committed) and the proof credit (a verified
 * single-use handshake), so both move `trustState`, `networkTrusts` and `establishedAt` through the
 * same rule and both record *where* the activity happened. Callers pass the document as returned by
 * their atomic `$inc`, never an earlier read: a concurrent credit must not be overwritten.
 */
export async function applyCommittedCredit(input: {
  collections: Collections;
  cluster: MiningDeviceRecord;
  ipHashValue: string | null;
  credit: "admission" | "proof";
  nowMs: number;
  minAdmissions: number;
}): Promise<void> {
  const now = new Date(input.nowMs);
  if (input.ipHashValue) {
    // One atomic pipeline: increment the matching entry or prepend a new one, and move the
    // credited network to the front. Two operations (increment-then-insert) let two first credits
    // on one network both miss and each prepend a duplicate — trust reads only the first match,
    // so split credits never established the exemption and wasted the bounded slots. An in-place
    // increment alone left the entry in its old position, so a freshly credited third network
    // could be sliced away by the next new network. Serialized per document, this pipeline lets
    // the second concurrent credit see the first one's entry and increment it instead.
    const admissionsInc = input.credit === "admission" ? 1 : 0;
    const proofsInc = input.credit === "proof" ? 1 : 0;
    const freshEntry = networkTrustEntry(input.ipHashValue, input.credit, input.nowMs);
    await input.collections.miningDevices
      .updateOne(
        { _id: input.cluster._id },
        [
          {
            $set: {
              networkTrusts: {
                $let: {
                  vars: {
                    current: { $ifNull: ["$networkTrusts", []] },
                    has: { $in: [input.ipHashValue, { $ifNull: ["$networkTrusts.ipHash", []] }] },
                  },
                  in: {
                    $cond: [
                      "$$has",
                      {
                        $let: {
                          vars: {
                            bumped: {
                              $map: {
                                input: "$$current",
                                as: "entry",
                                in: {
                                  $cond: [
                                    { $eq: ["$$entry.ipHash", input.ipHashValue] },
                                    {
                                      $mergeObjects: [
                                        "$$entry",
                                        {
                                          admissions: { $add: ["$$entry.admissions", admissionsInc] },
                                          proofs: { $add: ["$$entry.proofs", proofsInc] },
                                          lastAt: now,
                                        },
                                      ],
                                    },
                                    "$$entry",
                                  ],
                                },
                              },
                            },
                          },
                          in: {
                            $slice: [
                              {
                                $concatArrays: [
                                  { $filter: { input: "$$bumped", as: "entry", cond: { $eq: ["$$entry.ipHash", input.ipHashValue] } } },
                                  { $filter: { input: "$$bumped", as: "entry", cond: { $ne: ["$$entry.ipHash", input.ipHashValue] } } },
                                ],
                              },
                              MAX_NETWORK_TRUSTS,
                            ],
                          },
                        },
                      },
                      {
                        $slice: [{ $concatArrays: [[freshEntry], "$$current"] }, MAX_NETWORK_TRUSTS],
                      },
                    ],
                  },
                },
              },
            },
          },
        ],
      )
      .catch((error) => {
        reportCreditFailure("network trust credit", input.cluster.publicId, error);
      });
  }
  const transition = nextTrustState({
    device: input.cluster,
    admissionCount: input.cluster.admissionCount ?? 0,
    proofCount: input.cluster.proofCount ?? 0,
    findingCount: input.cluster.findingCount ?? 0,
    minAdmissions: input.minAdmissions,
  });
  await input.collections.miningDevices
    .updateOne(
      { _id: input.cluster._id },
      {
        $set: {
          trustState: transition.state,
          ...(transition.becameEstablished ? { establishedAt: now } : {}),
        },
      },
    )
    .catch((error) => {
      reportCreditFailure("trust state", input.cluster.publicId, error);
    });
}

/**
 * A credit that was not written is a real loss — the device never gets that admission back and can
 * end up refused for standing it did earn — but it must never fail the request: the cycle is already
 * committed when this runs. Ignoring the error entirely was the worse option: the loss left no trace
 * at all, so nothing could tell an undercounted device from one that never mined. This is the trace.
 */
function reportCreditFailure(operation: string, devicePublicId: string, error: unknown): void {
  console.error(`[lmdg] committed credit not written (${operation}) for device ${devicePublicId}:`, error);
}
