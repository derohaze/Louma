/** The only wallet-address collision is the unique index over addressNormalized. */
export function isCanonicalWalletAddressDuplicate(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const mongoError = error as { code?: unknown; keyPattern?: unknown };
  if (mongoError.code !== 11000 || typeof mongoError.keyPattern !== "object" || mongoError.keyPattern === null) return false;
  const keyPattern = mongoError.keyPattern as Record<string, unknown>;
  return Object.keys(keyPattern).length === 1 && keyPattern["addressNormalized"] === 1;
}
