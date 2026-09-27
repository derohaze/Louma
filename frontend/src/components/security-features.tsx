import { useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import type { HugeiconsIcon } from "@hugeicons/react";
import {
  AlertCircleIcon,
  CheckmarkCircle02Icon,
  ComputerIcon,
  LockIcon,
  RefreshIcon,
  SnowIcon,
  SmartPhone01Icon,
} from "@hugeicons/core-free-icons";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LIMITS, isStrongPassword, newPasswordError, passwordRules } from "@/lib/validation";
import {
  readSecurity,
  regenerateBackupCodes,
  securityStateText,
  setFrozen,
  setSecurityFeature,
  setTransferPassword,
  type SecuritySnapshot,
} from "@/lib/demo-security";
import {
  readSessions,
  revokeOtherSessions,
  revokeSession,
  type WalletSession,
} from "@/lib/demo-sessions";
import {
  securityDevices,
  securityFeature,
  securityFreezeWallet,
  type SecurityFeatureId,
} from "@/lib/security-catalog";
import { dateText } from "@/lib/wallet-format";
import { CopyButton, Icon, PageHeader } from "./wallet-shell";
import {
  FactList,
  FeatureToggle,
  FormMessage,
  Panel,
  PreviewNote,
  StatusPill,
} from "./security-ui";

type IconData = Parameters<typeof HugeiconsIcon>[0]["icon"];

/**
 * One page per control on the Security Center. Each page owns the settings for exactly one feature
 * and reads its wording from the catalog, so a name change lands in the sidebar, the page title,
 * and the browser tab at once.
 */
function useSecurity() {
  const [snapshot, setSnapshot] = useState(readSecurity);
  const refresh = () => setSnapshot(readSecurity());
  const enable = (id: SecurityFeatureId, value: boolean) => {
    setSecurityFeature(id, value);
    refresh();
  };
  return { snapshot, refresh, enable };
}

/** Shared header panel: description, switch, and the current state of the control. */
function FeatureStatus({
  id,
  snapshot,
  onChange,
  children,
}: {
  id: SecurityFeatureId;
  snapshot: SecuritySnapshot;
  onChange: (enabled: boolean) => void;
  children?: ReactNode;
}) {
  const feature = securityFeature(id);
  const enabled = snapshot.enabled[id];
  return (
    <Panel
      title={feature.title}
      description={feature.description}
      action={
        <FeatureToggle enabled={enabled} label={`Enable ${feature.title}`} onChange={onChange} />
      }
    >
      <p className="text-sm text-muted-foreground">{securityStateText(id, snapshot)}</p>
      {children}
    </Panel>
  );
}

export function TwoFactorContent() {
  const feature = securityFeature("two-factor");
  const { snapshot, refresh, enable } = useSecurity();
  const enabled = snapshot.enabled["two-factor"];
  const [codes, setCodes] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  return (
    <>
      <PageHeader title={feature.title} subtitle={feature.description} />
      <div className="space-y-4">
        <FeatureStatus
          id="two-factor"
          snapshot={snapshot}
          onChange={(v) => enable("two-factor", v)}
        >
          {enabled ? (
            <div className="mt-4 flex flex-wrap items-center gap-2 rounded-xl bg-secondary p-3">
              <div className="min-w-0 flex-1">
                <p className="text-xs text-muted-foreground">Authenticator key</p>
                <code className="mt-1 block break-all text-sm font-semibold">
                  {snapshot.twoFactorSecret}
                </code>
              </div>
              <CopyButton text={snapshot.twoFactorSecret} />
            </div>
          ) : (
            <p className="mt-4 flex items-start gap-2 rounded-xl border border-warning bg-warning/10 p-4 text-sm">
              <Icon icon={AlertCircleIcon} size={18} className="mt-0.5 shrink-0" />
              Without a second factor, anyone with your wallet password can sign in.
            </p>
          )}
        </FeatureStatus>
        <Panel
          title="Backup codes"
          description="Single-use codes for when your authenticator app is unavailable."
          action={
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" size="sm" disabled={!enabled}>
                  <Icon icon={RefreshIcon} size={16} />
                  Generate new codes
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Generate new backup codes?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Your current codes stop working immediately. Store the new set somewhere safe.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => {
                      const next = regenerateBackupCodes();
                      setCodes(next);
                      setMessage("New backup codes generated.");
                      refresh();
                    }}
                  >
                    Generate codes
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          }
        >
          <FactList
            items={[
              ["Unused codes", `${snapshot.backupCodesRemaining} of 8`],
              ["Used for", "Sign-in and password reset"],
            ]}
          />
          {codes.length > 0 && (
            <div className="mt-4 grid gap-2 sm:grid-cols-4">
              {codes.map((code) => (
                <code
                  key={code}
                  className="rounded-lg border bg-secondary/60 px-3 py-2 text-center text-sm font-semibold tracking-wide"
                >
                  {code}
                </code>
              ))}
            </div>
          )}
          {message && (
            <div className="mt-4">
              <FormMessage tone="ok">{message}</FormMessage>
            </div>
          )}
        </Panel>
        <PreviewNote>
          Preview build: codes are generated in the browser and never stored or verified.
        </PreviewNote>
      </div>
    </>
  );
}

