import { Link } from "@tanstack/react-router";
import { CheckmarkCircle01Icon } from "@hugeicons/core-free-icons";
import { useProAccess } from "@/shared/hooks";
import { useT } from "@/shared/i18n";
import { Button } from "@/shared/ui/button";
import { Icon, PageHeader } from "@/shared/ui/page";
import { Panel } from "@/shared/ui/panels";

export function BillingBenefitsPage() {
  const t = useT("billing");
  const activePro = useProAccess();
  const benefits = (items: string[]) => (
    <ul className="space-y-3">
      {items.map((benefit) => (
        <li key={benefit} className="flex items-start gap-2.5 text-sm leading-5">
          <Icon icon={CheckmarkCircle01Icon} size={18} className="mt-0.5 shrink-0 text-primary" />
          <span>{benefit}</span>
        </li>
      ))}
    </ul>
  );

  return (
    <>
      <PageHeader title={t("benefitsPage.title")} subtitle={t("benefitsPage.description")} />
      <div className="max-w-5xl space-y-4">
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title={t("free.title")} description={t("free.description")}>
            {benefits([
              t("benefits.wallet"),
              t("benefits.transfers"),
              t("benefits.mining"),
              t("benefits.history"),
              t("benefits.freeRanges"),
            ])}
          </Panel>
          <Panel
            title={t("pro.title")}
            description={t("pro.description")}
            className={activePro ? "border-primary/40" : undefined}
          >
            <div className="mb-4 inline-flex rounded-full bg-primary/10 px-3 py-1 text-xs font-bold text-primary">
              {activePro ? t("pro.active") : t("pro.available")}
            </div>
            {benefits([
              t("benefits.freeIncluded"),
              t("benefits.proRanges"),
              t("benefits.customAddress"),
              t("benefits.addressHistory"),
            ])}
            {activePro && (
              <Button asChild variant="outline" className="mt-5 min-h-11 w-full sm:w-auto">
                <Link to="/custom-address">{t("pro.openAddress")}</Link>
              </Button>
            )}
          </Panel>
        </div>
        <p className="px-1 text-sm leading-6 text-muted-foreground">{t("benefits.historyNote")}</p>
      </div>
    </>
  );
}
