import { useState, type FormEvent } from "react";
import { messageForError } from "@/shared/api";
import { paymentApi, type MerchantApplication, type PaymentMode } from "@/shared/api/payments";
import { useT } from "@/shared/i18n";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Panel } from "@/shared/ui/panels";

const isImageUrl = (value: string) => value === "" || /^https:\/\/[^\s]+$/.test(value);

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
  const [image, setImage] = useState(application.image_url ?? "");
  const [imageError, setImageError] = useState("");
  const accepting = application.status === "active";
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const entered = new FormData(event.currentTarget);
    const imageUrl = String(entered.get("image_url") ?? "").trim();
    if (!isImageUrl(imageUrl)) {
      setImageError(t("invalidImage"));
      return;
    }
    setImageError("");
    setBusy(true);
    setError("");
    try {
      await paymentApi.updateApplication(mode, application.id, {
        name: String(entered.get("name") ?? "").trim(),
        domains: String(entered.get("domains") ?? "")
          .split(",")
          .map((domain) => domain.trim())
          .filter(Boolean),
        image_url: imageUrl,
      });
      await onSaved();
    } catch (failure) {
      setError(messageForError(failure));
    } finally {
      setBusy(false);
    }
  };
  const toggle = async (enabled: boolean) => {
    setBusy(true);
    setError("");
    try {
      await paymentApi.updateApplication(mode, application.id, {
        status: enabled ? "active" : "disabled",
      });
      await onSaved();
    } catch (failure) {
      setError(messageForError(failure));
    } finally {
      setBusy(false);
    }
  };
  return (
    <details className="rounded-[22px] border bg-card" open>
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
            <span className="font-medium">{t("storeImage")}</span>
            <Input
              name="image_url"
              value={image}
              onChange={(event) => setImage(event.target.value)}
              dir="ltr"
              placeholder="https://"
              maxLength={2048}
              autoComplete="off"
            />
            <span className="block text-xs text-muted-foreground">{t("storeImageHint")}</span>
          </label>
          {image && isImageUrl(image.trim()) && (
            <div className="flex items-center gap-3 sm:col-span-2">
              <img
                src={image.trim()}
                alt=""
                className="size-12 rounded-full border object-cover"
                onError={(event) => {
                  event.currentTarget.style.display = "none";
                }}
              />
            </div>
          )}
          {imageError && (
            <p role="alert" className="text-sm text-destructive sm:col-span-2">
              {imageError}
            </p>
          )}
          <label className="space-y-1.5 text-sm">
            <span className="font-medium">{t("domains")}</span>
            <Input
              name="domains"
              defaultValue={application.domains.join(",")}
              dir="ltr"
              maxLength={2048}
            />
          </label>
          <div className="space-y-1.5 text-sm">
            <span className="font-medium">{t("receivingWallet")}</span>
            <Input value={walletAddress} readOnly dir="ltr" aria-readonly />
            <span className="block text-xs text-muted-foreground">{t("walletLocked")}</span>
          </div>
          <div className="flex items-end">
            <Button type="submit" disabled={busy}>
              {t("save")}
            </Button>
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive sm:col-span-2">
              {error}
            </p>
          )}
        </form>
        <div className="mt-5 flex items-center justify-between gap-3 border-t pt-5">
          <div>
            <p className="text-sm font-medium">{t("paymentsEnabled")}</p>
            <p className="mt-1 text-xs text-muted-foreground">{t("paymentsEnabledHint")}</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={accepting}
            aria-label={t("paymentsEnabled")}
            disabled={busy}
            onClick={() => void toggle(!accepting)}
            className={`relative h-7 w-12 shrink-0 cursor-pointer rounded-full transition-colors disabled:opacity-50 ${
              accepting ? "bg-primary" : "bg-neutral-300"
            }`}
          >
            <span
              aria-hidden
              className={`absolute top-1 size-5 rounded-full bg-white shadow transition-all ${
                accepting ? "start-6" : "start-1"
              }`}
            />
          </button>
        </div>
      </Panel>
    </details>
  );
}
