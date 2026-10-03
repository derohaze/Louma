import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ComputerIcon } from "@hugeicons/core-free-icons";
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
import { Skeleton } from "@/shared/ui/skeleton";
import { Icon, PageHeader } from "@/shared/ui/page";
import { FormMessage, Panel, StatusPill } from "@/shared/ui/panels";
import { useWallet, type Session } from "@/shared/hooks";
import { api, messageForError } from "@/shared/api";
import {
  accountFetchers,
  hasBrowserSession,
  refetchAccount,
  serverStateFreshness,
  serverStateKeys,
} from "@/shared/lib/platform";
import { securityDevices } from "@/shared/lib/security";
import { dateText } from "@/shared/lib/wallet";
import { useT, useTranslate } from "@/shared/i18n";
import { SecurityErrorText } from "@/features/security/SecurityMessage";

/**
 * Every device signed in to the wallet, with a revoke action per row.
 *
 * The list is read from the shared cache like every other piece of server state, not fetched by this
 * component: the page renders more than once per visit, and an effect that fetches on mount would
 * ask the API once per render — the same list, milliseconds apart. A query is read through its key,
 * so concurrent readers join one request, and a revoke only has to refresh the entry instead of
 * keeping a private copy in step with it.
 */
export function DevicesPage() {
  const t = useT("security.devices");
  const common = useT("common");
  const translate = useTranslate();
  const page = securityDevices;
  const { refreshSecurity } = useWallet();
  const queryClient = useQueryClient();
  const sessionsQuery = useQuery({
    queryKey: serverStateKeys.sessions,
    queryFn: accountFetchers.sessions,
    staleTime: serverStateFreshness.sessionsMs,
    enabled: hasBrowserSession,
  });
  const sessions = sessionsQuery.data?.sessions ?? [];
  const [message, setMessage] = useState("");
  const [actionError, setActionError] = useState("");
  const load = () => refetchAccount(queryClient, [serverStateKeys.sessions]);
  const otherSessions = sessions.filter((session) => !session.current);
  const revoke = async (session: Session) => {
    setActionError("");
    try {
      await api.delete(`/api/v1/sessions/${encodeURIComponent(session.id)}`);
      await load();
      await refreshSecurity();
      setMessage(t("messages.revoked", { device: session.device }));
    } catch (cause) {
      setActionError(messageForError(cause));
    }
  };
  const revokeOthers = async () => {
    setActionError("");
    let removed = 0;
    for (const session of otherSessions) {
      try {
        await api.delete(`/api/v1/sessions/${encodeURIComponent(session.id)}`);
        removed += 1;
      } catch {
        // A session that was already revoked is not a failure; keep going.
      }
    }
    try {
      await load();
      await refreshSecurity();
    } catch (cause) {
      // The devices were revoked; only the list behind them could not be re-read.
      setActionError(messageForError(cause));
      return;
    }
    setMessage(t("messages.revokedOthers", { count: removed }));
  };
  const loading = sessionsQuery.isPending;
  // An action that failed is reported as it happened; a list that could not be read reports itself.
  const error = actionError || (sessionsQuery.error ? messageForError(sessionsQuery.error) : "");
  return (
    <>
      <PageHeader title={translate(page.titleKey)} subtitle={translate(page.descriptionKey)} />
      <div className="space-y-4">
        <Panel
          delayMs={0}
          title={t("panel.title")}
          description={t("panel.description")}
          bodyClassName="p-0"
          action={
            otherSessions.length > 0 ? (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="outline" size="sm">
                    {t("signOutOthers")}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>
                      {t("confirm.title", { count: otherSessions.length })}
                    </AlertDialogTitle>
                    <AlertDialogDescription>{t("confirm.body")}</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>{common("actions.cancel")}</AlertDialogCancel>
                    <AlertDialogAction onClick={() => void revokeOthers()}>
                      {t("confirm.action")}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            ) : undefined
          }
        >
          {loading ? (
            <div aria-busy="true" className="px-5 py-4">
              <p role="status" className="sr-only">
                {t("loading")}
              </p>
              {Array.from({ length: 3 }, (_, i) => (
                <div key={i} className="flex items-center gap-3 border-b py-4 last:border-0">
                  <Skeleton className="size-10 rounded-xl" />
                  <div className="min-w-0 flex-1">
                    <Skeleton className="h-4 w-48" />
                    <Skeleton className="mt-2 h-3 w-64" />
                  </div>
                  <Skeleton className="h-8 w-24 rounded-full" />
                </div>
              ))}
            </div>
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
                    {t("lastActive", {
                      lastActive: dateText(session.lastActiveAt),
                      expires: dateText(session.expiresAt),
                    })}
                  </p>
                </div>
                {session.current && <StatusPill enabled on={t("thisDevice")} />}
                <Button
                  variant="outline"
                  size="sm"
                  disabled={session.current}
                  onClick={() => void revoke(session)}
                >
                  {t(session.current ? "currentSession" : "signOut")}
                </Button>
              </div>
            ))
          ) : (
            <p className="px-5 py-6 text-sm text-muted-foreground">{t("empty")}</p>
          )}
        </Panel>
        {error && <SecurityErrorText error={error} />}
        {message && <FormMessage tone="ok">{message}</FormMessage>}
        <div className="text-sm text-muted-foreground">
          {t("lostDevice.question")}{" "}
          <Link to="/security/freeze" className="font-semibold text-primary-soft">
            {t("lostDevice.freeze")}
          </Link>{" "}
          {t("lostDevice.tail")}
        </div>
      </div>
    </>
  );
}
