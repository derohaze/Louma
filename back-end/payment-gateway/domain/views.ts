import type { Payment } from "./models.js";
import { publicFields } from "./models.js";
import { formatMoney } from "./money.js";
export function paymentView(p: Payment): Record<string, unknown> {
  return {
    id: p.publicId,
    payment_id: p.publicId,
    application_id: p.applicationId,
    intent_hash: p.intentHash,
    status: p.status,
    currency: "LMA",
    subtotal: formatMoney(p.subtotalMinor),
    tax: formatMoney(p.taxMinor),
    total: formatMoney(p.totalMinor),
    fee: formatMoney(p.feeMinor),
    merchant_net: formatMoney(p.netMinor),
    fee_policy: {
      version: p.feePolicy.version,
      basis_points: p.feePolicy.basisPoints,
    },
    description: p.description,
    merchant: { id: p.applicationId, name: p.merchantName },
    expires_at: p.expiresAt,
    created_at: p.createdAt,
    transaction_reference: p.transactionId ?? "",
    refunded: formatMoney(p.refundedMinor ?? 0),
    metadata: p.metadata ?? {},
    ...(p.interval
      ? {
          recurring: {
            price_id: p.priceId,
            amount: formatMoney(p.totalMinor),
            interval: p.interval,
            consent_policy_version: "2026-10-08",
            description: p.description,
          },
        }
      : {}),
    ...(p.subscriptionId
      ? { subscription_id: p.subscriptionId, invoice_id: p.invoiceId }
      : {}),
  };
}
export function publicView(
  type: string,
  value: object,
): Record<string, unknown> {
  const row = value as Record<string, unknown>,
    fields = publicFields[type];
  if (!fields) throw new Error("Unsupported public resource");
  const out: Record<string, unknown> = {};
  for (const [stored, wire] of Object.entries(fields))
    if (stored in row) out[wire] = row[stored];
  if (type === "Invoice" && row["feePolicy"]) {
    const fee = row["feePolicy"] as {
      version: string;
      basisPoints: number;
    };
    out["fee_policy"] = { version: fee.version, basis_points: fee.basisPoints };
  }
  return out;
}
