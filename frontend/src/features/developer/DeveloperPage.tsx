import { useState, type FormEvent } from "react";
import { messageForError } from "@/shared/api";
import { paymentApi } from "@/shared/api/payments";
import { useT } from "@/shared/i18n";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Panel } from "@/shared/ui/panels";
import { useDeveloperScope } from "./DeveloperScope";
import { ResourcePanel, type Resource } from "./ResourcePanel";
import { ApplicationSettings } from "./ApplicationSettings";

const resources: Resource[] = [
  "credentials",
  "checkouts",
  "payments",
  "links",
  "products",
  "prices",
  "subscriptions",
  "invoices",
  "refunds",
  "webhooks",
  "deliveries",
  "usage",
];

export function DeveloperPage() {
  const t = useT("developer");
  const scope = useDeveloperScope();
  const { access, applications, selected, wallet, mode, available } = scope;
  const [resource, setResource] = useState<Resource | "docs">("payments");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [requestKey, setRequestKey] = useState(() => crypto.randomUUID());
  const createApplication = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!wallet) return;
    const form = event.currentTarget;
    const entered = new FormData(form);
    setBusy(true);
    setError("");
    try {
      const created = await paymentApi.createApplication(
        mode,
        {
          name: String(entered.get("name") ?? "").trim(),
          wallet_id: wallet.id,
          domains: String(entered.get("domains") ?? "")
            .split(",")
            .map((domain) => domain.trim())
            .filter(Boolean),
        },
        requestKey,
      );
      scope.selectApplication(created.id);
      setRequestKey(crypto.randomUUID());
      form.reset();
      await applications.refetch();
    } catch (failure) {
      setError(messageForError(failure));
    } finally {
      setBusy(false);
    }
  };
  const disableApplication = async () => {
    if (!selected) return;
    setBusy(true);
    setError("");
    try {
      await paymentApi.updateApplication(mode, selected.id, { status: "disabled" });
      await applications.refetch();
    } catch (failure) {
      setError(messageForError(failure));
    } finally {
      setBusy(false);
    }
  };
  if (access.isPending) return <p role="status">{t("loading")}</p>;
  if (access.error)
    return (
      <p role="alert" className="text-destructive">
        {messageForError(access.error)}
      </p>
    );
  if (!access.data?.eligible)
    return (
      <Panel title={t("title")}>
        <p>{t("denied")}</p>
      </Panel>
    );
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">{t("title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("description")}</p>
        </div>
        {selected && (
          <label className="min-w-48 space-y-1.5 text-sm">
            <span className="block font-medium">{t("application")}</span>
            <select
              value={selected.id}
              onChange={(event) => scope.selectApplication(event.target.value)}
              className="h-11 w-full rounded-xl border bg-card px-4"
            >
              {applications.data?.data.map((application) => (
                <option key={application.id} value={application.id}>
                  {application.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {!available ? (
        <p role="status">{t("unavailable")}</p>
      ) : (
        <>
          {(error || applications.error) && (
            <p role="alert" className="text-sm text-destructive">
              {error || messageForError(applications.error)}
            </p>
          )}
          <Panel title={t("createApplication")}>
            <form
              onSubmit={(event) => void createApplication(event)}
              onChange={() => {
                if (error) {
                  setRequestKey(crypto.randomUUID());
                  setError("");
                }
              }}
              className="grid gap-4 sm:grid-cols-2"
            >
              <label className="space-y-1.5 text-sm">
                <span className="font-medium">{t("name")}</span>
                <Input name="name" required maxLength={120} />
              </label>
              <label className="space-y-1.5 text-sm">
                <span className="font-medium">{t("domains")}</span>
                <Input name="domains" placeholder={t("domainsHint")} dir="ltr" maxLength={2048} />
              </label>
              <label className="space-y-1.5 text-sm">
                <span className="font-medium">{t("receivingWallet")}</span>
                <Input value={wallet?.address ?? ""} readOnly dir="ltr" />
              </label>
              <div className="flex items-end">
                <Button
                  type="submit"
                  disabled={busy || wallet?.status !== "active"}
                  className="min-h-11"
                >
                  {t("createApplication")}
                </Button>
              </div>
            </form>
          </Panel>
          {applications.isPending && <p role="status">{t("loading")}</p>}
          {!applications.isPending && !selected && <p>{t("noApplications")}</p>}
          {selected && (
            <>
              <ApplicationSettings
                key={`${mode}:${selected.id}`}
                mode={mode}
                application={selected}
                walletAddress={wallet?.address ?? ""}
                onSaved={() => applications.refetch()}
              />
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-muted-foreground">
                  {selected.name} · {selected.status}
                </p>
                <Button
                  variant="outline"
                  disabled={busy || ["disabled", "suspended"].includes(selected.status)}
                  onClick={() => void disableApplication()}
                >
                  {t("disable")}
                </Button>
              </div>
              <div role="tablist" aria-label={t("applications")} className="flex flex-wrap gap-2">
                {[...resources, "docs" as const].map((section) => (
                  <button
                    key={section}
                    type="button"
                    role="tab"
                    aria-selected={resource === section}
                    onClick={() => setResource(section)}
                    className={`min-h-10 rounded-full border px-4 text-sm font-medium ${resource === section ? "border-primary bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:text-foreground"}`}
                  >
                    {t(section)}
                  </button>
                ))}
              </div>
              {resource === "docs" ? (
                <Panel title={t("guide.title")}>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {(
                      ["keys", "checkout", "verify", "webhooks", "recurring", "access"] as const
                    ).map((paragraph) => (
                      <p
                        key={paragraph}
                        className="rounded-xl border bg-card px-4 py-3 text-sm leading-6"
                      >
                        {t(`guide.${paragraph}`)}
                      </p>
                    ))}
                  </div>
                </Panel>
              ) : (
                <ResourcePanel
                  key={`${mode}:${selected.id}:${resource}`}
                  mode={mode}
                  applicationId={selected.id}
                  resource={resource}
                />
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