export function TransferPasswordContent() {
  const feature = securityFeature("transfer-password");
  const { snapshot, refresh, enable } = useSecurity();
  const enabled = snapshot.enabled["transfer-password"];
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  /** The same strength rules the sign-in credential applies, read from the shared validation module. */
  const rules = passwordRules(next);
  const strong = isStrongPassword(next);
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setMessage("");
    setError("");
    if (snapshot.transferPassword && current !== snapshot.transferPassword) {
      setError("The current transfer password is incorrect.");
      return;
    }
    const problem = newPasswordError(next, confirm);
    if (problem) {
      setError(problem);
      return;
    }
    setTransferPassword(next);
    refresh();
    setCurrent("");
    setNext("");
    setConfirm("");
    setMessage("Transfer password updated.");
  };
  return (
    <>
      <PageHeader title={feature.title} subtitle={feature.description} />
      <div className="space-y-4">
        <FeatureStatus
          id="transfer-password"
          snapshot={snapshot}
          onChange={(v) => enable("transfer-password", v)}
        />
        <Panel
          title={
            snapshot.transferPasswordChangedAt
              ? "Change transfer password"
              : "Set transfer password"
          }
          description="Separate from your wallet password, so a leaked sign-in cannot move funds."
        >
          <form onSubmit={submit} className="max-w-xl space-y-4">
            {enabled && (
              <label className="block text-sm font-semibold">
                Current transfer password
                <Input
                  className="mt-2"
                  type="password"
                  autoComplete="current-password"
                  maxLength={LIMITS.maxPasswordLength}
                  value={current}
                  onChange={(event) => setCurrent(event.target.value)}
                  placeholder="••••••••"
                />
              </label>
            )}
            <label className="block text-sm font-semibold">
              New transfer password
              <Input
                className="mt-2"
                type="password"
                autoComplete="new-password"
                maxLength={LIMITS.maxPasswordLength}
                value={next}
                onChange={(event) => setNext(event.target.value)}
                placeholder="At least 8 characters"
              />
            </label>
            <label className="block text-sm font-semibold">
              Repeat new transfer password
              <Input
                className="mt-2"
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(event) => setConfirm(event.target.value)}
                placeholder="••••••••"
              />
            </label>
            <ul className="space-y-1 text-xs text-muted-foreground">
              {rules.map((rule) => (
                <li key={rule.id}>
                  {rule.met ? "✓" : "•"} {rule.label}
                </li>
              ))}
            </ul>
            <Button type="submit" disabled={!enabled}>
              <Icon icon={LockIcon} size={16} />
              {snapshot.transferPasswordChangedAt ? "Update password" : "Set password"}
            </Button>
            {error && <FormMessage tone="error">{error}</FormMessage>}
            {message && <FormMessage tone="ok">{message}</FormMessage>}
          </form>
        </Panel>
        <Panel title="When it applies" description="Rules the wallet follows on every transfer.">
          <FactList
            items={[
              ["Every transfer", enabled ? "This password is required" : "Not required"],
              ["Wrong password", "The transfer is refused before any LMA leaves the wallet"],
            ]}
          />
        </Panel>
        <PreviewNote>
          Preview build: the transfer password is kept in this session's memory so the transfer form
          can check it, and it is never sent anywhere.
        </PreviewNote>
      </div>
    </>
  );
}

/** The emergency stop: one switch that holds every transfer until the owner unfreezes the wallet. */
export function FreezeWalletContent() {
  const page = securityFreezeWallet;
  const { snapshot, refresh } = useSecurity();
  const [message, setMessage] = useState("");
  const frozen = snapshot.frozen;
  const apply = (value: boolean) => {
    setFrozen(value);
    refresh();
    setMessage(
      value
        ? "Wallet frozen. Nothing leaves it until you unfreeze."
        : "Wallet unfrozen. Transfers work again.",
    );
  };
  return (
    <>
      <PageHeader title={page.title} subtitle={page.description} />
      <div className="space-y-4">
        <Panel
          title={frozen ? "The wallet is frozen" : "The wallet is active"}
          description={
            frozen
              ? "Every transfer is refused until you unfreeze it."
              : "Freezing takes effect on the next transfer, without a delay."
          }
          action={
            frozen ? (
              <Button onClick={() => apply(false)}>
                <Icon icon={CheckmarkCircle02Icon} size={17} />
                Unfreeze wallet
              </Button>
            ) : (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive">
                    <Icon icon={SnowIcon} size={17} />
                    Freeze wallet
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Freeze this wallet?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Every transfer and every new sign-in stops immediately. LMA that is already on
                      its way still arrives, and you can unfreeze from this page at any time.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={() => apply(true)}>Freeze wallet</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )
          }
        >
          <div
            className={`flex items-start gap-3 rounded-xl border p-4 text-sm ${frozen ? "border-warning bg-warning/10" : "bg-secondary/50"}`}
          >
            <Icon icon={frozen ? SnowIcon : CheckmarkCircle02Icon} size={19} className="mt-0.5" />
            <p>
              {frozen
                ? "The wallet is frozen. The transfer form refuses every amount, and the wallet is locked on other pages too."
                : "No freeze is active. Use it when a device is lost or you suspect someone else has your credentials."}
            </p>
          </div>
          {message && (
            <div className="mt-4">
              <FormMessage tone="ok">{message}</FormMessage>
            </div>
          )}
        </Panel>
        <Panel
          title="What freezing does"
          description="Freezing stops the wallet, not your access to it: Security stays open so you can undo it."
          bodyClassName="p-0"
        >
          {[
            ["Transfers out", "Refused before they are submitted"],
            ["Sign-in on a new device", "Blocked"],
            ["Sessions already open", "Locked out until you unfreeze"],
            ["LMA sent to you", "Still arrives and shows in Transactions"],
            ["Unfreezing", "Any time from this page, or from Security Center"],
          ].map(([label, value]) => (
            <div
              key={label}
              className="flex flex-wrap items-center gap-3 border-b px-5 py-3.5 last:border-0"
            >
              <span className="min-w-0 flex-1 text-sm font-semibold">{label}</span>
              <span className="text-sm text-muted-foreground">{value}</span>
            </div>
          ))}
        </Panel>
        <PreviewNote>
          Preview build: the freeze lives in this session's memory, so a page reload clears it.
        </PreviewNote>
      </div>
    </>
  );
}

