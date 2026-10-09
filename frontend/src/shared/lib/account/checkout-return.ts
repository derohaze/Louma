import type { PaymentMode } from "@/shared/api/payments";

export interface CheckoutReturn {
  checkout?: string;
  mode?: PaymentMode;
}

/** Login only accepts a payment UUID and environment, never a caller-supplied return URL. */
export function checkoutReturn(search: Record<string, unknown>): CheckoutReturn {
  const id = search["checkout"];
  const mode = search["mode"];
  return typeof id === "string" &&
    /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id) &&
    (mode === "test" || mode === "live")
    ? { checkout: id, mode }
    : {};
}
