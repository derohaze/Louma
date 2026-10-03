import { Link } from "@tanstack/react-router";
import { BitcoinCpuIcon, Coins01Icon, UserGroupIcon } from "@hugeicons/core-free-icons";
import { Button } from "@/shared/ui/button";
import { EmptyState, Icon, PageHeader } from "@/shared/ui/page";
import { useT } from "@/shared/i18n";
import { FormMessage } from "@/shared/ui/panels";
import { messageForError } from "@/shared/api";
import { MiningSkeleton } from "@/shared/skeletons";
import { MiningBusyButton } from "@/features/mining/cycle/MiningBusyButton";
import { MiningReadyPanel } from "@/features/mining/cycle/MiningReadyPanel";
import { MiningActiveCycle } from "@/features/mining/cycle/MiningActiveCycle";
import { useMiningCycle } from "@/features/mining/cycle/useMiningCycle";

/** The Mining page: a 24-hour cycle at a server-assigned rate. */
export function MiningPage() {
  const t = useT("mining.page");
  const cycle = useMiningCycle();
  const {
    mining,
    refetch,
    session,
    busy,
    error,
    loading,
    isDeviceBlocked,
    poolRequired,
    needsCollection,
    actionsEnabled,
    start,
    collect,
  } = cycle;

  // A failed read is never "Ready to mine": the account may hold a running cycle, and a Start
  // pressed on a guessed state would be refused or misleading. The error names the failure and
  // offers the retry that re-renders this state.
  if (mining.isError && !mining.data) {
    return (
      <>
        <PageHeader title={t("title")} subtitle={t("shortDescription")} />
        <EmptyState
          title={t("loadError.title")}
          detail={messageForError(mining.error)}
          action={<Button onClick={() => void refetch()}>{t("loadError.retry")}</Button>}
        />
      </>
    );
  }

  // Mining switched off hides the actions but never an existing cycle: an accrued-but-unsettled
  // reward stays visible (read-only) until settlement is available again.
  if (mining.data && !mining.data.enabled && !mining.data.session) {
    return (
      <>
        <PageHeader title={t("title")} subtitle={t("shortDescription")} />
        <EmptyState
          title={t("disabled.title")}
          detail={t("disabled.detail")}
          action={
            <Link to="/mining/history">
              <Button variant="outline">{t("historyLink")}</Button>
            </Link>
          }
        />
      </>
    );
  }

  // Header action follows the same rules as the body: collect while anything is pending, start
  // the next cycle once the old one is done and the server allows it, nothing while paused.
  const headerAction =
    !actionsEnabled || !mining.data ? null : !session ? (
      poolRequired ? (
        <Link to="/mining/pools">
          <Button>
            <Icon icon={UserGroupIcon} size={17} />
            {t("actions.joinPool")}
          </Button>
        </Link>
      ) : (
        <MiningBusyButton
          label={t("actions.start")}
          icon={BitcoinCpuIcon}
          busy={busy === "start"}
          onAction={start}
          disabled={busy !== null || loading}
          busyLabel={t("actions.startBusy")}
        />
      )
    ) : session.status === "active" || needsCollection ? (
      <MiningBusyButton
        label={t("actions.collect")}
        icon={Coins01Icon}
        busy={busy === "settle"}
        onAction={collect}
        // `canSettle` is the server's capability flag: while settlement is paused the endpoint
        // refuses every request, so the action stays unavailable instead of calling it.
        disabled={busy !== null || !needsCollection || !session.canSettle}
        busyLabel={t("actions.collectBusy")}
      />
    ) : mining.data.canStart ? (
      <MiningBusyButton
        label={t("actions.startNext")}
        icon={BitcoinCpuIcon}
        busy={busy === "start"}
        onAction={start}
        disabled={busy !== null}
        busyLabel={t("actions.startBusy")}
      />
    ) : null;

  return (
    <>
      <PageHeader title={t("title")} subtitle={t("description")} action={headerAction} />

      {error && !isDeviceBlocked && (
        <div className="mb-4">
          <FormMessage tone="error">{error}</FormMessage>
        </div>
      )}

      {loading ? (
        <MiningSkeleton title={t("title")} />
      ) : !session ? (
        <MiningReadyPanel cycle={cycle} />
      ) : (
        <MiningActiveCycle cycle={cycle} />
      )}
      <p className="mt-4 text-sm">
        <Link to="/mining/history" className="font-semibold text-primary-soft">
          {t("historyLink")}
        </Link>{" "}
        <span className="text-muted-foreground">{t("historyNote")}</span>
      </p>
    </>
  );
}
