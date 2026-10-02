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
import { securityControls, securityFeatures } from "@/shared/lib/security";
import { dateText } from "@/shared/lib/wallet";
import { Icon, PageHeader } from "@/shared/ui/page";
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
  const { security, refreshSecurity } = useWallet();
  const navigate = useNavigate();
  const score = securityScore(security);
  const frozen = security?.wallet.status === "frozen";
  const events = (security?.events ?? []).slice(0, 6);
  /** One line of state for the controls, which hold no switch of their own. */
  const controlState: Record<string, string> = {
    "/security/freeze": frozen ? "Frozen" : "Active",
    "/security/devices": `${security?.activeSessions ?? 0} signed-in ${
      (security?.activeSessions ?? 0) === 1 ? "device" : "devices"
    }`,
  };

  return (
    <>
      <PageHeader
        title="Security Center"
        subtitle="Layered sign-in and transfer controls for your wallet."
      />
      {frozen && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-warning bg-warning/10 px-4 py-3 text-sm">
          <Icon icon={SnowIcon} size={18} className="shrink-0" />
          <p className="min-w-0 flex-1">
            The wallet is frozen, so every transfer is refused until you unfreeze it.
          </p>
          <Link to="/security/freeze">
            <Button variant="outline" size="sm">
              Unfreeze wallet
            </Button>
          </Link>
        </div>
      )}
      <div className="grid gap-4 xl:grid-cols-[1fr_1.3fr]">
        <section className="rounded-[22px] border bg-card p-5 shadow-sm">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Icon icon={ShieldEnergyIcon} size={18} className="text-muted-foreground" />
            Security score
          </div>
          <p className={`mt-4 font-display text-4xl font-bold ${scoreTone(score.score)}`}>
            {score.score}
            <span className="text-lg text-muted-foreground"> / {score.max}</span>
          </p>
          <Progress value={score.score} className="mt-4" />
          <p className="mt-3 text-sm text-muted-foreground">
            {score.enabledCount} of {score.total} protections are on.{" "}
            {score.score < score.max
              ? "Enable the remaining controls to close the gaps."
              : "Every available control is enabled."}
          </p>
        </section>
        <Panel
          title="Signed-in devices"
          description={`${security?.activeSessions ?? 0} active ${
            (security?.activeSessions ?? 0) === 1 ? "session" : "sessions"
          } on this wallet.`}
          action={
            <Link to="/security/devices">
              <Button variant="outline" size="sm">
                All devices
              </Button>
            </Link>
          }
        >
          <div className="flex items-center gap-3">
            <Icon icon={ComputerIcon} size={19} className="shrink-0 text-muted-foreground" />
            <p className="min-w-0 flex-1 text-sm text-muted-foreground">
              A device stays signed in until its session expires or you revoke it. Revoking ends the
              session on that device's next request.
            </p>
          </div>
        </Panel>
      </div>
      <section className="mt-4 overflow-hidden rounded-[22px] border bg-card shadow-sm">
        <div className="border-b px-5 py-4">
          <h2 className="font-display font-semibold">Protections</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Open a control to turn it on or off; the change is applied by the backend.
          </p>
        </div>
        {securityFeatures.map((feature) => {
          const enabled = score.enabled[feature.id];
          return (
            <div
              key={feature.id}
              className="flex flex-wrap items-center gap-3 border-b px-5 py-4 last:border-0"
            >
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-secondary text-muted-foreground">
                <Icon icon={feature.icon} size={19} />
              </span>
              <div className="min-w-0 flex-1">
                <Link
                  to={feature.href}
                  className="text-sm font-semibold transition-colors hover:text-primary-soft"
                >
                  {feature.title}
                </Link>
                <p className="mt-1 text-xs text-muted-foreground">
                  {securityStateText(feature.id, security)}
                </p>
              </div>
              <StatusPill enabled={enabled} />
              <Switch
                checked={enabled}
                onCheckedChange={() => void navigate({ to: feature.href })}
                aria-label={`Open ${feature.title} settings`}
              />
            </div>
          );
        })}
      </section>
      <section className="mt-4 overflow-hidden rounded-[22px] border bg-card shadow-sm">
        <div className="border-b px-5 py-4">
          <h2 className="font-display font-semibold">Wallet controls</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            The emergency freeze and the list of signed-in devices.
          </p>
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
                {control.title}
              </Link>
              <p className="mt-1 text-xs text-muted-foreground">{control.description}</p>
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
        title="Security alerts"
        description="What the wallet recorded on this account, most recent first."
        bodyClassName="p-0"
        action={
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              void refreshSecurity().catch((cause: unknown) =>
                toast.error("Security alerts could not be refreshed", {
                  description: messageForError(cause),
                }),
              )
            }
          >
            Refresh
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
                    {event.outcome === "failure" ? "The request was refused" : "Completed"}
                  </p>
                </div>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {dateText(event.createdAt)}
                </span>
              </div>
            );
          })
        ) : (
          <p className="px-5 py-6 text-sm text-muted-foreground">
            No security events have been recorded yet.
          </p>
        )}
      </Panel>
    </>
  );
}
