import type { Collection } from "mongodb";
import type { FinancialControlsRecord } from "../../shared/types.js";

/**
 * Operator controls for the financial surfaces.
 *
 * The point of this module is the incident where money must stop moving *now*: a reconciliation run
 * has reported a critical invariant failure, or abuse is being drained through transfers at speed. A
 * database document rather than an environment variable, because stopping writes must not require a
 * deploy and a rolling restart while money is moving, and because the change itself has to be
 * auditable after the fact (`updatedBy`, `reason`, `updatedAt`).
 *
 * Two properties are deliberate:
 *
 * - **Absent means not paused.** A database that has never been told to stop serves transfers. The
 *   failure mode of a missing control row is "the product works", which is the safe direction for a
 *   feature that people depend on; a pause that failed open the other way — reads that could not be
 *   answered silently allowing writes — would be worse than useless.
 * - **Money is never touched.** The row carries policy only. Balances are explained by the ledger
 *   alone, so pausing, resuming, or losing this document cannot move a single minor unit.
 *
 * The cache exists so the check costs one read per second per process instead of one per transfer.
 * The honest bound it creates: a pause takes effect within `CACHE_TTL_MS` of the operator write, and
 * a transfer that has already passed the check (or is already inside its transaction) can still
 * commit. A pause is a brake, not a retroactive rollback — anything that already committed stays
 * committed and stays reconcileable.
 */

const CACHE_TTL_MS = 1000;

let cached: { at: number; value: FinancialControlsRecord | null } | null = null;

export interface FinancialControls {
  transfersPaused: boolean;
  payoutsPaused: boolean;
  reason: string;
}

/** The defaults, used when no control row exists (which is the normal state). */
export const FINANCIAL_CONTROLS_DEFAULT: FinancialControls = { transfersPaused: false, payoutsPaused: false, reason: "" };

function toControls(record: FinancialControlsRecord | null): FinancialControls {
  if (!record) return FINANCIAL_CONTROLS_DEFAULT;
  return { transfersPaused: record.transfersPaused, payoutsPaused: record.payoutsPaused, reason: record.reason };
}

/** Reads the current controls, with a one-second cache. Never throws: an unreadable control row cannot pause money. */
export async function readFinancialControls(collections: { financialControls: Collection<FinancialControlsRecord> }): Promise<FinancialControls> {
  const now = Date.now();
  if (cached && now - cached.at < CACHE_TTL_MS) return toControls(cached.value);
  let record: FinancialControlsRecord | null = null;
  try {
    record = await collections.financialControls.findOne({ _id: "global" });
  } catch {
    // A control read that fails must not stop the product, and must not pause money either: it falls
    // back to "not paused" for this one window and the next attempt re-reads. Financial correctness
    // does not depend on this document (see the module comment).
    return FINANCIAL_CONTROLS_DEFAULT;
  }
  cached = { at: now, value: record };
  return toControls(record);
}

/** Writes the control row. Operator-only: reachable through the CLI script, never through the API. */
export async function setFinancialControls(input: {
  collections: { financialControls: Collection<FinancialControlsRecord> };
  transfersPaused: boolean;
  payoutsPaused: boolean;
  reason: string;
  updatedBy: string;
}): Promise<FinancialControls> {
  const record: FinancialControlsRecord = {
    _id: "global",
    transfersPaused: input.transfersPaused,
    payoutsPaused: input.payoutsPaused,
    reason: input.reason,
    updatedAt: new Date(),
    updatedBy: input.updatedBy,
  };
  await input.collections.financialControls.updateOne({ _id: "global" }, { $set: record }, { upsert: true });
  // The writer's own process should see its change immediately rather than up to a second later.
  cached = { at: Date.now(), value: record };
  return toControls(record);
}

/** Test-only: drops the cached value so a suite can observe a control change without waiting. */
export function resetFinancialControlsCache(): void {
  cached = null;
}
