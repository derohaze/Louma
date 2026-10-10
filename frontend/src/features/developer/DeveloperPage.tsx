import { Link } from "@tanstack/react-router";
import { ArrowUpRight, Code2, KeyRound, MousePointer2 } from "lucide-react";
import { useT } from "@/shared/i18n";
import { DeveloperScopeGate, useDeveloperScope } from "./DeveloperScope";
import { ResourcePanel } from "./ResourcePanel";
import { ApplicationSettings } from "./ApplicationSettings";

export function DeveloperPage() {
  const t = useT("developer");
  const scope = useDeveloperScope();
  return (
    <DeveloperScopeGate scope={scope} title={t("title")} description={t("description")}>
      {(ready) => (
        <div className="space-y-6">
          <section className="overflow-hidden rounded-3xl border bg-card">
            <div className="flex flex-wrap items-center justify-between gap-4 border-b px-6 py-5">
              <div>
                <p className="text-xs text-muted-foreground">{t("setup.receivingAs")}</p>
                <h2 className="mt-1 font-display text-xl font-semibold">
                  {ready.application.name}
                </h2>
              </div>
              <span className="rounded-full border px-3 py-1 text-xs">
                {ready.mode === "test" ? t("setup.testMode") : t("setup.liveMode")}
              </span>
            </div>
            <div className="grid divide-y md:grid-cols-3 md:divide-x md:divide-y-0 rtl:md:divide-x-reverse">
              {(
                [
                  {
                    to: "/developer/keys",
                    icon: KeyRound,
                    title: "quickstart.key",
                    detail: "quickstart.keyHint",
                  },
                  {
                    to: "/developer/examples",
                    icon: Code2,
                    title: "quickstart.code",
                    detail: "quickstart.codeHint",
                  },
                  {
                    to: "/developer/test",
                    icon: MousePointer2,
                    title: "quickstart.preview",
                    detail: "quickstart.previewHint",
                  },
                ] as const
              ).map((step, index) => (
                <Link
                  key={step.to}
                  to={step.to}
                  className="group p-6 transition-colors hover:bg-primary/5 focus-visible:outline-2 focus-visible:outline-primary"
                >
                  <div className="mb-6 flex items-center justify-between">
                    <step.icon className="size-5 text-primary" />
                    <span className="font-mono text-xs text-muted-foreground">0{index + 1}</span>
                  </div>
                  <h3 className="flex items-center justify-between text-sm font-semibold">
                    {t(step.title)}
                    <ArrowUpRight className="size-4 text-muted-foreground rtl:-rotate-90" />
                  </h3>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">{t(step.detail)}</p>
                </Link>
              ))}
            </div>
          </section>
          <ResourcePanel
            key={`${ready.mode}:${ready.application.id}:payments`}
            mode={ready.mode}
            applicationId={ready.application.id}
            resource="payments"
            readOnly
          />
          <ResourcePanel
            key={`${ready.mode}:${ready.application.id}:checkouts`}
            mode={ready.mode}
            applicationId={ready.application.id}
            resource="checkouts"
            readOnly
          />
          <ApplicationSettings
            key={`${ready.mode}:${ready.application.id}`}
            mode={ready.mode}
            application={ready.application}
            walletAddress={ready.wallet?.address ?? ""}
            onSaved={() => scope.applications.refetch()}
          />
        </div>
      )}
    </DeveloperScopeGate>
  );
}
