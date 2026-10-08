import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Logout01Icon, PickaxeIcon, UserGroupIcon } from "@hugeicons/core-free-icons";
import { Button } from "@/shared/ui/button";
import { useWallet } from "@/shared/hooks";
import { ApiError, api, messageForError, type ApiMiningPoolsState } from "@/shared/api";
import {
  accountFetchers,
  hasBrowserSession,
  serverStateFreshness,
  serverStateKeys,
} from "@/shared/lib/platform";
import { cn } from "@/shared/lib/platform";
import { EmptyState, Icon, PageHeader } from "@/shared/ui/page";
import { translate, useT } from "@/shared/i18n";
import { MiningHistorySkeleton } from "@/shared/skeletons";
import { FactList, FormMessage, Panel } from "@/shared/ui/panels";

/**
 * Community mining rooms (MVP): the two system pools.
 *
 * A room is a HOLD, not a permanent membership: it is taken before a start, extended to the end of
 * the cycle it started, and released the moment that cycle ends — by a stop, or by the window
 * itself. The mining page reads the same live hold and refuses to offer Start while it is absent,
 * so "you are mining here" and "this room is yours" can never drift apart. Leaving is refused (and
 * the button hidden) while a cycle runs, and changing rooms is limited to once per cooldown; taking
 * the room already held, or the one just left, is always available. The reward math itself stays on
 * the server: each cycle draws the base rate, then one bounded pool factor from the room's
 * env-configured band, so pool choice adds variance, never issuance. Every number on the cards
 * (members, cap, speed, share) comes from the same endpoint, so the page can never disagree with
 * the gate.
 */
/**
 * The two system rooms are named and described by the server, but their copy is part of the screen:
 * a translated dashboard names them in its own language. An unknown pool id — a room added later —
 * keeps whatever the server sent rather than showing a blank card.
 */
const poolName = (id: string, fallback: string): string =>
  id === "low" || id === "medium" ? translate(`mining.pools.names.${id}`) : fallback;

const poolDescription = (id: string, fallback: string): string =>
  id === "low" || id === "medium" ? translate(`mining.pools.descriptions.${id}`) : fallback;

/** Whole minutes until a server instant, at least one: the room-change cooldown, said plainly. */
const minutesUntil = (iso: string): number =>
  Math.max(1, Math.ceil((new Date(iso).getTime() - Date.now()) / 60_000));

