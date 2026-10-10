import { useState, type FormEvent } from "react";
import { paymentApi } from "@/shared/api/payments";
import { messageForError } from "@/shared/api";
import { useT } from "@/shared/i18n";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Panel } from "@/shared/ui/panels";
import type { DeveloperScopeValue } from "./DeveloperScope";

export function PaymentSetup({ scope }: { scope: DeveloperScopeValue }) {
  const t = useT("developer");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [key, setKey] = useState(() => crypto.randomUUID());
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!scope.wallet) return;
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      const merchant = await paymentApi.createApplication(
        scope.mode,
        {
          name: String(form.get("name") ?? "").trim(),
          wallet_id: scope.wallet.id,
          domains: String(form.get("domains") ?? "")
            .split(",")
            .map((v) => v.trim())
            .filter(Boolean),
        },
        key,
      );
      scope.selectApplication(merchant.id);
      await scope.applications.refetch();
    } catch (failure) {
      setError(messageForError(failure));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Panel title={t("setup.title")} description={t("setup.description")}>
      <form
        onSubmit={(event) => void submit(event)}
        onChange={() => {
          if (error) {
            setError("");
            setKey(crypto.randomUUID());
          }
        }}
        className="max-w-xl space-y-5"
      >
        <label className="block space-y-2 text-sm font-medium">
          <span>{t("setup.name")}</span>
          <Input name="name" required maxLength={120} placeholder={t("setup.nameHint")} />
        </label>
        <p className="text-sm text-muted-foreground">{t("setup.walletHint")}</p>
        <details className="rounded-xl border p-4">
          <summary className="cursor-pointer text-sm font-medium">{t("setup.optional")}</summary>
          <label className="mt-4 block space-y-2 text-sm">
            <span>{t("domains")}</span>
            <Input name="domains" dir="ltr" placeholder="shop.example.com" maxLength={2048} />
            <span className="block text-xs text-muted-foreground">{t("setup.domainsHint")}</span>
          </label>
        </details>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <Button type="submit" disabled={busy || scope.wallet?.status !== "active"}>
          {busy ? t("loading") : t("setup.continue")}
        </Button>
      </form>
    </Panel>
  );
}
