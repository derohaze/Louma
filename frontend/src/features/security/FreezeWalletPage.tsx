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
import { SecurityErrorText } from "@/features/security/SecurityMessage";

/** The emergency stop: one switch that holds every transfer until the owner unfreezes the wallet. */
export function FreezeWalletPage() {
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
                    {error && <SecurityErrorText error={error} />}
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
              <SecurityErrorText error={error} />
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
