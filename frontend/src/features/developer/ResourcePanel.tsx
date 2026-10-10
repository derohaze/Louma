import { useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { messageForError } from "@/shared/api";
import { paymentApi, type GatewayResource, type PaymentMode } from "@/shared/api/payments";
import { useT } from "@/shared/i18n";
import { moneyFromMinorUnits } from "@/shared/lib/wallet";
import { Button } from "@/shared/ui/button";
import { Panel } from "@/shared/ui/panels";
import { ResourceForm, type CreateResource } from "./ResourceForm";

export type Resource =
  | "credentials"
  | "checkouts"
  | "payments"
  | "links"
  | "products"
  | "prices"
  | "subscriptions"
  | "invoices"
  | "refunds"
  | "webhooks"
  | "deliveries"
  | "usage";
const writable = new Set<Resource>([
  "credentials",
  "checkouts",
  "links",
  "products",
  "prices",
  "refunds",
  "webhooks",
]);
const actionFor: Partial<
  Record<
    Resource,
    { action: string; label: "revoke" | "cancel" | "disableResource" | "retryDelivery" }
  >
> = {
  credentials: { action: "revoke", label: "revoke" },
  subscriptions: { action: "cancel", label: "cancel" },
  links: { action: "disable", label: "disableResource" },
  webhooks: { action: "disable", label: "disableResource" },
  deliveries: { action: "retry", label: "retryDelivery" },
};

export function ResourcePanel({
  mode,
  applicationId,
  resource,
  readOnly = false,
}: {
  mode: PaymentMode;
  applicationId: string;
  resource: Resource;
  /** Hide the manual create form; the list shows real records only. */
  readOnly?: boolean;
}) {
  const t = useT("developer");
  const [secret, setSecret] = useState("");
  const [error, setError] = useState("");
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const listing = useInfiniteQuery({
    queryKey: ["account", "developer", mode, applicationId, resource],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => paymentApi.resources(mode, applicationId, resource, pageParam),
    getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
    enabled: resource !== "usage",
  });
  const usage = useQuery({
    queryKey: ["account", "developer", mode, applicationId, "usage", "summary"],
    queryFn: () => paymentApi.usage(mode, applicationId),
    enabled: resource === "usage",
  });
  const records = listing.data?.pages.flatMap((page) => page.data ?? []) ?? [];
  const created = (record: GatewayResource) => {
    const revealed = record["secret"] ?? record["api_key"] ?? record["signing_secret"];
    if (typeof revealed === "string") setSecret(revealed);
    void listing.refetch();
  };
  const runAction = async (record: GatewayResource, atPeriodEnd?: boolean) => {
    const operation = actionFor[resource];
    if (!operation) return;
    setActionBusy(record.id);
    setError("");
    try {
      await paymentApi.action(
        mode,
        resource,
        record.id,
        operation.action,
        crypto.randomUUID(),
        atPeriodEnd === undefined ? {} : { at_period_end: atPeriodEnd },
      );
      await listing.refetch();
    } catch (failure) {
      setError(messageForError(failure));
    } finally {
      setActionBusy(null);
    }
  };
  if (resource === "usage")
    return (
      <Panel
        title={t("usage")}
        action={
          <Button
            variant="outline"
            onClick={() => void usage.refetch()}
            disabled={usage.isFetching}
          >
            {t("refresh")}
          </Button>
        }
      >
        {usage.isPending && <p role="status">{t("loading")}</p>}
        {usage.error && (
          <p role="alert" className="text-sm text-destructive">
            {messageForError(usage.error)}
          </p>
        )}
        {usage.data && (
          <dl className="grid gap-5 sm:grid-cols-3">
            {(
              [
                ["requests", usage.data.requests],
                ["errors", usage.data.errors],
                ["rateLimit", usage.data.rate_limit_per_minute],
              ] as const
            ).map(([label, value]) => (
              <div key={label}>
                <dt className="text-sm text-muted-foreground">{t(label)}</dt>
                <dd className="mt-2 text-2xl font-semibold tabular-nums" dir="ltr">
                  {value}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </Panel>
    );
  return (
    <div className="space-y-5">
      {secret && (
        <Panel title={t("secretTitle")} description={t("secretHint")}>
          <code dir="ltr" className="block break-all rounded-lg bg-secondary p-3 text-sm">
            {secret}
          </code>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                void navigator.clipboard
                  .writeText(secret)
                  .then(() => setCopied(true))
                  .catch((failure: unknown) => setError(messageForError(failure)))
              }
            >
              {t(copied ? "copied" : "copy")}
            </Button>
            <Button
              type="button"
              onClick={() => {
                setSecret("");
                setCopied(false);
              }}
            >
              {t("dismiss")}
            </Button>
          </div>
        </Panel>
      )}
      {!readOnly && writable.has(resource) && (
        <Panel title={`${t("create")} · ${t(resource)}`}>
          <ResourceForm
            mode={mode}
            applicationId={applicationId}
            resource={resource as CreateResource}
            onCreated={created}
          />
        </Panel>
      )}
      <Panel
        title={t(resource)}
        action={
          <Button
            variant="outline"
            onClick={() => void listing.refetch()}
            disabled={listing.isFetching}
          >
            {t("refresh")}
          </Button>
        }
      >
        {listing.isPending && (
          <p role="status" className="text-sm text-muted-foreground">
            {t("loading")}
          </p>
        )}
        {(listing.error || error) && (
          <p role="alert" className="mb-4 text-sm text-destructive">
            {error || messageForError(listing.error)}
          </p>
        )}
        {!listing.isPending && records.length === 0 && (
          <p className="text-sm text-muted-foreground">{t("empty")}</p>
        )}
        {records.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[600px] text-start text-sm">
              <thead className="border-b text-muted-foreground">
                <tr>
                  {["id", "name", "status", "amount", "actions"].map((label) => (
                    <th key={label} scope="col" className="px-2 py-3 text-start font-medium">
                      {t(label as "id" | "name" | "status" | "amount" | "actions")}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {records.map((record) => (
                  <tr key={record.id} className="border-b last:border-0">
                    <td className="max-w-[210px] px-2 py-4">
                      <code dir="ltr" className="block break-all text-xs">
                        {record.id}
                      </code>
                      {record.created_at && (
                        <time
                          dateTime={record.created_at}
                          className="mt-1 block text-xs text-muted-foreground"
                        >
                          {new Date(record.created_at).toLocaleDateString()}
                        </time>
                      )}
                    </td>
                    <td className="max-w-[200px] px-2 py-4">
                      <span className="break-words">
                        {record.name ?? record.description ?? record.prefix ?? "—"}
                      </span>
                      {record.scopes && (
                        <p className="mt-1 break-all text-xs text-muted-foreground" dir="ltr">
                          {record.scopes.join(", ")}
                        </p>
                      )}
                    </td>
                    <td className="px-2 py-4">{record.status ?? "—"}</td>
                    <td className="whitespace-nowrap px-2 py-4" dir="ltr">
                      {record.amount ??
                        record.total ??
                        (typeof record.amount_minor === "number"
                          ? moneyFromMinorUnits(record.amount_minor)
                          : "—")}
                    </td>
                    <td className="px-2 py-4">
                      <div className="flex flex-wrap gap-2">
                        {(record.checkout_url || (resource === "links" && record.url)) && (
                          <a
                            href={String(record.checkout_url ?? record.url)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex min-h-10 items-center text-primary underline"
                          >
                            {t("checkoutUrl")}
                          </a>
                        )}
                        {actionFor[resource] &&
                          !["revoked", "disabled", "canceled"].includes(record.status ?? "") && (
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={actionBusy === record.id}
                              onClick={() =>
                                void runAction(
                                  record,
                                  resource === "subscriptions" ? false : undefined,
                                )
                              }
                            >
                              {t(actionFor[resource]!.label)}
                            </Button>
                          )}
                        {resource === "subscriptions" && record.status !== "canceled" && (
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={actionBusy === record.id}
                            onClick={() => void runAction(record, true)}
                          >
                            {t("periodEnd")}
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {listing.hasNextPage && (
          <Button
            variant="outline"
            className="mt-4"
            disabled={listing.isFetchingNextPage}
            onClick={() => void listing.fetchNextPage()}
          >
            {t("more")}
          </Button>
        )}
      </Panel>
    </div>
  );
}
