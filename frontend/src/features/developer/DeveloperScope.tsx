import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { messageForError } from "@/shared/api";
import { paymentApi, type MerchantApplication, type PaymentMode } from "@/shared/api/payments";
import { useWallet } from "@/shared/hooks";
import { useDeveloperAccess } from "@/shared/hooks/use-developer-access";
import { useT } from "@/shared/i18n";
import { PageHeader } from "@/shared/ui/page";
import { Panel } from "@/shared/ui/panels";
import { PaymentSetup } from "./PaymentSetup";

/** The scopes a key can carry. The gateway refuses a scope it does not know. */
export const developerScopes = [
  "checkout:create",
  "payments:read",
  "refunds:create",
  "subscriptions:manage",
  "products:manage",
  "webhooks:manage",
  "credentials:manage",
] as const;

/**
 * The deployment-selected gateway and application every developer page works inside.
 */
export function useDeveloperScope() {
  const { wallet, userId } = useWallet();
  const access = useDeveloperAccess();
  const configuredModes = access.data?.environments;
  const preferredMode: PaymentMode = import.meta.env.PROD ? "live" : "test";
  const fallbackMode = configuredModes?.[preferredMode]
    ? preferredMode
    : preferredMode === "test"
      ? "live"
      : "test";
  const mode = access.data?.mode ?? fallbackMode;
  const [applicationId, setApplicationId] = useState("");
  const available = access.data?.available ?? configuredModes?.[mode] ?? false;
  const applications = useQuery({
    queryKey: ["account", "developer", mode, "applications"],
    queryFn: () => paymentApi.applications(mode),
    enabled: !!userId && access.data?.eligible === true && available,
  });
  const selected =
    applications.data?.data.find((application) => application.id === applicationId) ??
    applications.data?.data[0];
  return {
    wallet,
    access,
    available,
    applications,
    selected,
    mode,
    selectApplication: setApplicationId,
  };
}

export type DeveloperScopeValue = ReturnType<typeof useDeveloperScope>;

/** What a page gets once an environment, an application, and the grant are all settled. */
export type ReadyDeveloperScope = {
  mode: PaymentMode;
  application: MerchantApplication;
  wallet: DeveloperScopeValue["wallet"];
};

/**
 * The chrome every developer page shares: the header, application selector, and access gate. A page only
 * receives its scope when the grant exists, the environment is configured, and an application is
 * selected — the three pages that manage keys, show examples, and run a test payment all need
 * exactly that and nothing else.
 */
export function DeveloperScopeGate({
  scope,
  title,
  description,
  children,
}: {
  scope: DeveloperScopeValue;
  /** Already translated, so this gate needs to know no translation keys of its own. */
  title: string;
  description: string;
  children: (ready: ReadyDeveloperScope) => ReactNode;
}) {
  const t = useT("developer");
  if (scope.access.isPending) return <p role="status">{t("loading")}</p>;
  if (scope.access.error)
    return (
      <p role="alert" className="text-destructive">
        {messageForError(scope.access.error)}
      </p>
    );
  if (!scope.access.data?.eligible)
    return (
      <Panel title={title}>
        <p>{t("denied")}</p>
      </Panel>
    );
  const { applications } = scope;
  return (
    <div className="space-y-5">
      <PageHeader title={title} subtitle={description} />
      {scope.selected && (applications.data?.data.length ?? 0) > 1 && (
        <label className="block max-w-sm space-y-1.5 text-sm">
          <span className="block font-medium">{t("application")}</span>
          <select
            value={scope.selected.id}
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
      {!scope.available ? (
        <p role="status">{t("unavailable")}</p>
      ) : applications.isPending ? (
        <p role="status">{t("loading")}</p>
      ) : applications.error ? (
        <p role="alert" className="text-sm text-destructive">
          {messageForError(applications.error)}
        </p>
      ) : !scope.selected ? (
        <PaymentSetup scope={scope} />
      ) : (
        children({ mode: scope.mode, application: scope.selected, wallet: scope.wallet })
      )}
    </div>
  );
}
