import { useState, type FormEvent, type ReactNode } from "react";
import type { CheckoutDetails } from "@/shared/api/payments";
import { useI18n, useT } from "@/shared/i18n";
import { cn } from "@/shared/lib/platform";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { ArrowRight, Check, LockKeyhole, Wallet } from "lucide-react";

/**
 * Exactly what the confirm endpoint accepts, assembled from what the payer entered. The intent hash
 * always comes from the record the gateway returned, never from the page.
 */
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
  /**
   * True on the payer's own route, which is the whole document and fills the viewport. False where
   * the page is embedded in the developer preview: it then renders as a plain block, because a
   * document may only have one `main`, and the preview has none of the viewport to fill. Nothing
   * inside the card changes either way.
   */
  standalone?: boolean;
}) {
  const t = useT("checkout");
  const { language, setLanguage } = useI18n();
  const Frame = standalone ? "main" : "div";
  return (
    <Frame
      dir={language === "ar" ? "rtl" : "ltr"}
      className={cn("bg-background px-4 py-6 sm:py-10", standalone && "min-h-dvh")}
    >
      <div className="mx-auto w-full max-w-[432px]">
        <header className="mb-7 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <img
              src="/Louma_Brand_logos/png/louma-logo-128x128.png"
              alt=""
              width={38}
              height={38}
              className="rounded-full"
            />
            <div>
              <p className="font-display text-base font-semibold tracking-tight">Louma</p>
              <p className="text-xs text-muted-foreground">{t("payments")}</p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            lang={language === "en" ? "ar" : "en"}
            onClick={() => setLanguage(language === "en" ? "ar" : "en")}
          >
            {language === "en" ? "العربية" : "English"}
          </Button>
        </header>
        <section
          aria-labelledby="checkout-heading"
          className="overflow-hidden rounded-3xl border bg-card shadow-sm"
        >
          {children}
        </section>
        <footer className="mt-5 flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground">
          <LockKeyhole className="size-3" aria-hidden="true" />
          {t("poweredBy")}
        </footer>
      </div>
    </Frame>
  );
}

