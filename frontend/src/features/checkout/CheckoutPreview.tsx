import { useState } from "react";
import { CheckoutExperience, CheckoutShell } from "./CheckoutExperience";
import type { CheckoutDetails } from "@/shared/api/payments";
import { useI18n } from "@/shared/i18n";
import { Input } from "@/shared/ui/input";
import { Button } from "@/shared/ui/button";

// This module is loaded only by Vite development mode; it never calls a payment API.
export default function CheckoutPreview() {
  const { language } = useI18n();
  const ar = language === "ar";
  const [merchant, setMerchant] = useState("Studio North");
  const [amount, setAmount] = useState("50");
  const [status, setStatus] = useState("requires_action");
  const [busy, setBusy] = useState(false);
  const valid = /^(?:[1-9]\d{0,5}|0)(?:\.\d{1,4})?$/.test(amount) && Number(amount) > 0;
  const payment: CheckoutDetails = {
    id: "preview",
    payment_id: "LMA-PREVIEW-0042",
    status,
    intent_hash: "preview",
    currency: "LMA",
    total: valid ? amount : "50",
    subtotal: valid ? amount : "50",
    tax: "0.0000",
    fee: "0.5000",
    merchant_net: "49.5000",
    description: ar ? "باقة التصميم · الطلب ٤٢" : "Design collection · Order 42",
    expires_at: "2099-01-01T00:00:00.000Z",
    merchant: { id: "preview", name: merchant },
    payer_wallet: {
      id: "preview",
      address: "LMA4R13YNG158YSME4TQEVF54BWCD66",
      status: "active",
    },
  };
  return (
    <div
      dir={ar ? "rtl" : "ltr"}
      className="min-h-dvh bg-background md:grid md:grid-cols-[300px_1fr]"
    >
      <aside className="border-b bg-card p-6 md:border-e md:border-b-0 lg:p-8">
        <h1 className="mt-1 font-display text-xl font-semibold">
          {ar ? "صمّم تجربة الدفع" : "Make checkout yours"}
        </h1>
        <p className="mt-3 text-sm leading-7 text-muted-foreground">
          {ar
            ? "معاينة فقط. لا تُنشئ مدفوعات ولا تخصم من أي محفظة. تعديلات التصميم تظهر فور حفظ الملف."
            : "Preview only. No payments or wallet charges. Design edits appear as soon as you save the file."}
        </p>
        <div className="mt-7 space-y-5">
          <label className="block space-y-2 text-sm">
            <span>{ar ? "اسم المتجر" : "Store name"}</span>
            <Input
              value={merchant}
              maxLength={120}
              onChange={(event) => setMerchant(event.target.value)}
              className="h-11 rounded-2xl border-neutral-200 bg-white px-4 focus-visible:border-neutral-200"
            />
          </label>
          <label className="block space-y-2 text-sm">
            <span>{ar ? "المبلغ (LMA)" : "Amount (LMA)"}</span>
            <Input
              value={amount}
              inputMode="decimal"
              dir="ltr"
              onChange={(event) => setAmount(event.target.value)}
              aria-invalid={!valid}
              className="h-11 rounded-2xl border-neutral-200 bg-white px-4 focus-visible:border-neutral-200"
            />
            {!valid && (
              <span className="text-xs text-destructive">
                {ar
                  ? "أدخل مبلغًا موجبًا حتى ٤ منازل عشرية."
                  : "Enter a positive amount with up to 4 decimals."}
              </span>
            )}
          </label>
          <Button
            variant="outline"
            onClick={() => {
              setStatus("requires_action");
            }}
          >
            {ar ? "إعادة التجربة" : "Reset preview"}
          </Button>
        </div>
      </aside>
      <CheckoutShell>
        <CheckoutExperience
          payment={payment}
          factors={{ transferPassword: false, twoFactor: false, pending: false, error: "" }}
          busy={busy}
          error=""
          subscriptionCanceled={false}
          onCancelRenewals={async () => {}}
          onConfirm={async () => {
            if (!valid) return false;
            setBusy(true);
            await new Promise((resolve) => setTimeout(resolve, 1800));
            setStatus("succeeded");
            setBusy(false);
            return true;
          }}
        />
      </CheckoutShell>
    </div>
  );
}
