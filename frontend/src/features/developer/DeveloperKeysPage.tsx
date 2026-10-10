import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { messageForError } from "@/shared/api";
import { paymentApi, type GatewayResource, type PaymentMode } from "@/shared/api/payments";
import { useT } from "@/shared/i18n";
import { Button } from "@/shared/ui/button";
import { Panel } from "@/shared/ui/panels";
import { DeveloperScopeGate, useDeveloperScope } from "./DeveloperScope";

/** Simple v1 keys: fixed permissions (create checkouts + read payments), no expiry. */
const DEFAULT_KEY_SCOPES = ["checkout:create", "payments:read"];

/**
 * The key page: one application's merchant API keys, and nothing else.
 *
 * A key is minted per application and per environment, is returned exactly once, and is what a
 * merchant server authenticates with. The page keeps that lifecycle in one place — scopes in, the
 * key out, the key revoked — instead of spreading it over the resource catalogue.
 */
export function DeveloperKeysPage() {
  const t = useT("developer");
  const scope = useDeveloperScope();
  return (
    <DeveloperScopeGate
      scope={scope}
      title={t("keysPage.title")}
      description={t("keysPage.description")}
    >
      {(ready) => (
        <ApplicationKeys
          key={`${ready.mode}:${ready.application.id}`}
          mode={ready.mode}
          applicationId={ready.application.id}
        />
      )}
    </DeveloperScopeGate>
  );
}

function ApplicationKeys({ mode, applicationId }: { mode: PaymentMode; applicationId: string }) {
  const t = useT("developer");
  const [secret, setSecret] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [requestKey, setRequestKey] = useState(() => crypto.randomUUID());
  const keys = useQuery({
    queryKey: ["account", "developer", mode, applicationId, "credentials"],
    queryFn: () => paymentApi.resources(mode, applicationId, "credentials"),
  });
  const records = keys.data?.data ?? [];
  const createKey = async () => {
    setBusy(true);
    setError("");
    try {
      const created = await paymentApi.createResource(
        mode,
        applicationId,
        "credentials",
        { scopes: DEFAULT_KEY_SCOPES },
        requestKey,
      );
      const revealed = created["api_key"] ?? created["secret"];
      if (typeof revealed === "string") setSecret(revealed);
      setRequestKey(crypto.randomUUID());
      await keys.refetch();
    } catch (failure) {
      setError(messageForError(failure));
    } finally {
      setBusy(false);
    }
  };
  const revoke = async (record: GatewayResource) => {
    setRevoking(record.id);
    setError("");
    try {
      await paymentApi.action(mode, "credentials", record.id, "revoke", crypto.randomUUID());
      await keys.refetch();
    } catch (failure) {
      setError(messageForError(failure));
    } finally {
      setRevoking(null);
    }
  };
  return (
    <div className="space-y-5">
      {secret && (
        <Panel title={t("keysPage.saveTitle")} description={t("keysPage.saveHint")} tone="danger">
          <code dir="ltr" className="block break-all rounded-lg bg-secondary p-3 text-sm">
            {secret}
          </code>
          <p className="mt-4 text-sm text-muted-foreground">{t("keysPage.envHint")}</p>
          <code dir="ltr" className="mt-2 block break-all rounded-lg bg-secondary p-3 text-sm">
            {`LOUMA_API_KEY=${secret}`}
          </code>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                void navigator.clipboard.writeText(secret).catch((failure: unknown) => {
                  setError(messageForError(failure));
                })
              }
            >
              {t("copy")}
            </Button>
            <Button type="button" onClick={() => setSecret("")}>
              {t("dismiss")}
            </Button>
          </div>
        </Panel>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Panel title={t("keysPage.create")} description={t("keysPage.defaults")}>
        <div className="space-y-4">
          <Button
            type="button"
            disabled={busy}
            className="min-h-11"
            onClick={() => void createKey()}
          >
            {busy ? t("loading") : t("keysPage.create")}
          </Button>
        </div>
      </Panel>
      <Panel
        title={t("keysPage.listTitle")}
        action={
          <Button variant="outline" onClick={() => void keys.refetch()} disabled={keys.isFetching}>
            {t("refresh")}
          </Button>
        }
      >
        {keys.isPending && (
          <p role="status" className="text-sm text-muted-foreground">
            {t("loading")}
          </p>
        )}
        {!keys.isPending && records.length === 0 && (
          <p className="text-sm text-muted-foreground">{t("keysPage.empty")}</p>
        )}
        {records.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-start text-sm">
              <thead className="border-b text-muted-foreground">
                <tr>
                  {(["keysPage.prefix", "scopes", "status", "created", "actions"] as const).map(
                    (label) => (
                      <th key={label} scope="col" className="px-2 py-3 text-start font-medium">
                        {t(label)}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {records.map((record) => (
                  <tr key={record.id} className="border-b last:border-0">
                    <td className="max-w-[240px] px-2 py-4">
                      <code dir="ltr" className="block break-all text-xs">
                        {record.prefix ?? record.id}
                      </code>
                    </td>
                    <td className="max-w-[240px] px-2 py-4">
                      <span className="break-all text-xs text-muted-foreground" dir="ltr">
                        {record.scopes?.join(", ") ?? "—"}
                      </span>
                    </td>
                    <td className="px-2 py-4">{record.status ?? "—"}</td>
                    <td className="whitespace-nowrap px-2 py-4">
                      {record.created_at ? (
                        <time dateTime={record.created_at}>
                          {new Date(record.created_at).toLocaleDateString()}
                        </time>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-2 py-4">
                      {!["revoked", "disabled"].includes(record.status ?? "") && (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={revoking === record.id}
                          onClick={() => void revoke(record)}
                        >
                          {t("revoke")}
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-3 text-xs text-muted-foreground">{t("keysPage.revokeHint")}</p>
          </div>
        )}
        <div className="mt-5 rounded-xl border bg-secondary/30 p-4">
          <p className="text-sm text-muted-foreground">{t("keysPage.checkHint")}</p>
          <code dir="ltr" className="mt-2 block break-all text-xs">
            {`const response = await fetch(process.env.LOUMA_BASE_URL + '/v1/payments', {
  headers: { Authorization: \`Bearer \${process.env.LOUMA_API_KEY}\` },
});
if (!response.ok) throw new Error('Payment check failed');
const payments = await response.json();`}
          </code>
        </div>
      </Panel>
    </div>
  );
}