export function MiningPools() {
  const t = useT("mining.pools");
  const { refresh } = useWallet();
  const queryClient = useQueryClient();
  const pools = useQuery<ApiMiningPoolsState>({
    queryKey: serverStateKeys.miningPools,
    queryFn: accountFetchers.miningPools,
    staleTime: serverStateFreshness.miningMs,
    enabled: hasBrowserSession,
  });
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState("");

  /**
   * Both room writes go through here: the server decides whether the change is allowed (a running
   * cycle owns its room, and changes are throttled), and the mining state is re-read afterwards
   * because the pool gate lives on it.
   */
  const changeRoom = async (action: string, request: () => Promise<unknown>) => {
    if (pending) return;
    setPending(action);
    setError("");
    try {
      await request();
      await queryClient.invalidateQueries({
        queryKey: serverStateKeys.miningPools,
      });
      await queryClient.invalidateQueries({ queryKey: serverStateKeys.mining });
      await refresh();
    } catch (cause) {
      // The two rules a customer can hit here are named in their own language; anything else is
      // reported in the server's words, which are the authoritative ones anyway.
      if (cause instanceof ApiError && cause.code === "mining_pool_switch_cooldown")
        setError(t("errors.switchCooldown"));
      else if (cause instanceof ApiError && cause.code === "mining_cycle_active")
        setError(t("errors.cycleActive"));
      else setError(messageForError(cause));
    } finally {
      setPending(null);
    }
  };

  const join = (poolId: string) =>
    changeRoom(poolId, () =>
      api.post<ApiMiningPoolsState>("/api/v1/mining/pools/join", { poolId }),
    );

  const leave = () =>
    changeRoom("leave", () => api.post<ApiMiningPoolsState>("/api/v1/mining/pools/leave"));

  if (pools.isError && !pools.data) {
    return (
      <>
        <PageHeader title={t("title")} subtitle={t("shortDescription")} />
        <EmptyState
          title={t("loadError")}
          detail={messageForError(pools.error)}
          action={<Button onClick={() => void pools.refetch()}>{t("retry")}</Button>}
        />
      </>
    );
  }

  if (pools.isPending && !pools.data) {
    return <MiningHistorySkeleton title={t("title")} />;
  }

  const state = pools.data;
  const joinedPool = state?.pools.find((pool) => pool.joined) ?? null;
  const cycleActive = state?.cycleActive === true;
  const switchingIn = state?.switchAvailableAt ? minutesUntil(state.switchAvailableAt) : null;

  return (
    <>
      <PageHeader
        title={t("title")}
        subtitle={t("description")}
        action={
          joinedPool ? (
            <Link to="/mining">
              <Button>
                <Icon icon={PickaxeIcon} size={17} />
                {t("goToMining")}
              </Button>
            </Link>
          ) : undefined
        }
      />

      {error && (
        <div className="mb-4">
          <FormMessage tone="error">{error}</FormMessage>
        </div>
      )}

      {joinedPool && (
        <p className="mb-4 rounded-xl border border-success/30 bg-success/10 px-4 py-3 text-sm">
          {cycleActive
            ? t("joinedMining", {
                pool: poolName(joinedPool.id, joinedPool.name),
                power: joinedPool.effectivePower.toFixed(2),
                share: joinedPool.mySharePercent.toFixed(1),
              })
            : t("joinedReady", { pool: poolName(joinedPool.id, joinedPool.name) })}
        </p>
      )}

      {!joinedPool && switchingIn !== null && (
        <p className="mb-4 rounded-xl border bg-card px-4 py-3 text-sm text-muted-foreground">
          {t("switchWait", { minutes: switchingIn })}
        </p>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {(state?.pools ?? []).map((pool, index) => {
          const fullness = Math.min(100, (pool.activeMiners / Math.max(pool.maxMembers, 1)) * 100);
          return (
            <section
              key={pool.id}
              style={{ animationDelay: `${Math.min(index * 75, 300)}ms` }}
              className="card-enter rounded-[22px] border bg-card p-5 shadow-sm"
            >
              <div className="flex items-center justify-between gap-3">
                <h2 className="flex items-center gap-2 font-display text-lg font-semibold">
                  <Icon icon={UserGroupIcon} size={20} className="text-primary-soft" />
                  {poolName(pool.id, pool.name)}
                </h2>
                <span
                  className={cn(
                    "rounded-full px-2.5 py-0.5 text-[11px] font-semibold",
                    pool.full
                      ? "bg-destructive/10 text-destructive"
                      : pool.riskLevel === "medium"
                        ? "bg-warning/15 text-amber-600 dark:text-amber-400"
                        : "bg-success/10 text-success",
                  )}
                >
                  {pool.full
                    ? t("badges.full")
                    : pool.riskLevel === "medium"
                      ? t("badges.variance")
                      : t("badges.steady")}
                </span>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                {poolDescription(pool.id, pool.description)}
              </p>

              <div
                role="progressbar"
                aria-label={t("occupancyAria", { pool: poolName(pool.id, pool.name) })}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(fullness)}
                className="mt-4 h-2 w-full overflow-hidden rounded-full bg-secondary"
              >
                <div
                  className="h-full rounded-full bg-primary transition-[width] duration-500"
                  style={{ width: `${fullness}%` }}
                />
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                {t("miners", { active: pool.activeMiners, max: pool.maxMembers })}
                {pool.joined &&
                  pool.activeMiners > 0 &&
                  t("yourShare", { share: (100 / pool.activeMiners).toFixed(1) })}
              </p>

              <div className="mt-4 border-t pt-4">
                <FactList
                  items={[
                    [t("facts.rewardRange"), pool.rewardRangeText],
                    [t("facts.roomPower"), `${pool.baseHashrate} H`],
                    [t("facts.yourSpeed"), `${pool.effectivePower.toFixed(2)} H`],
                    [t("facts.cycle"), t("facts.cycleValue")],
                  ]}
                />
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                {t("split", {
                  power: pool.baseHashrate,
                  miners: Math.max(pool.activeMiners, 1),
                  unit:
                    Math.max(pool.activeMiners, 1) === 1
                      ? t("units.minerOne")
                      : t("units.minerOther"),
                })}
              </p>

              <div className="mt-4">
                {pool.joined ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <Button variant="outline" disabled>
                      <Icon icon={UserGroupIcon} size={17} />
                      {t("actions.currentRoom")}
                    </Button>
                    {/* While a cycle runs the room is held for it: the server refuses a leave, so
                        the action is not offered. Stopping releases the room instead. */}
                    {!cycleActive && (
                      <Button
                        variant="outline"
                        onClick={() => void leave()}
                        disabled={pending !== null}
                      >
                        <Icon icon={Logout01Icon} size={17} />
                        {pending === "leave" ? t("actions.leaving") : t("actions.leave")}
                      </Button>
                    )}
                  </div>
                ) : pool.full ? (
                  <Button disabled>
                    <Icon icon={UserGroupIcon} size={17} />
                    {t("actions.roomFull")}
                  </Button>
                ) : (
                  <Button onClick={() => void join(pool.id)} disabled={pending !== null}>
                    <Icon icon={UserGroupIcon} size={17} />
                    {pending === pool.id
                      ? t("actions.joining")
                      : joinedPool
                        ? t("actions.switchTo", { pool: poolName(pool.id, pool.name) })
                        : t("actions.join", { pool: poolName(pool.id, pool.name) })}
                  </Button>
                )}
              </div>
            </section>
          );
        })}
      </div>

      <div className="mt-4">
        <Panel title={t("how.title")} description={t("how.description")}>
          <FactList
            items={[
              [t("how.membership"), t("how.membershipValue")],
              [t("how.gate"), t("how.gateValue")],
              [t("how.release"), t("how.releaseValue")],
              [t("how.changes"), t("how.changesValue")],
              [t("how.cycleLength"), t("how.cycleLengthValue")],
              [t("how.rewards"), t("how.rewardsValue")],
            ]}
          />
        </Panel>
      </div>
    </>
  );
}
