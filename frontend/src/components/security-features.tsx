import { useEffect, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import type { HugeiconsIcon } from "@hugeicons/react";
import {
  AlertCircleIcon,
  CheckmarkCircle02Icon,
  ComputerIcon,
  Delete02Icon,
  FingerPrintIcon,
  Globe02Icon,
  LockIcon,
  PlusSignIcon,
  RefreshIcon,
  SecurityPasswordIcon,
  Shield01Icon,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  addApprovedIp,
  addGeoLockCountry,
  countryName,
  currentSession,
  geoCountries,
  isWithinAccessWindow,
  readSecurity,
  regenerateBackupCodes,
  removeApprovedIp,
  removeGeoLockCountry,
  securityStateText,
  sentToday,
  setAutoSignInDays,
  setDailyLimit,
  setFrozen,
  setSecurityFeature,
  setTimeAccess,
  setTransferAuthMethod,
  setTransferPassword,
  twoFactorCode,
  twoFactorCodeSecondsLeft,
  type SecuritySnapshot,
  type TransferAuthMethod,
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
  securityTransferApproval,
  securityWalletPassword,
  type SecurityFeatureId,
} from "@/lib/security-catalog";
import { useWallet } from "@/hooks/use-wallet";
import { currency, dateText } from "@/lib/wallet-format";
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
              ["Used for", "Sign-in, transfer approval, and password reset"],
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
  const strong = next.length >= 8 && /[0-9]/.test(next) && /[A-Za-z]/.test(next);
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setMessage("");
    setError("");
    if (snapshot.transferPassword && current !== snapshot.transferPassword) {
      setError("The current transfer password is incorrect.");
      return;
    }
    if (!strong) {
      setError("Use at least 8 characters with both letters and numbers.");
      return;
    }
    if (next !== confirm) {
      setError("The two passwords do not match.");
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
              <li>{strong ? "✓" : "•"} At least 8 characters</li>
              <li>{/[0-9]/.test(next) ? "✓" : "•"} Contains a number</li>
              <li>{/[A-Za-z]/.test(next) ? "✓" : "•"} Contains a letter</li>
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

export function DailyLimitContent() {
  const feature = securityFeature("daily-limit");
  const { transactions } = useWallet();
  const { snapshot, refresh, enable } = useSecurity();
  const enabled = snapshot.enabled["daily-limit"];
  const [amount, setAmount] = useState(String(snapshot.dailyLimit));
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const spentToday = sentToday(transactions);
  const usedPercent =
    snapshot.dailyLimit > 0 ? Math.min((spentToday / snapshot.dailyLimit) * 100, 100) : 0;
  const save = (event: React.FormEvent) => {
    event.preventDefault();
    setMessage("");
    setError("");
    const value = Number(amount);
    if (!Number.isFinite(value) || value < 50) {
      setError("Enter a limit of at least 50 LMA.");
      return;
    }
    setDailyLimit(value);
    refresh();
    setMessage(`Daily limit set to ${currency(value)}.`);
  };
  return (
    <>
      <PageHeader title={feature.title} subtitle={feature.description} />
      <div className="space-y-4">
        <FeatureStatus
          id="daily-limit"
          snapshot={snapshot}
          onChange={(v) => enable("daily-limit", v)}
        />
        <Panel
          title="Daily transfer limit"
          description="Applies to transfers sent from this wallet."
        >
          <form onSubmit={save} className="max-w-xl space-y-4">
            <label className="block text-sm font-semibold">
              Limit per day (LMA)
              <Input
                className="mt-2"
                type="number"
                min="50"
                step="50"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
              />
            </label>
            <div className="flex flex-wrap gap-2">
              {[100, 500, 1000, 5000].map((preset) => (
                <Button
                  key={preset}
                  type="button"
                  size="sm"
                  variant={Number(amount) === preset ? "default" : "outline"}
                  onClick={() => setAmount(String(preset))}
                >
                  {currency(preset)}
                </Button>
              ))}
            </div>
            <Button type="submit" disabled={!enabled}>
              Save limit
            </Button>
            {error && <FormMessage tone="error">{error}</FormMessage>}
            {message && <FormMessage tone="ok">{message}</FormMessage>}
          </form>
          <div className="mt-5 rounded-xl bg-secondary/60 p-4">
            <div className="flex items-center justify-between text-sm font-semibold">
              <span>Sent today</span>
              <span>
                {currency(spentToday)} of {currency(snapshot.dailyLimit)}
              </span>
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-card">
              <div
                className="h-full rounded-full bg-primary transition-all"
                style={{ width: `${usedPercent}%` }}
              />
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              {snapshot.dailyLimit - spentToday > 0
                ? `${currency(snapshot.dailyLimit - spentToday)} left for today.`
                : "Today's allowance is used up."}
            </p>
          </div>
        </Panel>
        <PreviewNote>
          Preview build: the limit is compared against the demo transfers created on this device.
        </PreviewNote>
      </div>
    </>
  );
}

export function AutoSignInContent() {
  const feature = securityFeature("auto-sign-in");
  const { snapshot, refresh, enable } = useSecurity();
  const enabled = snapshot.enabled["auto-sign-in"];
  const [message, setMessage] = useState("");
  return (
    <>
      <PageHeader title={feature.title} subtitle={feature.description} />
      <div className="space-y-4">
        <FeatureStatus
          id="auto-sign-in"
          snapshot={snapshot}
          onChange={(v) => enable("auto-sign-in", v)}
        />
        <Panel
          title="Session length"
          description="How long a device stays signed in before asking again."
        >
          <div className="flex flex-wrap gap-2">
            {[7, 14, 20].map((days) => (
              <Button
                key={days}
                variant={snapshot.autoSignInDays === days ? "default" : "outline"}
                disabled={!enabled}
                aria-pressed={snapshot.autoSignInDays === days}
                onClick={() => {
                  setAutoSignInDays(days);
                  refresh();
                  setMessage(`Devices stay signed in for ${days} days.`);
                }}
              >
                {days} days
              </Button>
            ))}
          </div>
          <p className="mt-3 text-sm text-muted-foreground">
            Shorter sessions are safer on shared computers. Signing out ends auto sign-in on every
            device.
          </p>
          {message && (
            <div className="mt-4">
              <FormMessage tone="ok">{message}</FormMessage>
            </div>
          )}
        </Panel>
        <Panel
          title="Signed-in devices"
          description="Devices that currently keep a session."
          bodyClassName="p-0"
          action={
            <Link to="/security/devices">
              <Button variant="outline" size="sm">
                Manage devices
              </Button>
            </Link>
          }
        >
          {readSessions().map((session) => (
            <div
              key={session.id}
              className="flex items-center gap-3 border-b px-5 py-3.5 last:border-0"
            >
              <Icon
                icon={session.kind === "app" ? SmartPhone01Icon : ComputerIcon}
                size={19}
                className="shrink-0 text-muted-foreground"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{session.device}</p>
                <p className="text-xs text-muted-foreground">
                  {session.location} · {dateText(session.lastActiveAt)}
                </p>
              </div>
              {session.current && (
                <span className="shrink-0 rounded-full border bg-secondary px-2.5 py-1 text-[11px] font-semibold">
                  This device
                </span>
              )}
              {session.trusted && !session.current && (
                <span className="shrink-0 rounded-full border bg-secondary px-2.5 py-1 text-[11px] font-semibold">
                  Trusted
                </span>
              )}
            </div>
          ))}
        </Panel>
      </div>
    </>
  );
}

export function TimeAccessContent() {
  const feature = securityFeature("time-access");
  const { snapshot, refresh, enable } = useSecurity();
  const enabled = snapshot.enabled["time-access"];
  const [start, setStart] = useState(snapshot.timeAccess.start);
  const [end, setEnd] = useState(snapshot.timeAccess.end);
  const [message, setMessage] = useState("");
  /**
   * `now` is filled after mount: the server has its own clock, so rendering it during the first
   * pass would hydrate a different time than the browser shows.
   */
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  const open = now ? isWithinAccessWindow(snapshot, now) : null;
  return (
    <>
      <PageHeader title={feature.title} subtitle={feature.description} />
      <div className="space-y-4">
        <FeatureStatus
          id="time-access"
          snapshot={snapshot}
          onChange={(v) => enable("time-access", v)}
        />
        <Panel title="Access window" description="The wallet opens only between these hours.">
          <div className="grid max-w-xl gap-4 sm:grid-cols-2">
            <label className="block text-sm font-semibold">
              Opens at
              <Input
                className="mt-2"
                type="time"
                value={start}
                onChange={(event) => setStart(event.target.value)}
              />
            </label>
            <label className="block text-sm font-semibold">
              Closes at
              <Input
                className="mt-2"
                type="time"
                value={end}
                onChange={(event) => setEnd(event.target.value)}
              />
            </label>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button
              disabled={!enabled}
              onClick={() => {
                setTimeAccess(start, end);
                refresh();
                setMessage(`Access allowed between ${start} and ${end}.`);
              }}
            >
              Save window
            </Button>
            <span className="text-sm text-muted-foreground">
              {!enabled
                ? "The window applies once the control is on."
                : open === null
                  ? "Checking the current time…"
                  : open
                    ? "The wallet is open right now."
                    : "The wallet is closed right now."}
            </span>
          </div>
          {message && (
            <div className="mt-4">
              <FormMessage tone="ok">{message}</FormMessage>
            </div>
          )}
        </Panel>
        <Panel
          title="Outside the window"
          description="What happens between the closing and opening time."
        >
          <FactList
            items={[
              ["Sign-in", "Blocked until the next opening time"],
              ["Transfers", "Already scheduled transfers still complete"],
            ]}
          />
        </Panel>
      </div>
    </>
  );
}

export function GeoLockContent() {
  const feature = securityFeature("geo-lock");
  const { snapshot, refresh, enable } = useSecurity();
  const enabled = snapshot.enabled["geo-lock"];
  const [draft, setDraft] = useState("");
  const [message, setMessage] = useState("");
  const countries = snapshot.geoLockCountries;
  const remaining = geoCountries.filter((country) => !countries.includes(country.code));
  // Either side of the rule can lock the owner out, so both cases are called out on the page.
  const missingCurrent = enabled && !countries.includes(currentSession.country);
  const listEmpty = enabled && countries.length === 0;
  const add = (code: string) => {
    addGeoLockCountry(code);
    refresh();
    setMessage(`${countryName(code)} added.`);
  };
  return (
    <>
      <PageHeader title={feature.title} subtitle={feature.description} />
      <div className="space-y-4">
        <FeatureStatus id="geo-lock" snapshot={snapshot} onChange={(v) => enable("geo-lock", v)} />
        <Panel
          title="Allowed countries"
          description="Sign-ins from anywhere else are rejected."
          bodyClassName="p-0"
          action={
            <Button
              variant="outline"
              size="sm"
              disabled={countries.includes(currentSession.country)}
              onClick={() => add(currentSession.country)}
            >
              <Icon icon={Globe02Icon} size={16} />
              Detect my country
            </Button>
          }
        >
          {countries.length === 0 ? (
            <p className="px-5 py-6 text-sm text-muted-foreground">
              No country allowed yet, so every sign-in would be rejected. Detect this device's
              country or add one below before switching the lock on.
            </p>
          ) : (
            countries.map((code) => (
              <div
                key={code}
                className="flex items-center gap-3 border-b px-5 py-3.5 last:border-0"
              >
                <Icon icon={Globe02Icon} size={19} className="shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{countryName(code)}</p>
                  <p className="text-xs text-muted-foreground">{code}</p>
                </div>
                {code === currentSession.country && <StatusPill enabled on="This session" />}
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove ${countryName(code)}`}
                  onClick={() => {
                    removeGeoLockCountry(code);
                    refresh();
                    setMessage(`${countryName(code)} removed.`);
                  }}
                >
                  <Icon icon={Delete02Icon} size={18} />
                </Button>
              </div>
            ))
          )}
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (draft) add(draft);
              setDraft("");
            }}
            className="flex flex-wrap items-end gap-3 border-t px-5 py-4"
          >
            <label className="min-w-56 flex-1 text-sm font-semibold">
              Add a country
              <Select value={draft} onValueChange={setDraft}>
                <SelectTrigger className="mt-2" aria-label="Add a country">
                  <SelectValue placeholder="Pick a country" />
                </SelectTrigger>
                <SelectContent>
                  {remaining.map((country) => (
                    <SelectItem key={country.code} value={country.code}>
                      {country.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <Button type="submit" variant="outline" disabled={!draft}>
              <Icon icon={PlusSignIcon} size={16} />
              Add country
            </Button>
          </form>
        </Panel>
        {(listEmpty || missingCurrent) && (
          <p className="flex items-start gap-2 rounded-xl border border-warning bg-warning/10 p-4 text-sm">
            <Icon icon={AlertCircleIcon} size={18} className="mt-0.5 shrink-0" />
            {listEmpty
              ? "The allowed list is empty, so nobody could sign in. Add the countries you work from."
              : `This session (${currentSession.city}, ${currentSession.countryName}) is outside the allowed list, so the next request would be signed out.`}
          </p>
        )}
        {message && <FormMessage tone="ok">{message}</FormMessage>}
        <Panel title="This session" description="Where the current sign-in comes from.">
          <FactList
            items={[
              ["IP address", currentSession.ip],
              ["Location", `${currentSession.city}, ${currentSession.countryName}`],
              ["Device", currentSession.device],
              ["Signed in", currentSession.signedInAt ? dateText(currentSession.signedInAt) : "—"],
            ]}
          />
        </Panel>
      </div>
    </>
  );
}

/** Accepts only a full IPv4 address with each octet inside 0-255. */
const isIpv4 = (value: string): boolean => {
  const parts = value.trim().split(".");
  return parts.length === 4 && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
};

export function IpWhitelistContent() {
  const feature = securityFeature("ip-whitelist");
  const { snapshot, refresh, enable } = useSecurity();
  const enabled = snapshot.enabled["ip-whitelist"];
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const add = (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    setMessage("");
    const value = draft.trim();
    if (!isIpv4(value)) {
      setError("Enter a valid IPv4 address, for example 102.44.18.7.");
      return;
    }
    if (snapshot.approvedIps.includes(value)) {
      setError("That address is already approved.");
      return;
    }
    addApprovedIp(value);
    refresh();
    setDraft("");
    setMessage(`${value} approved.`);
  };
  /** The scan the old wallet offered: read the address this session is using and approve it. */
  const thisDeviceApproved = snapshot.approvedIps.includes(currentSession.ip);
  const scanThisDevice = () => {
    setError("");
    if (thisDeviceApproved) {
      setMessage(`${currentSession.ip} is already on the list.`);
      return;
    }
    addApprovedIp(currentSession.ip);
    refresh();
    setMessage(`${currentSession.ip} approved for this wallet.`);
  };
  return (
    <>
      <PageHeader title={feature.title} subtitle={feature.description} />
      <div className="space-y-4">
        <FeatureStatus
          id="ip-whitelist"
          snapshot={snapshot}
          onChange={(v) => enable("ip-whitelist", v)}
        />
        <Panel
          title="Approved addresses"
          description="Sign-ins from any other address are rejected."
          bodyClassName="p-0"
        >
          {snapshot.approvedIps.length === 0 ? (
            <p className="px-5 py-6 text-sm text-muted-foreground">
              No addresses approved yet. Add one before enabling the whitelist, or you will lock
              yourself out.
            </p>
          ) : (
            snapshot.approvedIps.map((ip) => (
              <div key={ip} className="flex items-center gap-3 border-b px-5 py-3.5 last:border-0">
                <Icon icon={Shield01Icon} size={19} className="shrink-0 text-muted-foreground" />
                <code className="min-w-0 flex-1 break-all text-sm font-semibold">{ip}</code>
                {ip === currentSession.ip && (
                  <span className="shrink-0 rounded-full border bg-secondary px-2.5 py-1 text-[11px] font-semibold">
                    This device
                  </span>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove ${ip}`}
                  onClick={() => {
                    removeApprovedIp(ip);
                    refresh();
                    setMessage(`${ip} removed.`);
                  }}
                >
                  <Icon icon={Delete02Icon} size={18} />
                </Button>
              </div>
            ))
          )}
          <form onSubmit={add} className="flex flex-wrap items-end gap-3 border-t px-5 py-4">
            <label className="min-w-56 flex-1 text-sm font-semibold">
              Add an address
              <Input
                className="mt-2"
                value={draft}
                placeholder="102.44.18.7"
                onChange={(event) => setDraft(event.target.value)}
              />
            </label>
            <Button type="submit" variant="outline">
              <Icon icon={PlusSignIcon} size={16} />
              Approve address
            </Button>
          </form>
        </Panel>
        {error && <FormMessage tone="error">{error}</FormMessage>}
        {message && <FormMessage tone="ok">{message}</FormMessage>}
        <Panel
          title="This session"
          description="The address you are connected from now."
          action={
            <Button
              variant="outline"
              size="sm"
              disabled={thisDeviceApproved}
              onClick={scanThisDevice}
            >
              <Icon icon={RefreshIcon} size={16} />
              {thisDeviceApproved ? "Already approved" : "Scan this device"}
            </Button>
          }
        >
          <FactList
            items={[
              ["IP address", currentSession.ip],
              ["Status", thisDeviceApproved ? "Approved" : "Not approved"],
              ["Location", `${currentSession.city}, ${currentSession.countryName}`],
              ["Device", currentSession.device],
            ]}
          />
        </Panel>
      </div>
    </>
  );
}

/**
 * The wallet credential lives in the Security section, next to the protections it backs up, rather
 * than in Settings: changing it is a security action, not a preference.
 */
export function WalletPasswordContent() {
  const page = securityWalletPassword;
  const { snapshot } = useSecurity();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const longEnough = next.length >= 8;
  const mixed = /[0-9]/.test(next) && /[A-Za-z]/.test(next);
  const matches = next.length > 0 && next === confirm;
  const ready = longEnough && mixed && matches;
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setMessage("");
    if (!ready) {
      setError("Fix the requirements below before saving.");
      return;
    }
    setError("");
    setCurrent("");
    setNext("");
    setConfirm("");
    setMessage("Wallet password updated.");
  };
  return (
    <>
      <PageHeader title={page.title} subtitle={page.description} />
      <div className="space-y-4">
        <Panel title="Change password" description="You stay signed in on this device afterwards.">
          <form onSubmit={submit} className="max-w-xl space-y-4">
            <label className="block text-sm font-semibold">
              Current password
              <Input
                className="mt-2"
                type="password"
                autoComplete="current-password"
                value={current}
                onChange={(event) => setCurrent(event.target.value)}
                placeholder="••••••••"
              />
            </label>
            <label className="block text-sm font-semibold">
              New password
              <Input
                className="mt-2"
                type="password"
                autoComplete="new-password"
                value={next}
                onChange={(event) => setNext(event.target.value)}
                placeholder="At least 8 characters"
              />
            </label>
            <label className="block text-sm font-semibold">
              Repeat new password
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
              <li>{longEnough ? "✓" : "•"} At least 8 characters</li>
              <li>{mixed ? "✓" : "•"} Letters and numbers</li>
              <li>{matches ? "✓" : "•"} Both fields match</li>
            </ul>
            <Button type="submit" disabled={!ready}>
              Update password
            </Button>
            {error && <FormMessage tone="error">{error}</FormMessage>}
            {message && <FormMessage tone="ok">{message}</FormMessage>}
          </form>
        </Panel>
        <Panel
          title="Two passwords, two jobs"
          description="Keeping them apart is what makes each one useful."
        >
          <FactList
            items={[
              ["Wallet password", "Opens the wallet"],
              ["Transfer password", securityStateText("transfer-password", snapshot)],
              ["Login codes", "Asked for by two-factor authentication"],
            ]}
          />
          <div className="mt-4">
            <Link to="/security/transfer-password">
              <Button variant="outline" size="sm">
                Manage transfer password
              </Button>
            </Link>
          </div>
        </Panel>
        <PreviewNote>
          Preview build: the password is validated in the browser and never stored or sent anywhere.
        </PreviewNote>
      </div>
    </>
  );
}

