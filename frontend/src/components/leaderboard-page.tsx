import { useState } from "react";
import { Link } from "@tanstack/react-router";
import type { HugeiconsIcon } from "@hugeicons/react";
import {
  CpuIcon,
  EyeOffIcon,
  MedalFirstPlaceIcon,
  MedalSecondPlaceIcon,
  MedalThirdPlaceIcon,
  RankingIcon,
} from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useWallet } from "@/hooks/use-wallet";
import { readSettings } from "@/lib/demo-settings";
import {
  leaderboardSorts,
  rankLeaderboard,
  readLeaderboard,
  type LeaderboardEntry,
  type LeaderboardSort,
} from "@/lib/demo-leaderboard";
import { currency } from "@/lib/wallet-format";
import { cn } from "@/lib/utils";
import { EmptyState, Icon, PageHeader } from "./wallet-shell";
import { Panel, PreviewNote } from "./security-ui";

type IconData = Parameters<typeof HugeiconsIcon>[0]["icon"];

const medalIcons: IconData[] = [MedalFirstPlaceIcon, MedalSecondPlaceIcon, MedalThirdPlaceIcon];

const changeText = (change: number) => `${change > 0 ? "+" : ""}${change.toFixed(1)}%`;

/** The address cell of a ranking row, marked so the reader can find their own wallet. */
function AddressCell({ entry }: { entry: LeaderboardEntry }) {
  return (
    <p className="truncate text-sm font-semibold">
      {entry.address}
      {entry.isYou && <span className="ms-2 text-xs text-primary">You</span>}
    </p>
  );
}

