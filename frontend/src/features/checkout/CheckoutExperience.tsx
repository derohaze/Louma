import { useRef, useState, type FormEvent, type ReactNode } from "react";
import type { CheckoutDetails } from "@/shared/api/payments";
import { useI18n, useT } from "@/shared/i18n";
import { cn } from "@/shared/lib/platform";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { LockKeyhole } from "lucide-react";
import { SlideToPay } from "./SlideToPay";
import "./checkout.css";

// Format the exact decimal string without passing money through floating point.
const amountLabel = (value: string) => {
  const [whole = "0", fraction] = value.replace(/(\.\d*?[1-9])0+$|\.0+$/, "$1").split(".");
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (fraction ? `.${fraction}` : "");
};

export type CheckoutProof = {
  intent_hash: string;
  transferPassword?: string;
  twoFactorCode?: string;
  recurring_consent?: boolean;
  policy_version?: string;
};

export function CheckoutShell({
  children,
  standalone = true,
}: {
  children: ReactNode;
  standalone?: boolean;
}) {
  const t = useT("checkout");
  const { language } = useI18n();
  const Frame = standalone ? "main" : "div";
  return (
    <Frame
      dir={language === "ar" ? "rtl" : "ltr"}
      className={cn("louma-checkout-backdrop min-w-0", standalone && "min-h-dvh")}
    >
      <div className="mx-auto w-full max-w-[420px]">
        <section className="louma-checkout-card" aria-label={t("title")}>
          <header className="flex h-14 items-center justify-center px-6">
            <span className="font-display text-base font-semibold tracking-tight">Louma Pay</span>
          </header>
          {children}
        </section>
        <footer className="mt-5 flex justify-center">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-neutral-100 px-3 py-1.5 text-[11px] text-neutral-500">
            <LockKeyhole className="size-3" aria-hidden="true" />
            {t("poweredBy")}
          </span>
        </footer>
      </div>
    </Frame>
  );
}

