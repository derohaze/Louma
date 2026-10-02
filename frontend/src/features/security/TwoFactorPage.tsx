import { useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { LockIcon, RefreshIcon } from "@hugeicons/core-free-icons";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Switch } from "@/shared/ui/switch";
import { CopyButton, Icon, PageHeader } from "@/shared/ui/page";
import { FormMessage, Panel } from "@/shared/ui/panels";
import { useWallet } from "@/shared/hooks";
import { api, messageForError } from "@/shared/api";
import { LIMITS, isOneTimeCode, oneTimeCodeDigits } from "@/shared/lib/platform";
import { securityFeature } from "@/shared/lib/security";
import { dateText } from "@/shared/lib/wallet";
import { SecurityErrorText } from "@/features/security/SecurityMessage";

/** The Two-Factor page: authenticator enrolment, recovery codes, and disable flow. */
export function TwoFactorPage() {
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
                    // The password belongs to this form, but its state is shared with the
                    // recovery-code form below: leaving it filled would put this action's credential
                    // in a field for a different one.
                    setPassword("");
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
        {error && <SecurityErrorText error={error} />}
        {message && <FormMessage tone="ok">{message}</FormMessage>}
      </div>
    </>
  );
}
