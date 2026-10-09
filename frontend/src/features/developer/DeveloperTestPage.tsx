import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, messageForError, type ApiSecurityOverview } from "@/shared/api";
import {
  paymentApi,
  type CheckoutDetails,
  type MerchantApplication,
  type PaymentMode,
} from "@/shared/api/payments";
import { CheckoutExperience, CheckoutShell } from "@/features/checkout/CheckoutExperience";
import { useT } from "@/shared/i18n";
import { moneyFromMinorUnits, moneyToMinorUnits } from "@/shared/lib/wallet";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Panel } from "@/shared/ui/panels";
import { DeveloperScopeGate, useDeveloperScope } from "./DeveloperScope";

/** A reference shaped like a real one, so the preview reads exactly like the payer's page. */
const SAMPLE_ID = "00000000-0000-4000-8000-000000000000";
const SAMPLE_WALLET = `LMA${"0".repeat(27)}`;
/** The gateway's documented default fee (basis points), for the sample object only — the payer
 *  never sees the fee line, and the real figure is always the gateway's. */
const SAMPLE_FEE_BASIS_POINTS = 100;

/**
 * What a payment looks like from the payer's side, before anyone pays.
 *
 * The preview is not a drawing of the checkout: it is the same `CheckoutExperience` the live
 * `/checkout` route renders, fed a sample record, so the merchant sets an amount and sees the page
 * the buyer will get — same layout, same wording, same states. The checkout action below creates a
 * gateway record and links to its page.
 */
export function DeveloperTestPage() {
  const t = useT("developer");
  const scope = useDeveloperScope();
  return (
    <DeveloperScopeGate
      scope={scope}
      title={t("testPage.title")}
      description={t("testPage.description")}
    >
      {(ready) => (
        <TestPayment
          key={`${ready.mode}:${ready.application.id}`}
          mode={ready.mode}
          application={ready.application}
          walletAddress={ready.wallet?.address ?? ""}
        />
      )}
    </DeveloperScopeGate>
  );
}

