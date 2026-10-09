import { useState, type FormEvent } from "react";
import { messageForError } from "@/shared/api";
import { paymentApi, type MerchantApplication, type PaymentMode } from "@/shared/api/payments";
import { useT } from "@/shared/i18n";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Panel } from "@/shared/ui/panels";

export function ApplicationSettings({
  mode,
  application,
  walletAddress,
  onSaved,
}: {
  mode: PaymentMode;
  application: MerchantApplication;
  walletAddress: string;
  onSaved: () => Promise<unknown>;
}) {
  const t = useT("developer");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const entered = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      await paymentApi.updateApplication(mode, application.id, {
        name: String(entered.get("name") ?? "").trim(),
        domains: String(entered.get("domains") ?? "")
          .split(",")
          .map((domain) => domain.trim())
          .filter(Boolean),
      });
      await onSaved();
    } catch (failure) {
      setError(messageForError(failure));
    } finally {
      setBusy(false);
    }
  };
  return (
    <details className="rounded-[22px] border bg-card">
      <summary className="cursor-pointer px-5 py-4 text-sm font-semibold">
        {t("application")} · {application.name}
      </summary>
      <Panel title={t("application")} className="border-0 shadow-none">
        <form
          key={application.id}
          onSubmit={(event) => void save(event)}
          className="grid gap-4 sm:grid-cols-2"
        >
          <label className="space-y-1.5 text-sm">
            <span className="font-medium">{t("name")}</span>
            <Input name="name" defaultValue={application.name} required maxLength={120} />
          </label>
          <label className="space-y-1.5 text-sm">
            <span className="font-medium">{t("domains")}</span>
            <Input
              name="domains"
              defaultValue={application.domains.join(",")}
              dir="ltr"
              maxLength={2048}
            />
          </label>
          <label className="space-y-1.5 text-sm">
            <span className="font-medium">{t("receivingWallet")}</span>
            <Input value={walletAddress} readOnly dir="ltr" />
          </label>
          <div className="flex items-end">
            <Button type="submit" disabled={busy || application.status !== "active"}>
              {t("save")}
            </Button>
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive sm:col-span-2">
              {error}
            </p>
          )}
        </form>
      </Panel>
    </details>
  );
}
