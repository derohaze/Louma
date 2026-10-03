import { useState } from "react";
import { CheckmarkCircle02Icon, SnowIcon } from "@hugeicons/core-free-icons";
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
} from "@/shared/ui/alert-dialog";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Icon, PageHeader } from "@/shared/ui/page";
import { FormMessage, Panel } from "@/shared/ui/panels";
import { useWallet } from "@/shared/hooks";
import { api, messageForError } from "@/shared/api";
import { LIMITS } from "@/shared/lib/platform";
import { securityFreezeWallet } from "@/shared/lib/security";
import { useT, useTranslate } from "@/shared/i18n";
import { SecurityErrorText } from "@/features/security/SecurityMessage";

/** The emergency stop: one switch that holds every transfer until the owner unfreezes the wallet. */
export function FreezeWalletPage() {
  const t = useT("security.freeze");
  const common = useT("common");
  const translate = useTranslate();
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
      setMessage(t(value ? "messages.frozen" : "messages.unfrozen"));
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
      <PageHeader title={translate(page.titleKey)} subtitle={translate(page.descriptionKey)} />
      <div className="space-y-4">
        <Panel
          title={t(frozen ? "title.frozen" : "title.active")}
          description={t(frozen ? "description.frozen" : "description.active")}
          action={
            frozen ? (
              <AlertDialog open={unfreezeOpen} onOpenChange={setUnfreezeOpen}>
                <AlertDialogTrigger asChild>
                  <Button disabled={busy}>
                    <Icon icon={CheckmarkCircle02Icon} size={17} />
                    {t("unfreeze.button")}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>{t("unfreeze.confirmTitle")}</AlertDialogTitle>
                    <AlertDialogDescription>
                      {t("unfreeze.confirmBody", {
                        andCode: requiresCode ? t("unfreeze.andCode") : "",
                      })}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <div className="space-y-3 px-1">
                    <label className="block text-sm font-semibold">
                      {t("unfreeze.password")}
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
                        {t("unfreeze.code")}
                        <Input
                          className="mt-2"
                          maxLength={64}
                          value={code}
                          onChange={(event) => setCode(event.target.value.slice(0, 64))}
                        />
                      </label>
                    )}
                    {error && <SecurityErrorText error={error} />}
                  </div>
                  <AlertDialogFooter>
                    <AlertDialogCancel>{t("unfreeze.keep")}</AlertDialogCancel>
                    <AlertDialogAction
                      disabled={busy || !password || (requiresCode && code.length < 6)}
                      onClick={(event) => {
                        // Keep the dialog open while the request runs: closing it on click would hide
                        // the reason an unfreeze failed, leaving the customer with no explanation.
                        event.preventDefault();
                        void apply(false);
                      }}
                    >
                      {t(busy ? "unfreeze.busy" : "unfreeze.button")}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            ) : (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive" disabled={busy}>
                    <Icon icon={SnowIcon} size={17} />
                    {t("freeze.button")}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>{t("freeze.confirmTitle")}</AlertDialogTitle>
                    <AlertDialogDescription>{t("freeze.confirmBody")}</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>{common("actions.cancel")}</AlertDialogCancel>
                    <AlertDialogAction onClick={() => void apply(true)}>
                      {t("freeze.button")}
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
            <p>{t(frozen ? "note.frozen" : "note.active")}</p>
          </div>
          {error && !frozen && (
            <div className="mt-4">
              <SecurityErrorText error={error} />
            </div>
          )}
          {message && (
            <div className="mt-4">
              <FormMessage tone="ok">{message}</FormMessage>
            </div>
          )}
        </Panel>
        <Panel title={t("impact.title")} description={t("impact.description")} bodyClassName="p-0">
          {[
            [t("impact.transfersOut"), t("impact.transfersOutDetail")],
            [t("impact.signIn"), t("impact.signInDetail")],
            [t("impact.incoming"), t("impact.incomingDetail")],
            [t("impact.unfreezing"), t("impact.unfreezingDetail")],
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