/** Live checkout and the local preview share this view. Only the caller can confirm settlement. */
export function CheckoutExperience({
  payment,
  factors,
  busy,
  error,
  subscriptionCanceled,
  onConfirm,
  onCancelRenewals,
}: {
  payment: CheckoutDetails;
  factors: { transferPassword: boolean; twoFactor: boolean; pending: boolean; error: string };
  busy: boolean;
  error: string;
  subscriptionCanceled: boolean;
  onConfirm: (proof: CheckoutProof) => Promise<boolean>;
  onCancelRenewals: () => Promise<void>;
}) {
  const t = useT("checkout");
  const form = useRef<HTMLFormElement>(null);
  const confirming = useRef(false);
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [consent, setConsent] = useState(false);
  const confirmed = payment.status === "succeeded";
  const frozen = payment.payer_wallet?.status === "frozen";
  const expired =
    payment.status === "expired" ||
    (!!payment.expires_at && Date.parse(payment.expires_at) <= Date.now() && !confirmed);
  const payable = payment.status === "requires_action" && !expired;
  const disabled =
    busy ||
    !payment.payer_wallet ||
    frozen ||
    !payable ||
    factors.pending ||
    !!factors.error ||
    (!!payment.recurring && !consent);
  const confirm = async (event: FormEvent) => {
    event.preventDefault();
    if (disabled || confirming.current || Date.parse(payment.expires_at) <= Date.now()) return;
    confirming.current = true;
    try {
      const settled = await onConfirm({
        intent_hash: payment.intent_hash,
        ...(password ? { transferPassword: password } : {}),
        ...(code ? { twoFactorCode: code } : {}),
        ...(payment.recurring
          ? { recurring_consent: consent, policy_version: payment.recurring.consent_policy_version }
          : {}),
      });
      if (settled) {
        setPassword("");
        setCode("");
      }
    } finally {
      confirming.current = false;
    }
  };
  const reference = (
    <div className="text-center text-[10px] leading-5 text-neutral-500">
      <p>{t("reference")}</p>
      <code className="block break-all" dir="ltr">
        {payment.payment_id}
      </code>
    </div>
  );

  if (busy && !confirmed)
    return (
      <div
        key="processing"
        role="status"
        aria-live="polite"
        className="louma-checkout-state flex min-h-[440px] flex-col items-center justify-center px-6 pb-16"
      >
        <svg viewBox="0 0 48 48" aria-hidden="true" className="size-20 motion-safe:animate-spin">
          <circle cx="24" cy="24" r="20" fill="none" stroke="#e5e5e5" strokeWidth="4" />
          <circle
            cx="24"
            cy="24"
            r="20"
            fill="none"
            stroke="#8e53f8"
            strokeWidth="4"
            strokeLinecap="round"
            strokeDasharray="32 94"
          />
        </svg>
        <h1 className="mt-6 text-base font-semibold">{t("processing")}</h1>
      </div>
    );

  if (confirmed)
    return (
      <div
        key="success"
        className="louma-checkout-state flex min-h-[440px] flex-col px-6 pb-7 sm:px-8"
      >
        <div
          role="status"
          className="flex flex-1 flex-col items-center justify-center py-12 text-center"
        >
          <span className="louma-checkout-success grid size-24 place-items-center rounded-full border-2 border-emerald-500 bg-emerald-500/10">
            <svg
              viewBox="0 0 24 24"
              aria-hidden="true"
              className="size-12 text-emerald-600"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path className="louma-checkout-check" d="M4 12.5 9.5 18 20 6.5" />
            </svg>
          </span>
          <h1 className="mt-6 text-2xl font-semibold tracking-tight">{t("succeeded")}</h1>
          <p className="mt-4 text-2xl font-bold tabular-nums" dir="ltr">
            {amountLabel(payment.total)} <span className="text-base text-neutral-500">LMA</span>
          </p>
          <p className="mt-3 max-w-xs text-sm leading-6 text-neutral-500">
            {payment.merchant.name} · {t("successHint")}
          </p>
        </div>
        {payment.subscription_id && (
          <div className="mb-5 text-center">
            <p className="text-xs text-neutral-500">
              {subscriptionCanceled ? t("renewalsCanceled") : t("renewalsHint")}
            </p>
            {!subscriptionCanceled && (
              <Button
                type="button"
                variant="outline"
                className="mt-3 rounded-full"
                disabled={busy}
                onClick={() => void onCancelRenewals()}
              >
                {busy ? t("processing") : t("cancelRenewals")}
              </Button>
            )}
          </div>
        )}
        {error && (
          <p role="alert" className="mb-4 text-sm text-red-600">
            {error}
          </p>
        )}
        {reference}
      </div>
    );

  if (!payable)
    return (
      <div
        key="inactive"
        className="louma-checkout-state flex min-h-[440px] flex-col justify-center gap-5 px-8 pb-8 text-center"
      >
        <div role="status">
          <h1 className="text-xl font-semibold">
            {expired ? t("expired") : payment.status === "canceled" ? t("canceled") : t("failed")}
          </h1>
          <p className="mt-3 text-sm leading-6 text-neutral-500">{t("newCheckout")}</p>
        </div>
        {reference}
      </div>
    );

  return (
    <form
      key="review"
      ref={form}
      onSubmit={(event) => void confirm(event)}
      className="louma-checkout-state flex min-h-[440px] flex-col px-5 pb-6 sm:px-7"
    >
      <div className="pt-4 text-center">
        <p className="text-xs text-neutral-500">{t("merchant")}</p>
        {payment.merchant.image ? (
          <img
            src={payment.merchant.image}
            alt=""
            aria-hidden="true"
            className="mx-auto mt-4 size-20 rounded-full border border-neutral-200 object-cover"
          />
        ) : (
          <span
            aria-hidden="true"
            className="mx-auto mt-4 grid size-20 place-items-center rounded-full bg-violet-100 font-display text-2xl font-bold text-violet-700"
          >
            {Array.from(payment.merchant.name.trim()).slice(0, 2).join("").toUpperCase()}
          </span>
        )}
        <h1 className="mt-3 break-words text-lg font-semibold tracking-tight">
          {payment.merchant.name}
        </h1>
        <p className="mt-3 flex flex-wrap items-baseline justify-center gap-2" dir="ltr">
          <strong className="break-all font-display text-[clamp(32px,9vw,40px)] leading-none font-bold tracking-tight tabular-nums">
            {amountLabel(payment.total)}
          </strong>
          <span className="text-xl font-semibold text-neutral-500">LMA</span>
        </p>
        {payment.description && (
          <p className="mt-2 break-words text-xs text-neutral-500">{payment.description}</p>
        )}
      </div>
      {payment.recurring && (
        <fieldset className="mb-5 rounded-2xl border border-neutral-200 p-4 text-sm">
          <legend className="px-1 font-medium">{t("recurring")}</legend>
          <p className="flex justify-between gap-2">
            <span dir="ltr">{amountLabel(payment.recurring.amount)} LMA</span>
            <span className="text-neutral-500">
              {payment.recurring.interval === "year" ? t("yearly") : t("monthly")}
            </span>
          </p>
          <label className="mt-3 flex items-start gap-3">
            <input
              type="checkbox"
              checked={consent}
              onChange={(event) => setConsent(event.target.checked)}
              required
              className="mt-1 size-4 shrink-0 accent-violet-500"
            />
            <span className="text-xs leading-6 text-neutral-500">{t("recurringHint")}</span>
          </label>
        </fieldset>
      )}
      {factors.transferPassword && (
        <label className="mb-4 block space-y-2 text-xs">
          <span>{t("password")}</span>
          <Input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="off"
            required
            maxLength={128}
          />
        </label>
      )}
      {factors.twoFactor && (
        <label className="mb-4 block space-y-2 text-xs">
          <span>{t("code")}</span>
          <Input
            value={code}
            onChange={(event) => setCode(event.target.value)}
            autoComplete="one-time-code"
            required
            maxLength={64}
            dir="ltr"
          />
        </label>
      )}
      {(factors.transferPassword || factors.twoFactor) && (
        <p className="mb-4 text-xs leading-5 text-neutral-500">{t("credentialHint")}</p>
      )}
      {frozen && (
        <p role="alert" className="mb-4 text-sm text-red-600">
          {t("frozen")}
        </p>
      )}
      {(factors.error || error) && (
        <p
          role="alert"
          className="mb-4 rounded-xl border border-red-600/20 bg-red-50 p-3 text-sm text-red-600"
        >
          {factors.error || error}
        </p>
      )}
      <div className="mt-auto pt-3">
        <SlideToPay disabled={disabled} onComplete={() => form.current?.requestSubmit()} />
        <p className="mt-2 text-center text-[10px] text-neutral-500">{t("approvalHint")}</p>
      </div>
    </form>
  );
}
