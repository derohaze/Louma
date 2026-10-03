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
import { useT } from "@/shared/i18n";
import { dateText } from "@/shared/lib/wallet";
import { CopyButton, PageHeader } from "@/shared/ui/page";
import { FactList, FormMessage, Panel } from "@/shared/ui/panels";

export function AccountContent() {
  const t = useT("settings.account");
  const common = useT("common");
  const { user, wallet } = useWallet();
  const { isDark, toggle } = useTheme();
  const [message, setMessage] = useState("");
  return (
    <>
      <PageHeader title={t("title")} subtitle={t("description")} />
      <div className="space-y-4">
        <Panel title={t("appearance.title")} description={t("appearance.description")}>
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-semibold">{t("appearance.darkMode")}</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {t("appearance.darkModeDetail")}
              </p>
            </div>
            <Switch
              checked={isDark}
              onCheckedChange={toggle}
              aria-label={t("appearance.darkMode")}
            />
          </div>
        </Panel>
        <Panel title={t("identity.title")} description={t("identity.description")}>
          <FactList
            items={[
              [t("identity.email"), user?.email ?? common("state.none")],
              [
                t("identity.accountId"),
                <code key="id" className="break-all">
                  {user?.id ?? common("state.none")}
                </code>,
              ],
              [
                t("identity.address"),
                <span key="address" className="flex items-center gap-1">
                  <code className="min-w-0 break-all">
                    {wallet?.address ?? common("state.none")}
                  </code>
                  {wallet?.address && <CopyButton text={wallet.address} />}
                </span>,
              ],
              [
                t("identity.status"),
                wallet?.status === "frozen" ? common("state.frozen") : common("state.active"),
              ],
              [
                t("identity.created"),
                wallet?.createdAt ? dateText(wallet.createdAt) : common("state.none"),
              ],
            ]}
          />
        </Panel>
        <Panel
          title={t("delete.title")}
          description={t("delete.description")}
          tone="danger"
          action={
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" className="border-destructive text-destructive">
                  {t("delete.button")}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{t("delete.confirmTitle")}</AlertDialogTitle>
                  <AlertDialogDescription>{t("delete.confirmBody")}</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{t("delete.keep")}</AlertDialogCancel>
                  <AlertDialogAction onClick={() => setMessage(t("delete.unavailable"))}>
                    {t("delete.button")}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          }
        >
          <p className="text-sm text-muted-foreground">{t("delete.warning")}</p>
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
