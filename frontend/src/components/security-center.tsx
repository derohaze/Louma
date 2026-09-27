import { useState } from "react";
import { Link } from "@tanstack/react-router";
import type { HugeiconsIcon } from "@hugeicons/react";
import {
  AlertCircleIcon,
  CheckmarkCircle02Icon,
  ComputerIcon,
  InformationCircleIcon,
  ShieldEnergyIcon,
  SmartPhone01Icon,
  SnowIcon,
} from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import {
  readSecurity,
  securityScore,
  securityStateText,
  setFrozen,
  setSecurityFeature,
  type SecurityAlert,
} from "@/lib/demo-security";
import { readSessions, type WalletSession } from "@/lib/demo-sessions";
import { securityControls, securityFeatures, type SecurityFeatureId } from "@/lib/security-catalog";
import { dateText } from "@/lib/wallet-format";
import { Icon, PageHeader } from "./wallet-shell";
import { Panel, PreviewNote, StatusPill } from "./security-ui";

type IconData = Parameters<typeof HugeiconsIcon>[0]["icon"];

const alertStyles: Record<SecurityAlert["level"], { icon: IconData; className: string }> = {
  success: { icon: CheckmarkCircle02Icon, className: "text-success" },
  warning: { icon: AlertCircleIcon, className: "text-warning" },
  info: { icon: InformationCircleIcon, className: "text-muted-foreground" },
};

const sessionIcons: Record<WalletSession["kind"], IconData> = {
  browser: ComputerIcon,
  app: SmartPhone01Icon,
};

/** Colour for the score: green once most protections are on, amber while they are partial. */
const scoreTone = (score: number) => {
  if (score >= 80) return "text-[#1F7A5A]";
  if (score >= 50) return "text-[#9A6B12]";
  return "text-destructive";
};

export function SecurityCenterContent() {
  const [snapshot, setSnapshot] = useState(readSecurity);
  const score = securityScore(snapshot);
  const sessions = readSessions();
  const toggle = (id: SecurityFeatureId, enabled: boolean) => {
    setSecurityFeature(id, enabled);
    setSnapshot(readSecurity());
  };
  /** One line of state for the controls, which hold no switch of their own. */
  const controlState: Record<string, { label: string; enabled?: boolean }> = {
    "/security/freeze": {
      label: snapshot.frozen ? "Frozen" : "Active",
      enabled: !snapshot.frozen,
    },
    "/security/devices": {
      label: `${sessions.length} device${sessions.length === 1 ? "" : "s"} signed in`,
    },
  };

  return (
    <>
      <PageHeader
        title="Security Center"
        subtitle="Layered sign-in and transfer controls for your wallet."
      />
      {snapshot.frozen && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-warning bg-warning/10 px-4 py-3 text-sm">
          <Icon icon={SnowIcon} size={18} className="shrink-0" />
          <p className="min-w-0 flex-1">
            The wallet is frozen, so every transfer is refused until you unfreeze it.
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setFrozen(false);
              setSnapshot(readSecurity());
            }}
          >
            Unfreeze wallet
          </Button>
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
          title="Sign-in activity"
          description="The last three sessions on this wallet."
          bodyClassName="p-0"
          action={
            <Link to="/security/devices">
              <Button variant="outline" size="sm">
                All devices
              </Button>
            </Link>
          }
        >
          {sessions.slice(0, 3).map((session) => (
            <div
              key={session.id}
              className="flex items-center gap-3 border-b px-5 py-3.5 last:border-0"
            >
              <Icon
                icon={sessionIcons[session.kind]}
                size={19}
                className="shrink-0 text-muted-foreground"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{session.device}</p>
                <p className="text-xs text-muted-foreground">
                  {session.location} · {session.ip}
                </p>
              </div>
              {session.current ? (
                <StatusPill enabled on="This device" />
              ) : (
                <span className="shrink-0 text-xs text-muted-foreground">
                  {dateText(session.lastActiveAt)}
                </span>
              )}
            </div>
          ))}
        </Panel>
      </div>
      <section className="mt-4 overflow-hidden rounded-[22px] border bg-card shadow-sm">
        <div className="border-b px-5 py-4">
          <h2 className="font-display font-semibold">Protections</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Switch a control on here, or open it for its settings.
          </p>
        </div>
        {securityFeatures.map((feature) => {
          const enabled = snapshot.enabled[feature.id];
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
                  className="text-sm font-semibold transition-colors hover:text-primary"
                >
                  {feature.title}
                </Link>
                <p className="mt-1 text-xs text-muted-foreground">
                  {securityStateText(feature.id, snapshot)}
                </p>
              </div>
              <StatusPill enabled={enabled} />
              <Switch
                checked={enabled}
                onCheckedChange={(value) => toggle(feature.id, value)}
                aria-label={`Enable ${feature.title}`}
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
        {securityControls.map((control) => {
          const state = controlState[control.href] ?? { label: "" };
          return (
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
                  className="text-sm font-semibold transition-colors hover:text-primary"
                >
                  {control.title}
                </Link>
                <p className="mt-1 text-xs text-muted-foreground">{control.description}</p>
              </div>
              {state.enabled === undefined ? (
                <span className="shrink-0 text-xs text-muted-foreground">{state.label}</span>
              ) : (
                <StatusPill enabled={state.enabled} on={state.label} off="Frozen" />
              )}
            </div>
          );
        })}
      </section>
      <Panel
        title="Security alerts"
        description="What the wallet noticed on this account."
        bodyClassName="p-0"
      >
        {snapshot.alerts.map((alert) => {
          const style = alertStyles[alert.level];
          return (
            <div
              key={alert.id}
              className="flex items-start gap-3 border-b px-5 py-3.5 last:border-0"
            >
              <Icon icon={style.icon} size={19} className={`shrink-0 ${style.className}`} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">{alert.title}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{alert.detail}</p>
              </div>
              <span className="shrink-0 text-xs text-muted-foreground">{dateText(alert.at)}</span>
            </div>
          );
        })}
      </Panel>
      <div className="mt-4">
        <PreviewNote>
          Preview build: these controls change demo data for this session only — the security API is
          not connected yet.
        </PreviewNote>
      </div>
    </>
  );
}
