import { useState } from "react";
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
import { Switch } from "@/shared/ui/switch";
import { useWallet } from "@/shared/hooks";
import { useTheme } from "@/shared/hooks";
import { settingsPage } from "@/shared/lib/account";
import { dateText } from "@/shared/lib/wallet";
import { CopyButton, PageHeader } from "@/shared/ui/page";
import { FactList, FormMessage, Panel } from "@/shared/ui/panels";

export function AccountContent() {
  const page = settingsPage("/settings");
  const { user, wallet } = useWallet();
  const { isDark, toggle } = useTheme();
  const [message, setMessage] = useState("");
  return (
    <>
      <PageHeader title={page.title} subtitle={page.description} />
      <div className="space-y-4">
        <Panel title="Appearance" description="Choose how the dashboard looks on this device.">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-semibold">Dark mode</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Switch the dashboard to a darker color scheme.
              </p>
            </div>
            <Switch checked={isDark} onCheckedChange={toggle} aria-label="Dark mode" />
          </div>
        </Panel>
        <Panel title="Wallet identity" description="Details tied to this wallet account.">
          <FactList
            items={[
              ["Sign-in email", user?.email ?? "—"],
              [
                "Account ID",
                <code key="id" className="break-all">
                  {user?.id ?? "—"}
                </code>,
              ],
              [
                "Wallet address",
                <span key="address" className="flex items-center gap-1">
                  <code className="min-w-0 break-all">{wallet?.address ?? "—"}</code>
                  {wallet?.address && <CopyButton text={wallet.address} />}
                </span>,
              ],
              ["Wallet status", wallet?.status === "frozen" ? "Frozen" : "Active"],
              ["Created", wallet?.createdAt ? dateText(wallet.createdAt) : "—"],
            ]}
          />
        </Panel>
        <Panel
          title="Delete wallet account"
          description="Permanently removes the wallet, its ledger accounts, and its history."
          tone="danger"
          action={
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" className="border-destructive text-destructive">
                  Delete account
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete this wallet account?</AlertDialogTitle>
                  <AlertDialogDescription>
                    The wallet, its address, and every transfer would be removed permanently. This
                    cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Keep my wallet</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() =>
                      setMessage(
                        "Account deletion is not available yet. Nothing was deleted; ask support to close an account with a balance.",
                      )
                    }
                  >
                    Delete account
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          }
        >
          <p className="text-sm text-muted-foreground">
            Withdraw your balance before deleting the account: anything left in the wallet cannot be
            recovered afterwards.
          </p>
          {message && (
            <div className="mt-4">
              <FormMessage tone="ok">{message}</FormMessage>
            </div>
          )}
        </Panel>
      </div>
    </>
  );
}