/** Icons per device type, so a phone and a laptop are told apart at a glance. */
const sessionIcons: Record<WalletSession["kind"], IconData> = {
  browser: ComputerIcon,
  app: SmartPhone01Icon,
};

/** Every device signed in to the wallet, with a revoke action per row. */
export function DevicesContent() {
  const page = securityDevices;
  const { snapshot } = useSecurity();
  const [sessions, setSessions] = useState(readSessions);
  const [message, setMessage] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const otherSessions = sessions.filter((session) => !session.current).length;
  const revoke = (session: WalletSession) => {
    revokeSession(session.id);
    setSessions(readSessions());
    setMessage(`${session.device} signed out.`);
  };
  return (
    <>
      <PageHeader title={page.title} subtitle={page.description} />
      <div className="space-y-4">
        <Panel
          title="Signed-in devices"
          description="Revoking a device ends its session on the next request."
          bodyClassName="p-0"
          action={
            otherSessions > 0 ? (
              <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
                <AlertDialogTrigger asChild>
                  <Button variant="outline" size="sm">
                    Sign out other devices
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Sign out {otherSessions} other device(s)?</AlertDialogTitle>
                    <AlertDialogDescription>
                      They stay signed in until their next request, then need your credentials and a
                      second factor again. This device is not affected.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() => {
                        const removed = revokeOtherSessions();
                        setSessions(readSessions());
                        setMessage(`${removed} session(s) signed out.`);
                      }}
                    >
                      Sign them out
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            ) : undefined
          }
        >
          {sessions.length ? (
            sessions.map((session) => (
              <div
                key={session.id}
                className="flex flex-wrap items-center gap-3 border-b px-5 py-4 last:border-0"
              >
                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-secondary text-muted-foreground">
                  <Icon icon={sessionIcons[session.kind]} size={19} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{session.device}</p>
                  <p className="text-xs text-muted-foreground">
                    {session.location} · {session.ip} · last active {dateText(session.lastActiveAt)}
                  </p>
                </div>
                {session.current ? (
                  <StatusPill enabled on="This device" />
                ) : session.trusted ? (
                  <span className="shrink-0 rounded-full border bg-secondary px-2.5 py-1 text-[11px] font-semibold">
                    Trusted
                  </span>
                ) : null}
                <Button
                  variant="outline"
                  size="sm"
                  disabled={session.current}
                  onClick={() => revoke(session)}
                >
                  {session.current ? "Current session" : "Sign out"}
                </Button>
              </div>
            ))
          ) : (
            <p className="px-5 py-6 text-sm text-muted-foreground">
              Only this device is signed in to the wallet.
            </p>
          )}
        </Panel>
        {message && <FormMessage tone="ok">{message}</FormMessage>}
        <Panel
          title="Protection on every device"
          description="The protections that guard this wallet wherever it is signed in."
        >
          <FactList
            items={[
              ["Two-factor", securityStateText("two-factor", snapshot)],
              ["Transfer password", securityStateText("transfer-password", snapshot)],
            ]}
          />
          <div className="mt-4 flex flex-wrap gap-2">
            <Link to="/security/two-factor">
              <Button variant="outline" size="sm">
                Two-factor
              </Button>
            </Link>
            <Link to="/security/transfer-password">
              <Button variant="outline" size="sm">
                Transfer password
              </Button>
            </Link>
          </div>
        </Panel>
        <PreviewNote>
          Preview build: the device list is held in this session's memory, so revoking a device is
          undone by a page reload and never reaches a real session.
        </PreviewNote>
      </div>
    </>
  );
}