function TestPayment({
  mode,
  application,
  walletAddress,
}: {
  mode: PaymentMode;
  application: MerchantApplication;
  walletAddress: string;
}) {
  const t = useT("developer");
  const security = useQuery({
    queryKey: ["account", "checkout-security"],
    queryFn: () => api.get<ApiSecurityOverview>("/api/v1/security"),
  });
  const [merchant, setMerchant] = useState(application.name);
  const [description, setDescription] = useState("Order 42");
  const [draft, setDraft] = useState({ subtotal: "10.0000", tax: "0.0000", recurring: "29.0000" });
  const [amounts, setAmounts] = useState(draft);
  const [invalid, setInvalid] = useState(false);
  const [interval, setInterval] = useState<"none" | "month" | "year">("none");
  const [settled, setSettled] = useState(false);
  const [renewalsCanceled, setRenewalsCanceled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [requestKey, setRequestKey] = useState(() => crypto.randomUUID());
  const [created, setCreated] = useState<{ id: string; url: string } | null>(null);
  const changeAmount = (amount: string, value: string) => {
    const next = { ...draft, [amount]: value };
    setDraft(next);
    // The preview keeps the last complete, valid amount rather than blanking out mid-typing.
    try {
      moneyToMinorUnits(next.subtotal);
      moneyToMinorUnits(next.tax);
      if (interval !== "none") moneyToMinorUnits(next.recurring);
      setAmounts(next);
      setInvalid(false);
    } catch {
      setInvalid(true);
    }
  };
  const subtotalMinor = moneyToMinorUnits(amounts.subtotal);
  const totalMinor = subtotalMinor + moneyToMinorUnits(amounts.tax);
  const feeMinor = Math.floor((subtotalMinor * SAMPLE_FEE_BASIS_POINTS) / 10_000);
  const recurring = interval !== "none";
  const sample: CheckoutDetails = {
    id: SAMPLE_ID,
    payment_id: SAMPLE_ID,
    status: settled ? "succeeded" : "requires_action",
    intent_hash: "0".repeat(64),
    currency: "LMA",
    subtotal: amounts.subtotal,
    tax: amounts.tax,
    total: moneyFromMinorUnits(totalMinor),
    fee: moneyFromMinorUnits(feeMinor),
    merchant_net: moneyFromMinorUnits(totalMinor - feeMinor),
    description,
    expires_at: new Date(Date.now() + 30 * 60_000).toISOString(),
    ...(recurring ? { subscription_id: SAMPLE_ID } : {}),
    merchant: { id: application.id, name: merchant.trim() || application.name },
    payer_wallet: {
      id: SAMPLE_ID,
      address: walletAddress || SAMPLE_WALLET,
      status: "active",
    },
    ...(recurring
      ? {
          recurring: {
            price_id: SAMPLE_ID,
            amount: amounts.recurring,
            interval: interval === "year" ? "year" : "month",
            consent_policy_version: "1.0",
            description,
          },
        }
      : {}),
  };
  const createCheckout = async () => {
    setBusy(true);
    setError("");
    try {
      const checkout = await paymentApi.createResource(
        mode,
        application.id,
        "checkouts",
        {
          subtotal: amounts.subtotal,
          tax: amounts.tax,
          currency: "LMA",
          description: description.trim() || application.name,
        },
        requestKey,
      );
      const url = checkout["checkout_url"];
      setCreated({ id: checkout.id, url: typeof url === "string" ? url : "" });
      setRequestKey(crypto.randomUUID());
    } catch (failure) {
      setError(messageForError(failure));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-5">
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Panel title={t("testPage.playground")} description={t("testPage.playgroundHint")}>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="space-y-1.5 text-sm">
            <span className="font-medium">{t("testPage.merchantName")}</span>
            <Input
              value={merchant}
              onChange={(event) => setMerchant(event.target.value)}
              maxLength={120}
              autoComplete="off"
            />
          </label>
          <label className="space-y-1.5 text-sm">
            <span className="font-medium">{t("descriptionLabel")}</span>
            <Input
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              maxLength={240}
              autoComplete="off"
            />
          </label>
          <label className="space-y-1.5 text-sm">
            <span className="font-medium">{t("subtotal")}</span>
            <Input
              value={draft.subtotal}
              onChange={(event) => changeAmount("subtotal", event.target.value)}
              dir="ltr"
              inputMode="decimal"
              autoComplete="off"
            />
          </label>
          <label className="space-y-1.5 text-sm">
            <span className="font-medium">{t("tax")}</span>
            <Input
              value={draft.tax}
              onChange={(event) => changeAmount("tax", event.target.value)}
              dir="ltr"
              inputMode="decimal"
              autoComplete="off"
            />
          </label>
          <label className="space-y-1.5 text-sm">
            <span className="font-medium">{t("interval")}</span>
            <select
              value={interval}
              onChange={(event) => setInterval(event.target.value as "none" | "month" | "year")}
              className="h-11 w-full rounded-xl border bg-card px-4"
            >
              <option value="none">{t("one_time")}</option>
              <option value="month">{t("monthly")}</option>
              <option value="year">{t("yearly")}</option>
            </select>
          </label>
          {recurring && (
            <label className="space-y-1.5 text-sm">
              <span className="font-medium">{t("testPage.recurringAmount")}</span>
              <Input
                value={draft.recurring}
                onChange={(event) => changeAmount("recurring", event.target.value)}
                dir="ltr"
                inputMode="decimal"
                autoComplete="off"
              />
            </label>
          )}
        </div>
        {invalid && (
          <p role="alert" className="mt-4 text-sm text-destructive">
            {t("testPage.invalidAmount")}
          </p>
        )}
        <p className="mt-4 text-xs text-muted-foreground">
          {t("testPage.payerWallet", { address: walletAddress || SAMPLE_WALLET })}
        </p>
      </Panel>
      <Panel
        title={t("testPage.preview")}
        description={t("testPage.previewHint")}
        bodyClassName="p-0"
        action={
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setSettled(false);
              setRenewalsCanceled(false);
            }}
          >
            {t("testPage.reset")}
          </Button>
        }
      >
        <div className="overflow-x-auto p-4">
          <div className="mx-auto min-w-[360px] max-w-[432px] overflow-hidden rounded-3xl border">
            <CheckoutShell standalone={false}>
              <CheckoutExperience
                payment={sample}
                factors={{
                  transferPassword: security.data?.transferPassword.enabled ?? false,
                  twoFactor: security.data?.twoFactor.enabled ?? false,
                  pending: security.isPending,
                  error: security.error ? messageForError(security.error) : "",
                }}
                busy={false}
                error=""
                subscriptionCanceled={renewalsCanceled}
                onConfirm={() => {
                  setSettled(true);
                  return Promise.resolve(true);
                }}
                onCancelRenewals={() => {
                  setRenewalsCanceled(true);
                  return Promise.resolve();
                }}
              />
            </CheckoutShell>
          </div>
        </div>
      </Panel>
      <Panel title={t("testPage.createCheckout")} description={t("testPage.createCheckoutHint")}>
        <Button onClick={() => void createCheckout()} disabled={busy} className="min-h-11">
          {busy ? t("loading") : t("testPage.createCheckout")}
        </Button>
        {created && (
          <div className="mt-4 rounded-xl border bg-secondary/30 p-4">
            <p className="text-sm">
              {t("id")}:{" "}
              <code dir="ltr" className="break-all text-xs">
                {created.id}
              </code>
            </p>
            {created.url && (
              <a
                href={created.url}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 inline-flex min-h-10 items-center font-medium text-primary underline"
              >
                {t("testPage.openCheckout")}
              </a>
            )}
          </div>
        )}
      </Panel>
      <Panel title={t("testPage.stepsTitle")}>
        <div className="grid gap-3 sm:grid-cols-2">
          {(["server", "gateway", "payer", "settlement"] as const).map((step) => (
            <p key={step} className="rounded-xl border bg-card px-4 py-3 text-sm leading-6">
              {t(`testPage.steps.${step}`)}
            </p>
          ))}
        </div>
      </Panel>
    </div>
  );
}