/**
 * Which protection approves a transfer. It sits outside the score because it decides how the
 * protections already enabled are used, rather than adding a new one.
 */
export function TransferApprovalContent() {
  const page = securityTransferApproval;
  const { snapshot, refresh } = useSecurity();
  const [clock, setClock] = useState(() => new Date());
  const [message, setMessage] = useState("");
  useEffect(() => {
    const timer = window.setInterval(() => setClock(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const options: {
    id: TransferAuthMethod;
    title: string;
    detail: string;
    icon: IconData;
    /** The protections this choice needs, and where to switch them on. */
    needs: { label: string; href: string; on: boolean }[];
  }[] = [
    {
      id: "password",
      title: "Transfer password",
      detail: "The password set on the Transfer Password page.",
      icon: SecurityPasswordIcon,
      needs: [
        {
          label: "Transfer password",
          href: "/security/transfer-password",
          on: snapshot.enabled["transfer-password"],
        },
      ],
    },
    {
      id: "two-factor",
      title: "One-time code",
      detail: "Six digits from your authenticator app, valid for 30 seconds.",
      icon: FingerPrintIcon,
      needs: [
        { label: "Two-factor", href: "/security/two-factor", on: snapshot.enabled["two-factor"] },
      ],
    },
    {
      id: "both",
      title: "Both, one after the other",
      detail: "The transfer password first, then a fresh one-time code.",
      icon: Shield01Icon,
      needs: [
        {
          label: "Transfer password",
          href: "/security/transfer-password",
          on: snapshot.enabled["transfer-password"],
        },
        { label: "Two-factor", href: "/security/two-factor", on: snapshot.enabled["two-factor"] },
      ],
    },
  ];
  const choose = (id: TransferAuthMethod, title: string) => {
    setTransferAuthMethod(id);
    refresh();
    setMessage(`Transfers now wait for the ${title.toLowerCase()}.`);
  };
  return (
    <>
      <PageHeader title={page.title} subtitle={page.description} />
      <div className="space-y-4">
        <Panel
          title="Approval method"
          description="Applies to every transfer sent from this wallet."
        >
          <div className="space-y-2">
            {options.map((option) => {
              const active = snapshot.transferAuthMethod === option.id;
              const missing = option.needs.filter((need) => !need.on);
              return (
                <button
                  key={option.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => choose(option.id, option.title)}
                  className={`flex w-full cursor-pointer items-center gap-3 rounded-2xl border p-4 text-start transition-colors ${active ? "border-primary bg-primary/5" : "hover:bg-secondary/60"}`}
                >
                  <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-secondary text-muted-foreground">
                    <Icon icon={option.icon} size={19} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold">{option.title}</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {option.detail}
                    </span>
                  </span>
                  {missing.length === 0 ? (
                    <StatusPill enabled={active} on="Selected" off="Choose" />
                  ) : (
                    <StatusPill
                      enabled={false}
                      off={`${missing[0]?.label ?? "A protection"} is off`}
                    />
                  )}
                </button>
              );
            })}
          </div>
          {message && (
            <div className="mt-4">
              <FormMessage tone="ok">{message}</FormMessage>
            </div>
          )}
        </Panel>
        <Panel title="Where it is enforced" description="The transfer form reads this choice.">
          <FactList
            items={[
              ["Applied to", "Every transfer you send"],
              ["Method", snapshot.transferAuthMethod.replace("two-factor", "one-time code")],
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
          Preview build: your authenticator code right now is{" "}
          <strong>{twoFactorCode(clock)}</strong>, rotating in {twoFactorCodeSecondsLeft(clock)}s.
          Nothing outside this browser checks it.
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
          title="Why a device stays signed in"
          description="What decides how long a session survives."
        >
          <FactList
            items={[
              ["Auto sign-in", securityStateText("auto-sign-in", snapshot)],
              ["Two-factor", securityStateText("two-factor", snapshot)],
              ["Sign-in hours", securityStateText("time-access", snapshot)],
              ["Countries", securityStateText("geo-lock", snapshot)],
            ]}
          />
          <div className="mt-4 flex flex-wrap gap-2">
            <Link to="/security/auto-sign-in">
              <Button variant="outline" size="sm">
                Auto sign-in
              </Button>
            </Link>
            <Link to="/security/two-factor">
              <Button variant="outline" size="sm">
                Two-factor
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
