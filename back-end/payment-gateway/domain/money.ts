export const MAX_AMOUNT = 9007199254740000;
export const MAX_BALANCE = Number.MAX_SAFE_INTEGER;
export interface FeePolicy {
  version: string;
  basisPoints: number;
}
export class GatewayError extends Error {
  constructor(
    readonly code: string,
    readonly statusCode: number,
  ) {
    super(code);
    this.name = "GatewayError";
  }
}
export function reject(code: string, status = 400): never {
  throw new GatewayError(code, status);
}
export function parseMoney(value: string): number {
  if (!/^(0|[1-9][0-9]{0,11})(\.[0-9]{1,4})?$/.test(value))
    return reject("invalid_amount");
  const [whole, fraction = ""] = value.split(".");
  const minor = BigInt(whole!) * 10000n + BigInt(fraction.padEnd(4, "0"));
  if (minor > BigInt(MAX_AMOUNT)) return reject("invalid_amount");
  return Number(minor);
}
export function formatMoney(value: number): string {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new Error("Invalid stored money");
  const minor = BigInt(value);
  return `${minor / 10000n}.${String(minor % 10000n).padStart(4, "0")}`;
}
export function calculateFee(total: number, policy: FeePolicy): number {
  if (
    !Number.isSafeInteger(total) ||
    total < 1 ||
    total > MAX_AMOUNT ||
    !Number.isInteger(policy.basisPoints) ||
    policy.basisPoints < 0 ||
    policy.basisPoints >= 10000 ||
    !policy.version
  )
    return reject("invalid_fee_policy");
  const fee = Number(
    (BigInt(total) * BigInt(policy.basisPoints) + 5000n) / 10000n,
  );
  if (fee >= total) return reject("invalid_amount");
  return fee;
}
