import { useState, type FormEvent } from "react";
import { messageForError } from "@/shared/api";
import { paymentApi, type PaymentMode, type GatewayResource } from "@/shared/api/payments";
import { useT } from "@/shared/i18n";
import type dictionary from "@/shared/i18n/locales/developer/en";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { DateTimePicker } from "./DateTimePicker";
import { ScopeToggleGroup } from "./ScopeToggleGroup";

export type CreateResource =
  "credentials" | "checkouts" | "links" | "products" | "prices" | "refunds" | "webhooks";
/** Only a key whose value is a plain string is a label; the page-level objects (keysPage,
 *  examplesPage, testPage, guide) are namespaces, not labels a form field can render. */
type Label = {
  [K in keyof typeof dictionary]: (typeof dictionary)[K] extends string ? K : never;
}[keyof typeof dictionary];
type Field = {
  key: string;
  label: Label;
  type?: "url" | "datetime-local";
  optional?: boolean;
  default?: string;
};
const fields: Record<CreateResource, Field[]> = {
  credentials: [{ key: "expires_at", label: "expires", type: "datetime-local", optional: true }],
  checkouts: [
    { key: "description", label: "descriptionLabel" },
    { key: "subtotal", label: "subtotal" },
    { key: "tax", label: "tax", default: "0" },
    { key: "success_url", label: "successUrl", type: "url", optional: true },
    { key: "cancel_url", label: "cancelUrl", type: "url", optional: true },
    { key: "price_id", label: "priceId", optional: true },
  ],
  links: [
    { key: "description", label: "descriptionLabel" },
    { key: "subtotal", label: "subtotal" },
    { key: "tax", label: "tax", default: "0" },
    { key: "success_url", label: "successUrl", type: "url", optional: true },
    { key: "cancel_url", label: "cancelUrl", type: "url", optional: true },
    { key: "price_id", label: "priceId", optional: true },
  ],
  products: [
    { key: "name", label: "name" },
    { key: "description", label: "descriptionLabel", optional: true },
  ],
  prices: [
    { key: "product_id", label: "productId" },
    { key: "amount", label: "amount" },
  ],
  refunds: [
    { key: "payment_id", label: "paymentId" },
    { key: "amount", label: "amount", optional: true },
    { key: "reason", label: "reason", optional: true },
  ],
  webhooks: [
    { key: "url", label: "url", type: "url" },
    {
      key: "events",
      label: "events",
      default: "payment.succeeded,payment.failed,invoice.paid,subscription.canceled",
    },
  ],
};
const scopes = [
  "checkout:create",
  "payments:read",
  "refunds:create",
  "subscriptions:manage",
  "products:manage",
  "webhooks:manage",
  "credentials:manage",
] as const;

export function ResourceForm({
  mode,
  applicationId,
  resource,
  onCreated,
}: {
  mode: PaymentMode;
  applicationId: string;
  resource: CreateResource;
  onCreated: (created: GatewayResource) => void;
}) {
  const t = useT("developer");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [requestKey, setRequestKey] = useState(() => crypto.randomUUID());
  const handleChange = () => {
    if (error) {
      setRequestKey(crypto.randomUUID());
      setError("");
    }
  };
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const entered = new FormData(form);
    const payload: Record<string, unknown> = {};
    for (const field of fields[resource]) {
      const raw = String(entered.get(field.key) ?? "").trim();
      if (raw)
        payload[field.key] = field.type === "datetime-local" ? new Date(raw).toISOString() : raw;
    }
    if (resource === "credentials") payload["scopes"] = entered.getAll("scope");
    if (resource === "webhooks")
      payload["events"] = String(payload["events"])
        .split(",")
        .map((name) => name.trim())
        .filter(Boolean);
    if (["checkouts", "links", "prices"].includes(resource)) payload["currency"] = "LMA";
    if (resource === "prices") payload["interval"] = entered.get("interval");
    setBusy(true);
    setError("");
    try {
      onCreated(
        await paymentApi.createResource(mode, applicationId, resource, payload, requestKey),
      );
      form.reset();
      setRequestKey(crypto.randomUUID());
    } catch (failure) {
      setError(messageForError(failure));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={(event) => void submit(event)} onChange={handleChange} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        {fields[resource].map((field) => (
          <label key={field.key} className="space-y-1.5 text-sm">
            <span className="font-medium">{t(field.label)}</span>
            {field.type === "datetime-local" ? (
              <DateTimePicker
                name={field.key}
                defaultValue={field.default ?? ""}
                onValueChange={handleChange}
              />
            ) : (
              <Input
                name={field.key}
                type={field.type ?? "text"}
                required={!field.optional}
                defaultValue={field.default}
                maxLength={field.type === "url" ? 2048 : 240}
                dir={field.key.endsWith("_id") || field.type === "url" ? "ltr" : undefined}
                autoComplete="off"
              />
            )}
          </label>
        ))}
        {resource === "prices" && (
          <label className="space-y-1.5 text-sm">
            <span className="font-medium">{t("interval")}</span>
            <select name="interval" className="h-10 w-full rounded-md border bg-background px-3">
              <option value="one_time">{t("one_time")}</option>
              <option value="monthly">{t("monthly")}</option>
              <option value="yearly">{t("yearly")}</option>
            </select>
          </label>
        )}
      </div>
      {resource === "credentials" && (
        <ScopeToggleGroup
          name="scope"
          label={t("scopes")}
          scopes={scopes}
          onValueChange={handleChange}
        />
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button type="submit" disabled={busy} className="min-h-11">
        {busy ? t("loading") : t("create")}
      </Button>
    </form>
  );
}
