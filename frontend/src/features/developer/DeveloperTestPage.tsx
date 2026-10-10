import { useState } from "react";
import type { MerchantApplication } from "@/shared/api/payments";
import { useT } from "@/shared/i18n";
import { moneyToMinorUnits } from "@/shared/lib/wallet";
import { Input } from "@/shared/ui/input";
import { Panel } from "@/shared/ui/panels";
import { DeveloperScopeGate, useDeveloperScope } from "./DeveloperScope";

const SAMPLE_WALLET = `LMA${"0".repeat(27)}`;

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
          application={ready.application}
          walletAddress={ready.wallet?.address ?? ""}
        />
      )}
    </DeveloperScopeGate>
  );
}

function TestPayment({
  application,
  walletAddress,
}: {
  application: MerchantApplication;
  walletAddress: string;
}) {
  const t = useT("developer");
  const [merchant, setMerchant] = useState(application.name);
  const [description, setDescription] = useState("Order 42");
  const [draft, setDraft] = useState({ subtotal: "50.0000", tax: "0.0000", recurring: "29.0000" });
  const [invalid, setInvalid] = useState(false);
  const [interval, setInterval] = useState<"none" | "month" | "year">("none");
  const changeAmount = (amount: string, value: string) => {
    const next = { ...draft, [amount]: value };
    setDraft(next);
    try {
      const subtotal = moneyToMinorUnits(next.subtotal);
      const tax = moneyToMinorUnits(next.tax);
      if (subtotal <= 0 || !Number.isSafeInteger(subtotal + tax))
        throw new RangeError("Invalid total");
      if (interval !== "none") moneyToMinorUnits(next.recurring);
      setInvalid(false);
    } catch {
      setInvalid(true);
    }
  };
  const recurring = interval !== "none";
  return (
    <div className="space-y-5">
      {import.meta.env.DEV && (
        <a
          href="/checkout?preview=1"
          className="inline-flex items-center rounded-xl border border-primary/30 bg-primary/5 px-5 py-3 text-sm font-medium text-primary"
        >
          {t("testPage.localPreview")}
        </a>
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
    </div>
  );
}