/**
 * The payment itself: merchant, exact amount, the wallet that will pay, the factor proof, and the
 * one button that moves money. Every payer sees this component — `/checkout` renders it with the
 * gateway's record, and the developer test page renders it from a sample, so a merchant previews
 * the exact markup and styles the buyer gets instead of a mock-up that can drift from them.
 *
 * It owns only what the payer types. Busy, error, and the settled/subscription state stay with the
 * caller, because the caller is what talks to the API.
 */
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
  /** The spend factors this payer has configured, and whether that read has finished. */
  factors: { transferPassword: boolean; twoFactor: boolean; pending: boolean; error: string };
  busy: boolean;
  error: string;
  subscriptionCanceled: boolean;
  /** Resolves `true` only when the gateway confirmed settlement, so a failed attempt keeps the input. */
  onConfirm: (proof: CheckoutProof) => Promise<boolean>;
  onCancelRenewals: () => Promise<void>;
}) {
  const t = useT("checkout");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [consent, setConsent] = useState(false);
  const confirmed = payment.status === "succeeded";
  const frozen = payment.payer_wallet?.status === "frozen";
  const expired =
    payment.status === "expired" ||
    (!!payment.expires_at && Date.parse(payment.expires_at) <= Date.now() && !confirmed);
  const payable = payment.status === "requires_action" && !expired;
  const confirm = async (event: FormEvent) => {
    event.preventDefault();
    const settled = await onConfirm({
      intent_hash: payment.intent_hash,
      ...(password ? { transferPassword: password } : {}),
      ...(code ? { twoFactorCode: code } : {}),
      ...(payment.recurring
        ? {
            recurring_consent: consent,
            policy_version: payment.recurring.consent_policy_version,
          }
        : {}),
    });
    if (settled) {
      setPassword("");
      setCode("");
    }
  };
  return (
    <>
      <div className="px-6 pb-6 pt-7 text-center sm:px-7 sm:pt-8">
        <p className="text-xs text-muted-foreground">{t("merchant")}</p>
        <h1 id="checkout-heading" className="mt-1 break-words font-display text-xl font-semibold">
          {payment.merchant?.name}
        </h1>
        <p className="mt-5 flex items-baseline justify-center gap-2" dir="ltr">
          <strong className="font-display text-[clamp(27px,8vw,42px)] font-semibold leading-tight tracking-[-1.7px] tabular-nums">
            {payment.total}
          </strong>
          <span className="text-sm text-muted-foreground">LMA</span>
        </p>
        {payment.description && (
          <p className="mt-3 break-words text-sm text-muted-foreground">{payment.description}</p>
        )}
      </div>
      <div className="mx-6 border-y py-4 sm:mx-7">
        <dl className="space-y-2 text-[13px]">
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">{t("subtotal")}</dt>
            <dd dir="ltr" className="tabular-nums">
              {payment.subtotal} LMA
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">{t("tax")}</dt>
            <dd dir="ltr" className="tabular-nums">
              {payment.tax} LMA
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">{t("total")}</dt>
            <dd dir="ltr" className="font-medium tabular-nums">
              {payment.total} LMA
            </dd>
          </div>
        </dl>
        <p className="mt-3 text-[11px] text-muted-foreground">{t("fee")}</p>
      </div>
      <div className="px-6 py-6 sm:px-7">
        {confirmed ? (
          <div role="status" className="text-center">
            <span className="mx-auto mb-3 flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Check className="size-5" aria-hidden="true" />
            </span>
            <p className="font-medium">{t("succeeded")}</p>
            <p className="mt-2 text-sm text-muted-foreground">{t("successHint")}</p>
            {payment.subscription_id && (
              <div className="mt-5 border-t pt-4">
                <p className="text-sm text-muted-foreground">
                  {subscriptionCanceled ? t("renewalsCanceled") : t("renewalsHint")}
                </p>
                {!subscriptionCanceled && (
                  <Button
                    type="button"
                    variant="outline"
                    className="mt-3 w-full rounded-xl"
                    disabled={busy}
                    onClick={() => void onCancelRenewals()}
                  >
                    {busy ? t("processing") : t("cancelRenewals")}
                  </Button>
                )}
                {error && (
                  <p role="alert" className="mt-3 text-sm text-destructive">
                    {error}
                  </p>
                )}
              </div>
            )}
          </div>
        ) : !payable ? (
          <div role="status" className="text-center">
            <p className="font-medium">
              {expired ? t("expired") : payment.status === "canceled" ? t("canceled") : t("failed")}
            </p>
            <p className="mt-2 text-sm text-muted-foreground">{t("newCheckout")}</p>
          </div>
        ) : (
          <form onSubmit={(event) => void confirm(event)} className="space-y-4">
            <div className="flex items-center gap-3 rounded-xl bg-muted/50 p-3">
              <Wallet className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">{t("wallet")}</p>
                <p className="mt-0.5 break-all font-mono text-xs" dir="ltr">
                  {payment.payer_wallet?.address ?? t("noWallet")}
                </p>
              </div>
            </div>
            {frozen && (
              <p role="alert" className="text-sm text-destructive">
                {t("frozen")}
              </p>
            )}
            {payment.recurring && (
              <fieldset className="rounded-xl border p-4 text-sm">
                <legend className="px-1 font-medium">{t("recurring")}</legend>
                <p className="flex flex-wrap justify-between gap-2">
                  <span dir="ltr" className="font-medium tabular-nums">
                    {payment.recurring.amount} LMA
                  </span>
                  <span className="text-muted-foreground">
                    {payment.recurring.interval === "year" ? t("yearly") : t("monthly")}
                  </span>
                </p>
                <label className="mt-3 flex items-start gap-3">
                  <input
                    type="checkbox"
                    checked={consent}
                    onChange={(event) => setConsent(event.target.checked)}
                    required
                    className="mt-1 size-4 shrink-0 accent-primary"
                  />
                  <span className="text-muted-foreground">{t("recurringHint")}</span>
                </label>
              </fieldset>
            )}
            {factors.transferPassword && (
              <label className="block space-y-1.5 text-sm">
                <span className="font-medium">{t("password")}</span>
                <Input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="off"
                  maxLength={128}
                />
              </label>
            )}
            {factors.twoFactor && (
              <label className="block space-y-1.5 text-sm">
                <span className="font-medium">{t("code")}</span>
                <Input
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                  autoComplete="one-time-code"
                  maxLength={64}
                  dir="ltr"
                />
              </label>
            )}
            {(factors.transferPassword || factors.twoFactor) && (
              <p className="text-xs text-muted-foreground">{t("credentialHint")}</p>
            )}
            {factors.error && (
              <p role="alert" className="text-sm text-destructive">
                {factors.error}
              </p>
            )}
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <Button
              type="submit"
              className="min-h-12 w-full gap-2 rounded-xl text-sm"
              disabled={
                busy ||
                !payment.payer_wallet ||
                frozen ||
                expired ||
                factors.pending ||
                !!factors.error ||
                (!!payment.recurring && !consent)
              }
            >
              {busy ? t("processing") : t("approve")}{" "}
              {!busy && <ArrowRight className="size-4 rtl:rotate-180" aria-hidden="true" />}
            </Button>
            <p className="text-center text-xs text-muted-foreground">{t("approvalHint")}</p>
          </form>
        )}
      </div>
      <div className="px-6 pb-6 text-center text-[10px] text-muted-foreground sm:px-7">
        <p>{t("reference")}</p>
        <code className="mt-1 block break-all font-mono" dir="ltr">
          {payment.payment_id}
        </code>
      </div>
    </>
  );
}
