import { Link, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import type { HugeiconsIcon } from "@hugeicons/react";
import {
  AlertCircleIcon,
  CheckmarkCircle02Icon,
  InformationCircleIcon,
  ShieldEnergyIcon,
  SnowIcon,
  ComputerIcon,
} from "@hugeicons/core-free-icons";
import { Button } from "@/shared/ui/button";
import { Progress } from "@/shared/ui/progress";
import { messageForError } from "@/shared/api";
import { Switch } from "@/shared/ui/switch";
import { useWallet } from "@/shared/hooks";
import {
  securityEventLevel,
  securityEventTitle,
  securityScore,
  securityStateText,
} from "@/shared/lib/security";
import { securityCenter, securityControls, securityFeatures } from "@/shared/lib/security";
import { dateText } from "@/shared/lib/wallet";
import { useT, useTranslate } from "@/shared/i18n";
import { Icon, PageHeader, revealDelay } from "@/shared/ui/page";
import { Panel, StatusPill } from "@/shared/ui/panels";

type IconData = Parameters<typeof HugeiconsIcon>[0]["icon"];

const alertStyles: Record<"success" | "warning" | "info", { icon: IconData; className: string }> = {
  success: { icon: CheckmarkCircle02Icon, className: "text-success" },
  warning: { icon: AlertCircleIcon, className: "text-warning" },
  info: { icon: InformationCircleIcon, className: "text-muted-foreground" },
};

/** Colour for the score: green once most protections are on, amber while they are partial. */
const scoreTone = (score: number) => {
  if (score >= 80) return "text-[#1F7A5A]";
  if (score >= 50) return "text-[#9A6B12]";
  return "text-destructive";
};

/**
 * Landing page of the Security section: the score, the switch list, and the recorded security
 * events. Every value comes from `/api/v1/security`, and every switch opens the page that owns the
 * change, because enabling 2FA or setting a transfer password needs more than a toggle.
 */
export function SecurityCenterContent() {
  const t = useT("security.center");
  const common = useT("common");
  const state = useT("security.state");
  const translate = useTranslate();
  const page = securityCenter;
  const { security, refreshSecurity } = useWallet();
  const navigate = useNavigate();
  const score = securityScore(security);
  const frozen = security?.wallet.status === "frozen";
  const sessions = security?.activeSessions ?? 0;
  const events = (security?.events ?? []).slice(0, 6);
  /** One line of state for the controls, which hold no switch of their own. */
  const controlState: Record<string, string> = {
    "/security/freeze": state(frozen ? "wallet.frozen" : "wallet.active"),
    "/security/devices": state(sessions === 1 ? "devices.one" : "devices.other", {
      count: sessions,
    }),
  };

  return (
    <>
      <PageHeader title={translate(page.titleKey)} subtitle={translate(page.descriptionKey)} />
      {frozen && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-warning bg-warning/10 px-4 py-3 text-sm">
          <Icon icon={SnowIcon} size={18} className="shrink-0" />
          <p className="min-w-0 flex-1">{t("frozen.banner")}</p>
          <Link to="/security/freeze">
            <Button variant="outline" size="sm">
              {t("frozen.unfreeze")}
            </Button>
          </Link>
        </div>
      )}
      <div className="grid gap-4 xl:grid-cols-[1fr_1.3fr]">
        <section
          style={revealDelay(0)}
          className="card-enter rounded-[22px] border bg-card p-5 shadow-sm"
        >
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Icon icon={ShieldEnergyIcon} size={18} className="text-muted-foreground" />
            {t("score.title")}
          </div>
          <p className={`mt-4 font-display text-4xl font-bold ${scoreTone(score.score)}`}>
            {score.score}
            <span className="text-lg text-muted-foreground"> / {score.max}</span>
          </p>
          <Progress value={score.score} className="mt-4" />
          <p className="mt-3 text-sm text-muted-foreground">
            {t("score.summary", {
              enabled: score.enabledCount,
              total: score.total,
              hint: t(score.score < score.max ? "score.hintPartial" : "score.hintFull"),
            })}
          </p>
        </section>
        <Panel
          delayMs={75}
          title={t("devices.title")}
          description={state(sessions === 1 ? "sessions.one" : "sessions.other", {
            count: sessions,
          })}
          action={
            <Link to="/security/devices">
              <Button variant="outline" size="sm">
                {t("devices.all")}
              </Button>
            </Link>
          }
        >
          <div className="flex items-center gap-3">
            <Icon icon={ComputerIcon} size={19} className="shrink-0 text-muted-foreground" />
            <p className="min-w-0 flex-1 text-sm text-muted-foreground">{t("devices.body")}</p>
          </div>
        </Panel>
      </div>
      <section
        style={revealDelay(2)}
        className="card-enter mt-4 overflow-hidden rounded-[22px] border bg-card shadow-sm"
      >
        <div className="border-b px-5 py-4">
          <h2 className="font-display font-semibold">{t("protections.title")}</h2>
          <p className="mt-1 text-xs text-muted-foreground">{t("protections.description")}</p>
        </div>
        {securityFeatures.map((feature, row) => {
          const enabled = score.enabled[feature.id];
          return (
            <div
              key={feature.id}
              style={revealDelay(row, 45, 270)}
              className="list-enter flex flex-wrap items-center gap-3 border-b px-5 py-4 last:border-0"
            >
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-secondary text-muted-foreground">
                <Icon icon={feature.icon} size={19} />
              </span>
              <div className="min-w-0 flex-1">
                <Link
                  to={feature.href}
                  className="text-sm font-semibold transition-colors hover:text-primary-soft"
                >
                  {translate(feature.titleKey)}
                </Link>
                <p className="mt-1 text-xs text-muted-foreground">
                  {securityStateText(feature.id, security)}
                </p>
              </div>
              <StatusPill enabled={enabled} />
              <Switch
                checked={enabled}
                onCheckedChange={() => void navigate({ to: feature.href })}
                aria-label={t("protections.toggle", { title: translate(feature.titleKey) })}
              />
            </div>
          );
        })}
      </section>
      <section
        style={revealDelay(3)}
        className="card-enter mt-4 overflow-hidden rounded-[22px] border bg-card shadow-sm"
      >
        <div className="border-b px-5 py-4">
          <h2 className="font-display font-semibold">{t("controls.title")}</h2>
          <p className="mt-1 text-xs text-muted-foreground">{t("controls.description")}</p>
        </div>
        {securityControls.map((control) => (
          <div
            key={control.href}
            className="flex flex-wrap items-center gap-3 border-b px-5 py-4 last:border-0"
          >
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-secondary text-muted-foreground">
              <Icon icon={control.icon} size={19} />
            </span>
            <div className="min-w-0 flex-1">
              <Link
                to={control.href}
                className="text-sm font-semibold transition-colors hover:text-primary-soft"
              >
                {translate(control.titleKey)}
              </Link>
              <p className="mt-1 text-xs text-muted-foreground">
                {translate(control.descriptionKey)}
              </p>
            </div>
            <span className="shrink-0 text-xs text-muted-foreground">
              {controlState[control.href] ?? ""}
            </span>
          </div>
        ))}
      </section>
      {/* The alerts below are a copy of the API's answer with a freshness window on it, so a refresh
          that fails leaves the previous copy on screen and the failure has to be said out loud. */}
      <Panel
        delayMs={300}
        className="mt-4"
        title={t("alerts.title")}
        description={t("alerts.description")}
        bodyClassName="p-0"
        action={
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              void refreshSecurity().catch((cause: unknown) =>
                toast.error(t("alerts.refreshFailed"), {
                  description: messageForError(cause),
                }),
              )
            }
          >
            {common("actions.refresh")}
          </Button>
        }
      >
        {events.length ? (
          events.map((event) => {
            const level = securityEventLevel(event.outcome);
            const style = alertStyles[level];
            return (
              <div
                key={event.id}
                className="flex items-start gap-3 border-b px-5 py-3.5 last:border-0"
              >
                <Icon icon={style.icon} size={19} className={`shrink-0 ${style.className}`} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">{securityEventTitle(event.type)}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {common(event.outcome === "failure" ? "state.refused" : "state.completed")}
                  </p>
                </div>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {dateText(event.createdAt)}
                </span>
              </div>
            );
          })
        ) : (
          <p className="px-5 py-6 text-sm text-muted-foreground">{t("alerts.empty")}</p>
        )}
      </Panel>
    </>
  );
}
