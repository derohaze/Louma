import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { QRCodeSVG } from "qrcode.react";
import {
  AlertCircleIcon,
  CheckmarkCircle02Icon,
  ComputerIcon,
  LockIcon,
  RefreshIcon,
  SnowIcon,
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
import { Switch } from "@/components/ui/switch";
import {
  LIMITS,
  isOneTimeCode,
  newPasswordError,
  oneTimeCodeDigits,
  passwordRules,
} from "@/lib/validation";
import { useWallet, type Session } from "@/hooks/wallet-context";
import { api, messageForError } from "@/lib/api";
import { securityDevices, securityFeature, securityFreezeWallet } from "@/lib/security-catalog";
import { dateText } from "@/lib/wallet-format";
import { CopyButton, Icon, PageHeader } from "./wallet-shell";
import { FactList, FormMessage, Panel, StatusPill } from "./security-ui";

/**
 * One page per control on the Security Center. Every action here hits the security API, and the
 * result is re-read from `/api/v1/security`, so the switch on the Security Center can never show a
 * state the backend has not stored.
 */

function ErrorText({ error }: { error: string }) {
  return error ? <FormMessage tone="error">{error}</FormMessage> : null;
}

export function TwoFactorContent() {
  const feature = securityFeature("two-factor");
  const { security, refreshSecurity } = useWallet();
  const enabled = security?.twoFactor.enabled ?? false;
  const [setup, setSetup] = useState<{ secret: string; otpauthUri: string } | null>(null);
  const [code, setCode] = useState("");
  const [codes, setCodes] = useState<string[]>([]);
  /** True while the switch is off but the server still has two-factor on, waiting for one code. */
  const [confirmingOff, setConfirmingOff] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  /** The account password, which every second-factor change requires in addition to a code. */
  const [password, setPassword] = useState("");
  /** True while the switch is on but the password has not been entered to begin enrolment yet. */
  const [startingSetup, setStartingSetup] = useState(false);

  const run = async (action: () => Promise<string>) => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      setMessage(await action());
    } catch (cause) {
      setError(messageForError(cause));
    } finally {
      setBusy(false);
    }
  };

  /**
   * Enrolment asks for the account password before it hands out a secret. The setup still only counts
   * once the new authenticator confirms it with a code, but a session alone must not be able to bind
   * a factor the owner does not hold.
   */
  const startSetup = () =>
    run(async () => {
      const response = await api.post<{ secret: string; otpauthUri: string }>(
        "/api/v1/security/2fa/enable",
        { password },
      );
      setSetup({ secret: response.secret, otpauthUri: response.otpauthUri });
      setStartingSetup(false);
      setPassword("");
      return "Scan the key in your authenticator app, then enter the six-digit code it shows.";
    });

  const cancelSetup = () => {
    setSetup(null);
    setStartingSetup(false);
    setCode("");
    setPassword("");
    setError("");
    setMessage("");
  };

  /**
   * The switch on the panel header is the whole entry point. On: ask for the password and start
   * setup. Off during setup: abandon it. Off while enabled: ask for the password and one code,
   * because turning a second factor off is the dangerous direction.
   */
  const toggle = (next: boolean) => {
    if (busy) return;
    setMessage("");
    setError("");
    if (next) {
      if (!enabled && !setup) setStartingSetup(true);
    } else if (setup || startingSetup) {
      cancelSetup();
    } else if (enabled) {
      setConfirmingOff(true);
    }
  };

  const confirmSetup = () =>
    run(async () => {
      const response = await api.post<{ recoveryCodes: string[] }>("/api/v1/security/2fa/confirm", {
        code,
      });
      setCodes(response.recoveryCodes);
      setSetup(null);
      setCode("");
      await refreshSecurity();
      return "Two-factor authentication is on. Store your recovery codes now.";
    });

  const disable = () =>
    run(async () => {
      await api.post("/api/v1/security/2fa/disable", { password, code });
      setCode("");
      setPassword("");
      setCodes([]);
      setConfirmingOff(false);
      await refreshSecurity();
      return "Two-factor authentication is off.";
    });

  const regenerate = () =>
    run(async () => {
      const response = await api.post<{ recoveryCodes: string[] }>(
        "/api/v1/security/2fa/recovery-codes",
        { password, code },
      );
      setCodes(response.recoveryCodes);
      setCode("");
      setPassword("");
      await refreshSecurity();
      return "New recovery codes generated. The old set no longer works.";
    });

  return (
    <>
      <PageHeader title={feature.title} subtitle={feature.description} />
      <div className="space-y-4">
        <Panel
          title={enabled ? "Two-factor authentication is on" : "Two-factor authentication is off"}
          description={feature.description}
          action={
            <Switch
              checked={confirmingOff ? false : enabled || setup !== null || startingSetup}
              onCheckedChange={toggle}
              disabled={busy}
              aria-label="Two-factor authentication"
            />
          }
        >
          {enabled && confirmingOff ? (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Enter your account password and a current authenticator or recovery code to turn
                two-factor off.
              </p>
              <label className="block max-w-xs text-sm font-semibold">
                Account password
                <Input
                  className="mt-2"
                  type="password"
                  autoComplete="current-password"
                  maxLength={LIMITS.maxPasswordLength}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </label>
              <label className="block max-w-xs text-sm font-semibold">
                Authenticator or recovery code
                <Input
                  className="mt-2"
                  autoComplete="one-time-code"
                  maxLength={64}
                  value={code}
                  onChange={(event) => setCode(event.target.value.slice(0, 64))}
                />
              </label>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="destructive"
                  disabled={busy || !password || code.length < 6}
                  onClick={() => void disable()}
                >
                  {busy ? "Turning off…" : "Turn off two-factor"}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setConfirmingOff(false);
                    setCode("");
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : enabled ? (
            <p className="text-sm text-muted-foreground">
              {security?.twoFactor.recoveryCodesRemaining ?? 0} recovery codes remaining
              {security?.twoFactor.enabledAt
                ? ` · enabled ${dateText(security.twoFactor.enabledAt)}`
                : ""}
              .
            </p>
          ) : setup ? (
            <div className="space-y-4">
              <div className="flex flex-col items-start gap-4 sm:flex-row">
                <div className="rounded-2xl border bg-white p-3">
                  <QRCodeSVG
                    value={setup.otpauthUri}
                    size={148}
                    level="M"
                    marginSize={1}
                    fgColor="#20123A"
                    bgColor="#FFFFFF"
                    aria-label="Authenticator setup QR code"
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-muted-foreground">Authenticator key</p>
                  <div className="mt-1 flex items-center gap-2 rounded-xl bg-secondary p-3">
                    <code className="min-w-0 flex-1 break-all text-sm font-semibold">
                      {setup.secret}
                    </code>
                    <CopyButton text={setup.secret} />
                  </div>
                </div>
              </div>
              <label className="block max-w-xs text-sm font-semibold">
                Six-digit code
                <Input
                  className="mt-2"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={LIMITS.oneTimeCodeLength}
                  value={code}
                  onChange={(event) => setCode(oneTimeCodeDigits(event.target.value))}
                  placeholder="123456"
                />
              </label>
              <div className="flex flex-wrap gap-2">
                <Button disabled={busy || !isOneTimeCode(code)} onClick={() => void confirmSetup()}>
                  <Icon icon={LockIcon} size={16} />
                  {busy ? "Checking…" : "Turn on two-factor"}
                </Button>
                <Button variant="outline" onClick={cancelSetup}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : startingSetup ? (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Confirm your account password to start setting up an authenticator app.
              </p>
              <label className="block max-w-xs text-sm font-semibold">
                Account password
                <Input
                  className="mt-2"
                  type="password"
                  autoComplete="current-password"
                  maxLength={LIMITS.maxPasswordLength}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </label>
              <div className="flex flex-wrap gap-2">
                <Button disabled={busy || !password} onClick={() => void startSetup()}>
                  <Icon icon={LockIcon} size={16} />
                  {busy ? "Starting…" : "Start setup"}
                </Button>
                <Button variant="outline" onClick={cancelSetup}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Turn the switch on to set up an authenticator app: confirm your account password, then
              scan the secret key and enter the first code it shows.
            </p>
          )}
        </Panel>
        {codes.length > 0 && (
          <Panel
            title="Recovery codes"
            description="Each code works once. They are shown only now."
          >
            <div className="grid gap-2 sm:grid-cols-4">
              {codes.map((code) => (
                <code
                  key={code}
                  className="rounded-lg border bg-secondary/60 px-3 py-2 text-center text-sm font-semibold tracking-wide"
                >
                  {code}
                </code>
              ))}
            </div>
            <div className="mt-4">
              <CopyButton text={codes.join("\n")} />
              <FormMessage tone="ok">
                Copy them somewhere safe before leaving this page.
              </FormMessage>
            </div>
          </Panel>
        )}
        {enabled && (
          <>
            <Panel
              title="Regenerate recovery codes"
              description="Your account password and a current authenticator or recovery code are required."
            >
              <div className="max-w-xs space-y-4">
                <label className="block text-sm font-semibold">
                  Account password
                  <Input
                    className="mt-2"
                    type="password"
                    autoComplete="current-password"
                    maxLength={LIMITS.maxPasswordLength}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                  />
                </label>
                <label className="block text-sm font-semibold">
                  Authenticator or recovery code
                  <Input
                    className="mt-2"
                    maxLength={64}
                    value={code}
                    onChange={(event) => setCode(event.target.value.slice(0, 64))}
                  />
                </label>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  disabled={busy || !password || code.length < 6}
                  onClick={() => void regenerate()}
                >
                  <Icon icon={RefreshIcon} size={16} />
                  Generate new codes
                </Button>
              </div>
            </Panel>
          </>
        )}
        {error && <ErrorText error={error} />}
        {message && <FormMessage tone="ok">{message}</FormMessage>}
      </div>
    </>
  );
}

export function TransferPasswordContent() {
  const feature = securityFeature("transfer-password");
  const { security, refreshSecurity } = useWallet();
  const enabled = security?.transferPassword.enabled ?? false;
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  /** The same strength rules the sign-in credential applies, read from the shared validation module. */
  const rules = passwordRules(next);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setMessage("");
    setError("");
    if (enabled && !current) {
      setError("Enter your current transfer password.");
      return;
    }
    const problem = newPasswordError(next, confirm);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    try {
      await api.post("/api/v1/security/transfer-password", {
        ...(enabled ? { currentPassword: current } : {}),
        newPassword: next,
      });
      setCurrent("");
      setNext("");
      setConfirm("");
      setMessage("Transfer password updated.");
      await refreshSecurity();
    } catch (cause) {
      setError(messageForError(cause));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <PageHeader title={feature.title} subtitle={feature.description} />
      <div className="space-y-4">
        <Panel
          title={enabled ? "Transfer password is set" : "No transfer password is set"}
          description={feature.description}
          action={<StatusPill enabled={enabled} />}
        >
          <p className="text-sm text-muted-foreground">
            {enabled
              ? "Every transfer asks for it before any LMA leaves the wallet."
              : "Without it, a signed-in session can move funds on its own."}
          </p>
        </Panel>
        <Panel
          title={enabled ? "Change transfer password" : "Set transfer password"}
          description="Separate from your wallet password, so a leaked sign-in cannot move funds."
        >
          <form onSubmit={(event) => void submit(event)} className="max-w-xl space-y-4">
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
            <Button type="submit" disabled={busy}>
              <Icon icon={LockIcon} size={16} />
              {busy ? "Saving…" : enabled ? "Update password" : "Set password"}
            </Button>
            {error && <ErrorText error={error} />}
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
      </div>
    </>
  );
}

/** The emergency stop: one switch that holds every transfer until the owner unfreezes the wallet. */
export function FreezeWalletContent() {
  const page = securityFreezeWallet;
  const { security, refresh, refreshSecurity } = useWallet();
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  /**
   * The unfreeze dialog is controlled so it can stay open across the request: an error has to be read
   * in the dialog the customer is looking at, and the dialog must only close on success.
   */
  const [unfreezeOpen, setUnfreezeOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const frozen = security?.wallet.status === "frozen";
  const requiresCode = security?.twoFactor.enabled ?? false;
  const apply = async (value: boolean) => {
    setBusy(true);
    setMessage("");
    setError("");
    try {
      if (value) {
        await api.post("/api/v1/security/freeze");
      } else {
        await api.post("/api/v1/security/unfreeze", {
          password,
          ...(requiresCode ? { code } : {}),
        });
      }
      setPassword("");
      setCode("");
      setMessage(
        value
          ? "Wallet frozen. Nothing leaves it until you unfreeze."
          : "Wallet unfrozen. Transfers work again.",
      );
      if (!value) setUnfreezeOpen(false);
      await Promise.all([refresh(), refreshSecurity()]);
    } catch (cause) {
      setError(messageForError(cause));
    } finally {
      setBusy(false);
    }
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
              <AlertDialog open={unfreezeOpen} onOpenChange={setUnfreezeOpen}>
                <AlertDialogTrigger asChild>
                  <Button disabled={busy}>
                    <Icon icon={CheckmarkCircle02Icon} size={17} />
                    Unfreeze wallet
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Unfreeze this wallet?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Confirm with your account password
                      {requiresCode ? " and a current authenticator code" : ""}. Transfers work
                      again as soon as the wallet is active.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <div className="space-y-3 px-1">
                    <label className="block text-sm font-semibold">
                      Account password
                      <Input
                        className="mt-2"
                        type="password"
                        autoComplete="current-password"
                        maxLength={LIMITS.maxPasswordLength}
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                      />
                    </label>
                    {requiresCode && (
                      <label className="block text-sm font-semibold">
                        Authenticator or recovery code
                        <Input
                          className="mt-2"
                          maxLength={64}
                          value={code}
                          onChange={(event) => setCode(event.target.value.slice(0, 64))}
                        />
                      </label>
                    )}
                    {error && <ErrorText error={error} />}
                  </div>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Keep it frozen</AlertDialogCancel>
                    <AlertDialogAction
                      disabled={busy || !password || (requiresCode && code.length < 6)}
                      onClick={(event) => {
                        // Keep the dialog open while the request runs: closing it on click would hide
                        // the reason an unfreeze failed, leaving the customer with no explanation.
                        event.preventDefault();
                        void apply(false);
                      }}
                    >
                      {busy ? "Unfreezing…" : "Unfreeze wallet"}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            ) : (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive" disabled={busy}>
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
                    <AlertDialogAction onClick={() => void apply(true)}>
                      Freeze wallet
                    </AlertDialogAction>
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
          {error && !frozen && (
            <div className="mt-4">
              <ErrorText error={error} />
            </div>
          )}
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
            ["Transfers out", "Refused by the backend before they are submitted"],
            ["Sign-in on a new device", "Blocked"],
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
      </div>
    </>
  );
}

/** Every device signed in to the wallet, with a revoke action per row. */
export function DevicesContent() {
  const page = securityDevices;
  const { refreshSecurity } = useWallet();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const load = async () => {
    const response = await api.get<{ sessions: Session[] }>("/api/v1/sessions");
    setSessions(response.sessions);
  };
  useEffect(() => {
    let active = true;
    void api
      .get<{ sessions: Session[] }>("/api/v1/sessions")
      .then((response) => {
        if (active) setSessions(response.sessions);
      })
      .catch((cause: unknown) => {
        if (active) setError(messageForError(cause));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);
  const otherSessions = sessions.filter((session) => !session.current);
  const revoke = async (session: Session) => {
    setError("");
    try {
      await api.delete(`/api/v1/sessions/${encodeURIComponent(session.id)}`);
      await load();
      await refreshSecurity();
      setMessage(`${session.device} signed out.`);
    } catch (cause) {
      setError(messageForError(cause));
    }
  };
  const revokeOthers = async () => {
    setError("");
    let removed = 0;
    for (const session of otherSessions) {
      try {
        await api.delete(`/api/v1/sessions/${encodeURIComponent(session.id)}`);
        removed += 1;
      } catch {
        // A session that was already revoked is not a failure; keep going.
      }
    }
    await load();
    await refreshSecurity();
    setMessage(`${removed} other session(s) signed out.`);
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
            otherSessions.length > 0 ? (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="outline" size="sm">
                    Sign out other devices
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>
                      Sign out {otherSessions.length} other device(s)?
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                      They stay signed in until their next request, then need your credentials and a
                      second factor again. This device is not affected.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={() => void revokeOthers()}>
                      Sign them out
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            ) : undefined
          }
        >
          {loading ? (
            <p className="px-5 py-6 text-sm text-muted-foreground">Loading devices…</p>
          ) : sessions.length ? (
            sessions.map((session) => (
              <div
                key={session.id}
                className="flex flex-wrap items-center gap-3 border-b px-5 py-4 last:border-0"
              >
                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-secondary text-muted-foreground">
                  <Icon icon={ComputerIcon} size={19} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{session.device}</p>
                  <p className="text-xs text-muted-foreground">
                    Last active {dateText(session.lastActiveAt)} · expires{" "}
                    {dateText(session.expiresAt)}
                  </p>
                </div>
                {session.current && <StatusPill enabled on="This device" />}
                <Button
                  variant="outline"
                  size="sm"
                  disabled={session.current}
                  onClick={() => void revoke(session)}
                >
                  {session.current ? "Current session" : "Sign out"}
                </Button>
              </div>
            ))
          ) : (
            <p className="px-5 py-6 text-sm text-muted-foreground">
              No active sessions were found.
            </p>
          )}
        </Panel>
        {error && <ErrorText error={error} />}
        {message && <FormMessage tone="ok">{message}</FormMessage>}
        <div className="text-sm text-muted-foreground">
          Lost a device?{" "}
          <Link to="/security/freeze" className="font-semibold text-primary">
            Freeze the wallet
          </Link>{" "}
          first, then revoke the session.
        </div>
      </div>
    </>
  );
}
