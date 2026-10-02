import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BitcoinCpuIcon, UserGroupIcon } from "@hugeicons/core-free-icons";
import { Button } from "@/shared/ui/button";
import { useWallet } from "@/shared/hooks";
import { api, messageForError, type ApiMiningPoolsState } from "@/shared/api";
import {
  accountFetchers,
  hasBrowserSession,
  serverStateFreshness,
  serverStateKeys,
} from "@/shared/lib/platform";
import { cn } from "@/shared/lib/platform";
import { EmptyState, Icon, PageHeader } from "@/shared/ui/page";
import { MiningHistorySkeleton } from "@/shared/skeletons";
import { FactList, FormMessage, Panel } from "@/shared/ui/panels";

/**
 * Community mining rooms (MVP): the two system pools.
 *
 * Joining is mandatory before Start is accepted — the mining page reads the same
 * membership and refuses to offer Start while `poolId` is null. The reward math
 * itself stays on the server: each cycle draws the base rate, then one bounded
 * pool factor from the room's env-configured band, so pool choice adds variance,
 * never issuance. Every number on the cards (members, cap, speed, share) comes
 * from the same endpoint, so the page can never disagree with the gate.
 */
export function MiningPools() {
  const { refresh } = useWallet();
  const queryClient = useQueryClient();
  const pools = useQuery<ApiMiningPoolsState>({
    queryKey: serverStateKeys.miningPools,
    queryFn: accountFetchers.miningPools,
    staleTime: serverStateFreshness.miningMs,
    enabled: hasBrowserSession,
  });
  const [joining, setJoining] = useState<string | null>(null);
  const [error, setError] = useState("");

  const join = async (poolId: string) => {
    if (joining) return;
    setJoining(poolId);
    setError("");
    try {
      await api.post<ApiMiningPoolsState>("/api/v1/mining/pools/join", {
        poolId,
      });
      await queryClient.invalidateQueries({
        queryKey: serverStateKeys.miningPools,
      });
      await queryClient.invalidateQueries({ queryKey: serverStateKeys.mining });
      await refresh();
    } catch (cause) {
      setError(messageForError(cause));
    } finally {
      setJoining(null);
    }
  };

  if (pools.isError && !pools.data) {
    return (
      <>
        <PageHeader title="Mining Pools" subtitle="Join a pool to start mining." />
        <EmptyState
          title="Couldn't load mining pools"
          detail={messageForError(pools.error)}
          action={<Button onClick={() => void pools.refetch()}>Try again</Button>}
        />
      </>
    );
  }

  if (pools.isPending && !pools.data) {
    return <MiningHistorySkeleton title="Mining Pools" />;
  }

  const state = pools.data;
  const joinedPool = state?.pools.find((pool) => pool.joined) ?? null;

  return (
    <>
      <PageHeader
        title="Mining Pools"
        subtitle="Join a pool first — mining is only possible from inside one."
        action={
          joinedPool ? (
            <Link to="/mining">
              <Button>
                <Icon icon={BitcoinCpuIcon} size={17} />
                Go to mining
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
          You are mining in <strong>{joinedPool.name}</strong> · your speed{" "}
          {joinedPool.effectivePower.toFixed(2)} H ({joinedPool.mySharePercent.toFixed(1)}% of the
          room). Switch rooms anytime — the running cycle keeps the room it started in.
        </p>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {(state?.pools ?? []).map((pool) => {
          const fullness = Math.min(100, (pool.activeMiners / Math.max(pool.maxMembers, 1)) * 100);
          return (
            <section key={pool.id} className="rounded-[22px] border bg-card p-5 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <h2 className="flex items-center gap-2 font-display text-lg font-semibold">
                  <Icon icon={UserGroupIcon} size={20} className="text-primary-soft" />
                  {pool.name}
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
                  {pool.full ? "Full" : pool.riskLevel === "medium" ? "Higher variance" : "Steady"}
                </span>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">{pool.description}</p>

              <div
                role="progressbar"
                aria-label={`${pool.name} occupancy`}
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
                {pool.activeMiners} / {pool.maxMembers} miners
                {pool.joined &&
                  pool.activeMiners > 0 &&
                  ` · your share ${(100 / pool.activeMiners).toFixed(1)}%`}
              </p>

              <div className="mt-4 border-t pt-4">
                <FactList
                  items={[
                    ["Reward range", pool.rewardRangeText],
                    ["Room power", `${pool.baseHashrate} H`],
                    ["Your speed", `${pool.effectivePower.toFixed(2)} H`],
                    ["Cycle", "24 hours · tagged with this room"],
                  ]}
                />
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                Speed splits across members: {pool.baseHashrate} H ÷{" "}
                {Math.max(pool.activeMiners, 1)} miner
                {Math.max(pool.activeMiners, 1) === 1 ? "" : "s"}. Both rooms average the same
                reward over time.
              </p>

              <div className="mt-4">
                {pool.joined ? (
                  <Button variant="outline" disabled>
                    <Icon icon={UserGroupIcon} size={17} />
                    Current room
                  </Button>
                ) : pool.full ? (
                  <Button disabled>
                    <Icon icon={UserGroupIcon} size={17} />
                    Room full
                  </Button>
                ) : (
                  <Button onClick={() => void join(pool.id)} disabled={joining !== null}>
                    <Icon icon={UserGroupIcon} size={17} />
                    {joining === pool.id
                      ? "Joining…"
                      : joinedPool
                        ? `Switch to ${pool.name}`
                        : `Join ${pool.name}`}
                  </Button>
                )}
              </div>
            </section>
          );
        })}
      </div>

      <div className="mt-4">
        <Panel title="How rooms work" description="The rules both rooms share.">
          <FactList
            items={[
              ["Membership", "One room at a time — join or switch anytime"],
              ["Mining gate", "Start is refused until you join a room"],
              ["Cycle length", "Exactly 24 hours, tagged with its room"],
              ["Rewards", "Bounded random factor per cycle, same average in both rooms"],
            ]}
          />
        </Panel>
      </div>
    </>
  );
}
