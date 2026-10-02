/**
 * Shared MongoDB transaction-retry helpers.
 *
 * Single source of truth for the retryable driver/server codes and the error-label
 * checks previously duplicated in `modules/mining/service.ts` and
 * `modules/transfers/service.ts`. The driver's `TransientTransactionError` label is
 * authoritative; the code set is the conservative fallback for drivers/servers that
 * do not attach labels.
 */

const TRANSIENT_ERROR_CODES = new Set([
  6, 7, 63, 64, 89, 91, 134, 189, 197, 216, 226, 241, 251, 256, 261, 262, 276, 286,
  9001,
]);

export const RETRY_BACKOFF_BASE_MS = 20;

export function hasErrorLabel(error: unknown, label: string): boolean {
  if (typeof error !== "object" || error === null) return false;
  const labels = (error as { errorLabels?: unknown }).errorLabels;
  return Array.isArray(labels) && labels.includes(label);
}

export function isTransientTransactionError(error: unknown): boolean {
  if (hasErrorLabel(error, "TransientTransactionError")) return true;
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "number" && TRANSIENT_ERROR_CODES.has(code);
}

/** The commit may or may not have landed; only the idempotency record can tell. */
export function isUnknownCommitOutcome(error: unknown): boolean {
  return hasErrorLabel(error, "UnknownTransactionCommitOutcome");
}

/**
 * A duplicate key on an idempotency or unique index means a concurrent request with
 * the same logical operation won the insert race: the loser must converge on the
 * winner's record, not surface an error.
 */
export function isDuplicateKeyError(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === 11000;
}

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));
