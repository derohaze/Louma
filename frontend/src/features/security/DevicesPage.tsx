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
      setMessage(`${session.device} signed out.`);
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
    setMessage(`${removed} other session(s) signed out.`);
  };
  const loading = sessionsQuery.isPending;
  // An action that failed is reported as it happened; a list that could not be read reports itself.
  const error = actionError || (sessionsQuery.error ? messageForError(sessionsQuery.error) : "");
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
            <div aria-busy="true" className="px-5 py-4">
              <p role="status" className="sr-only">
                Loading devices…
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
        {error && <SecurityErrorText error={error} />}
        {message && <FormMessage tone="ok">{message}</FormMessage>}
        <div className="text-sm text-muted-foreground">
          Lost a device?{" "}
          <Link to="/security/freeze" className="font-semibold text-primary-soft">
            Freeze the wallet
          </Link>{" "}
          first, then revoke the session.
        </div>
      </div>
    </>
  );
}
