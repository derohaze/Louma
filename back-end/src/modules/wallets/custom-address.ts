export const CUSTOM_ADDRESS_PATTERN = /^[A-Za-z][A-Za-z0-9]{2,15}$/;

export function isValidCustomAddress(value: unknown): value is string {
  return typeof value === "string" && CUSTOM_ADDRESS_PATTERN.test(value);
}
