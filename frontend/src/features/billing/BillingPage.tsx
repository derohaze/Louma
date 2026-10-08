import { Link } from "@tanstack/react-router";
import { CreditCardIcon } from "@hugeicons/core-free-icons";
import { useProAccess, useWallet } from "@/shared/hooks";
import { useT, currentLocale } from "@/shared/i18n";
import { Icon, PageHeader } from "@/shared/ui/page";
import { Button } from "@/shared/ui/button";
import { FactList, Panel } from "@/shared/ui/panels";

export function BillingPage() {
  const t = useT("billing");
  const common = useT("common");
  const { user, loading } = useWallet();
  const activePro = useProAccess();
  const subscription = user?.subscription;
  const planCode = subscription?.plan ?? null;
  const hasPlanHistory = planCode !== null;
  const expired =
    !activePro &&
    hasPlanHistory &&
    !!subscription?.expiresAt &&
    Date.parse(subscription.expiresAt) <= Date.now();
  const status = activePro ? t("status.active") : expired ? t("status.expired") : t("status.free");
  const plan =
    planCode === "monthly"
      ? t("plans.monthly")
      : planCode === "yearly"
        ? t("plans.yearly")
        : planCode === "lifetime"
          ? t("plans.lifetime")
          : t("plans.free");
  const date = (value: string) =>
    new Intl.DateTimeFormat(currentLocale(), { dateStyle: "long" }).format(new Date(value));
  return (
    <>
      <PageHeader title={t("title")} subtitle={t("description")} />
      <div className="max-w-4xl space-y-5">
        <Panel title={t("current.title")} description={t("current.description")}>
          {loading ? (
            <p className="text-sm text-muted-foreground" role="status">
              {common("actions.loading")}
            </p>
          ) : (
            <>
              <div className="mb-5 flex flex-wrap items-center gap-3">
                <Icon icon={CreditCardIcon} size={22} className="shrink-0 text-primary" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{plan}</span>
                  <span className="text-sm text-muted-foreground">{status}</span>
                </span>
                <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
                  {activePro ? common("state.pro") : common("state.free")}
                </span>
              </div>
              <FactList
                items={[
                  [t("details.status"), status],
                  [t("details.plan"), plan],
                  [
                    t("details.started"),
                    subscription?.startsAt ? date(subscription.startsAt) : t("details.noDate"),
                  ],
                  [
                    t("details.expires"),
                    subscription?.expiresAt
                      ? date(subscription.expiresAt)
                      : hasPlanHistory
                        ? t("details.never")
                        : t("details.noDate"),
                  ],
                ]}
              />
            </>
          )}
        </Panel>

        <Panel title={t("comparison.title")} description={t("comparison.description")}>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="max-w-xl text-sm leading-6 text-muted-foreground">
              {t("comparison.summary")}
            </p>
            <Button asChild className="min-h-11 w-full sm:w-auto">
              <Link to="/billing/benefits">{t("comparison.action")}</Link>
            </Button>
          </div>
        </Panel>
      </div>
    </>
  );
}