/** Ranks read better as "1" than "01", so the medal replaces the number for the top three. */
function RankBadge({ rank }: { rank: number }) {
  const medal = medalIcons[rank - 1];
  if (medal) {
    return (
      <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-secondary text-[#9A6B12]">
        <Icon icon={medal} size={20} />
      </span>
    );
  }
  return (
    <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-secondary text-sm font-semibold text-muted-foreground">
      {rank}
    </span>
  );
}

/** Only shown for wallets that actually mine; the rest of the row carries the detail. */
function MinerBadge({ entry }: { entry: LeaderboardEntry }) {
  if (!entry.miner) return null;
  return (
    <span
      title="Mining rewards"
      className="grid size-6 shrink-0 place-items-center rounded-full border bg-secondary text-muted-foreground"
    >
      <Icon icon={CpuIcon} size={13} />
    </span>
  );
}

export function LeaderboardContent() {
  const { wallet } = useWallet();
  const [sort, setSort] = useState<LeaderboardSort>("balance");
  const [query, setQuery] = useState("");
  const [settings] = useState(readSettings);
  const ranked = rankLeaderboard(readLeaderboard(), sort);
  const you = ranked.find((entry) => entry.isYou);
  const hidden = settings.hideRanking;
  /** Hidden wallets are removed from every list, but keep the rank they were assigned. */
  const visible = ranked.filter((entry) => !hidden || !entry.isYou);
  const podium = visible.slice(0, 3);
  const rows = ranked.filter(
    (entry) =>
      (!hidden || !entry.isYou) && entry.address.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const metric = (entry: LeaderboardEntry) => {
    switch (sort) {
      case "balance":
        return currency(entry.balance);
      case "transactions":
        return `${entry.transactions}`;
      case "mining":
        return currency(entry.miningEarnings);
    }
  };
  return (
    <>
      <PageHeader
        title="Leaderboard"
        subtitle="Wallet rankings from demo data. The live leaderboard arrives with the backend."
      />
      <div className="grid gap-4 xl:grid-cols-[1fr_1.6fr]">
        <section className="rounded-[22px] border bg-card p-5 shadow-sm">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Icon icon={RankingIcon} size={18} className="text-muted-foreground" />
            Your position
          </div>
          {hidden || !you ? (
            <>
              <p className="mt-4 font-display text-2xl font-semibold">Hidden</p>
              <p className="mt-3 text-sm text-muted-foreground">
                Your wallet is excluded from the public ranking. Nobody sees your balance, and your
                position stays reserved.
              </p>
              <Link
                to="/settings/privacy"
                className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-primary"
              >
                <Icon icon={EyeOffIcon} size={16} />
                Change privacy settings
              </Link>
            </>
          ) : (
            <>
              <p className="mt-4 font-display text-3xl font-bold">
                #{you.rank}
                <span className="text-base font-medium text-muted-foreground">
                  {" "}
                  of {ranked.length}
                </span>
              </p>
              <dl className="mt-4 space-y-2 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-muted-foreground">Wallet</dt>
                  <dd className="min-w-0 truncate font-semibold">{you.address}</dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-muted-foreground">Ranked on</dt>
                  <dd className="font-semibold">
                    {leaderboardSorts.find((item) => item.id === sort)?.label}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-muted-foreground">Balance</dt>
                  <dd className="font-semibold">{currency(wallet?.balance ?? you.balance)}</dd>
                </div>
              </dl>
              <Link
                to="/settings/privacy"
                className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-primary"
              >
                <Icon icon={EyeOffIcon} size={16} />
                Hide my wallet
              </Link>
            </>
          )}
        </section>
        <Panel
          title="Top wallets"
          description="The three wallets leading the selected ranking."
          bodyClassName="p-0"
        >
          {podium.map((entry) => (
            <div
              key={entry.id}
              className="flex items-center gap-3 border-b px-5 py-4 last:border-0"
            >
              <RankBadge rank={entry.rank} />
              <div className="min-w-0 flex-1">
                <AddressCell entry={entry} />
                <p className="text-xs text-muted-foreground">
                  {entry.transactions} transfers · {changeText(entry.change)} in 7 days
                </p>
              </div>
              <MinerBadge entry={entry} />
              <strong className="shrink-0 text-sm">{metric(entry)}</strong>
            </div>
          ))}
        </Panel>
      </div>
      <section className="mt-4 overflow-hidden rounded-[22px] border bg-card shadow-sm">
        <div className="flex flex-wrap items-center gap-3 border-b px-5 py-4">
          <div className="min-w-0 flex-1">
            <h2 className="font-display font-semibold">Wallet rankings</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Ranked by {leaderboardSorts.find((item) => item.id === sort)?.label.toLowerCase()}.
            </p>
          </div>
          <Input
            aria-label="Search wallets"
            placeholder="Search a wallet"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="sm:max-w-56"
          />
          <div className="flex w-fit gap-1 rounded-full border bg-secondary/60 p-1">
            {leaderboardSorts.map((item) => (
              <Button
                key={item.id}
                variant="ghost"
                onClick={() => setSort(item.id)}
                className={cn(
                  "h-8 rounded-full px-4 text-xs font-semibold",
                  sort === item.id ? "bg-card text-foreground shadow-sm" : "text-muted-foreground",
                )}
              >
                {item.label}
              </Button>
            ))}
          </div>
        </div>
        {rows.length ? (
          rows.map((entry) => (
            <div
              key={entry.id}
              className={cn(
                "flex items-center gap-3 border-b px-5 py-4 last:border-0",
                entry.isYou && "bg-secondary/40",
              )}
            >
              <RankBadge rank={entry.rank} />
              <div className="min-w-0 flex-1">
                <AddressCell entry={entry} />
                <p className="text-xs text-muted-foreground">
                  {entry.transactions} transfers ·{" "}
                  {entry.miningEarnings > 0
                    ? `${currency(entry.miningEarnings)} mined`
                    : "No mining"}
                </p>
              </div>
              <span
                className={cn(
                  "hidden shrink-0 text-xs font-semibold sm:block",
                  entry.change >= 0 ? "text-success" : "text-destructive",
                )}
              >
                {changeText(entry.change)}
              </span>
              <MinerBadge entry={entry} />
              <strong className="w-28 shrink-0 text-end text-sm">{metric(entry)}</strong>
            </div>
          ))
        ) : (
          <EmptyState
            title="No wallets match"
            detail={
              hidden
                ? "Your wallet is hidden from the ranking. Change that in Privacy."
                : "Try a different address."
            }
            action={
              hidden ? (
                <Link to="/settings/privacy">
                  <Button variant="outline">Open privacy settings</Button>
                </Link>
              ) : (
                <Button variant="outline" onClick={() => setQuery("")}>
                  Clear search
                </Button>
              )
            }
          />
        )}
      </section>
      <div className="mt-4">
        <PreviewNote>
          Preview build: the other wallets are demo records. Your own row is read from the wallet
          store, so it matches the balance shown on the other pages.
        </PreviewNote>
      </div>
    </>
  );
}
