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
import { useT, useTranslate } from "@/shared/i18n";
import { SecurityErrorText } from "@/features/security/SecurityMessage";

/** The Transfer Password page: the spend credential, separate from the sign-in password. */
export function TransferPasswordPage() {
  const t = useT("security.transferPassword");
  const common = useT("common");
  const translate = useTranslate();
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
      setError(t("errors.currentRequired"));
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
      setMessage(t("messages.saved"));
      await refreshSecurity();
    } catch (cause) {
      setError(messageForError(cause));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <PageHeader
        title={translate(feature.titleKey)}
        subtitle={translate(feature.descriptionKey)}
      />
      <div className="space-y-4">
        <Panel
          delayMs={0}
          title={t(enabled ? "set.title" : "unset.title")}
          description={translate(feature.descriptionKey)}
          action={<StatusPill enabled={enabled} />}
        >
          <p className="text-sm text-muted-foreground">{t(enabled ? "set.body" : "unset.body")}</p>
        </Panel>
        <Panel
          delayMs={75}
          title={t(enabled ? "set.action" : "unset.action")}
          description={t("description")}
        >
          <form onSubmit={(event) => void submit(event)} className="max-w-xl space-y-4">
            {enabled && (
              <label className="block text-sm font-semibold">
                {t("current")}
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
              {t("next")}
              <Input
                className="mt-2"
                type="password"
                autoComplete="new-password"
                maxLength={LIMITS.maxPasswordLength}
                value={next}
                onChange={(event) => setNext(event.target.value)}
                placeholder={t("nextHint")}
              />
            </label>
            <label className="block text-sm font-semibold">
              {t("repeat")}
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
              {busy ? common("actions.saving") : t(enabled ? "set.submit" : "unset.submit")}
            </Button>
            {error && <SecurityErrorText error={error} />}
            {message && <FormMessage tone="ok">{message}</FormMessage>}
          </form>
        </Panel>
        <Panel delayMs={150} title={t("rules.title")} description={t("rules.description")}>
          <FactList
            items={[
              [t("rules.everyTransfer"), t(enabled ? "rules.required" : "rules.notRequired")],
              [t("rules.wrongPassword"), t("rules.wrongPasswordDetail")],
            ]}
          />
        </Panel>
      </div>
    </>
  );
}
