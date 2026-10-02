import { useState } from "react";
import { LockIcon } from "@hugeicons/core-free-icons";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Icon, PageHeader } from "@/shared/ui/page";
import { FactList, FormMessage, Panel, StatusPill } from "@/shared/ui/panels";
import { useWallet } from "@/shared/hooks";
import { api, messageForError } from "@/shared/api";
import { LIMITS, newPasswordError, passwordRules } from "@/shared/lib/platform";
import { securityFeature } from "@/shared/lib/security";
import { SecurityErrorText } from "@/features/security/SecurityMessage";

/** The Transfer Password page: the spend credential, separate from the sign-in password. */
export function TransferPasswordPage() {
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
            {error && <SecurityErrorText error={error} />}
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
