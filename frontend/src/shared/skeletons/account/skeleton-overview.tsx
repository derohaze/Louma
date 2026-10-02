import { Skeleton } from "@/shared/ui/skeleton";
import { HeaderSkeleton, Shell } from "@/shared/skeletons/shell";

/**
 * The overview skeleton mirrors the board the real page paints: the same two-column grid of rounded
 * cards, in the same surfaces, with the same number of rows per card. It is the shape the shell
 * shows while the account load runs, so the wait has to land on the same layout the page does rather
 * than on a different arrangement.
 */
export function OverviewSkeleton({ title }: { title: string }) {
  return (
    <Shell title={title}>
      <HeaderSkeleton />
      <div className="grid gap-4 lg:grid-cols-[1.04fr_1fr] lg:grid-rows-[auto_auto_auto]">
        {/* Statistics: the two totals and the bars */}
        <div className="order-2 rounded-[22px] border bg-card p-6 shadow-sm lg:order-none">
          <Skeleton className="h-6 w-28 rounded-full" />
          <div className="mt-8 flex gap-10">
            <div>
              <Skeleton className="h-3 w-20" />
              <Skeleton className="mt-2.5 h-6 w-24" />
            </div>
            <div>
              <Skeleton className="h-3 w-20" />
              <Skeleton className="mt-2.5 h-6 w-24" />
            </div>
          </div>
          <div className="mt-6 flex h-[116px] items-end gap-[9px]">
            {Array.from({ length: 10 }, (_, i) => (
              <Skeleton
                key={i}
                className="flex-1 rounded-[5px] bg-secondary"
                style={{ height: `${45 + ((i * 37) % 50)}%` }}
              />
            ))}
          </div>
        </div>
        {/* Activity: the count in the band, then the feed */}
        <div className="order-4 overflow-hidden rounded-[22px] border bg-card shadow-sm lg:order-none lg:row-span-2">
          <div className="bg-secondary p-5">
            <div className="flex justify-end">
              <Skeleton className="size-12 rounded-full bg-black/5 dark:bg-white/10" />
            </div>
            <div className="mt-6 flex items-end justify-between gap-3">
              <div>
                <Skeleton className="h-3.5 w-40 bg-black/10 dark:bg-white/10" />
                <Skeleton className="mt-3 h-8 w-12 bg-black/10 dark:bg-white/10" />
              </div>
              <Skeleton className="h-3.5 w-12 bg-black/10 dark:bg-white/10" />
            </div>
          </div>
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="flex items-center gap-3 border-b px-5 py-3.5 last:border-0">
              <Skeleton className="size-9 rounded-[12px] bg-secondary" />
              <div className="min-w-0 flex-1">
                <Skeleton className="h-3.5 w-2/3" />
                <Skeleton className="mt-2 h-3 w-1/3" />
              </div>
              <Skeleton className="h-3.5 w-14" />
            </div>
          ))}
        </div>
        {/* Balance card + live mining cycle */}
        <div className="contents gap-4 sm:grid sm:grid-cols-2">
          <div className="order-1 flex flex-col justify-between rounded-[22px] bg-foreground p-5 shadow-sm sm:order-none">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-3">
                <Skeleton className="size-12 rounded-full bg-background/20" />
                <Skeleton className="h-3 w-28 bg-background/30" />
              </div>
              <Skeleton className="h-5 w-9 rounded-full bg-background/20" />
            </div>
            <div className="mt-6 sm:mt-8">
              <Skeleton className="h-8 w-40 bg-background/30" />
              <Skeleton className="mt-2.5 h-3 w-32 bg-background/20" />
              <div className="mt-2 flex items-center gap-2">
                <Skeleton className="h-3 w-36 bg-background/20" />
                <Skeleton className="size-6 rounded-md bg-background/15" />
              </div>
            </div>
          </div>
          <div className="order-3 flex flex-col rounded-[22px] bg-primary p-5 shadow-sm sm:order-none">
            <Skeleton className="h-6 w-40 bg-primary-foreground/25" />
            <Skeleton className="mt-2 h-3 w-32 bg-primary-foreground/20" />
            <div className="mt-auto pt-6">
              <div className="flex items-baseline justify-between gap-2">
                <Skeleton className="h-3 w-24 bg-primary-foreground/20" />
                <Skeleton className="h-3 w-16 bg-primary-foreground/20" />
              </div>
              <Skeleton className="mt-2 h-2 w-full rounded-full bg-primary-foreground/20" />
            </div>
          </div>
        </div>
        {/* Counterparties and the two actions */}
        <div className="order-5 flex flex-wrap items-center justify-between gap-5 rounded-[22px] border bg-card p-5 shadow-sm lg:order-none">
          <div>
            <Skeleton className="h-3 w-28" />
            <div className="mt-3 flex gap-2">
              {Array.from({ length: 5 }, (_, i) => (
                <Skeleton key={i} className="size-10 rounded-full bg-secondary" />
              ))}
            </div>
          </div>
          <div className="flex shrink-0 flex-col gap-3">
            <Skeleton className="h-12 w-36 rounded-2xl bg-secondary" />
            <Skeleton className="h-12 w-36 rounded-2xl bg-primary" />
          </div>
        </div>
        {/* Mined total + account */}
        <div className="contents gap-4 sm:grid sm:grid-cols-2">
          <div className="order-6 flex flex-col justify-between rounded-[22px] border bg-card p-5 shadow-sm sm:order-none">
            <div className="flex justify-end">
              <Skeleton className="size-12 rounded-full bg-secondary" />
            </div>
            <div className="mt-8">
              <Skeleton className="h-3 w-28" />
              <Skeleton className="mt-2 h-7 w-28" />
              <Skeleton className="mt-2.5 h-3 w-24" />
            </div>
          </div>
          <div className="order-7 flex flex-col rounded-[22px] border bg-card p-5 shadow-sm sm:order-none">
            <Skeleton className="h-3 w-20" />
            <div className="mt-3 space-y-3">
              {Array.from({ length: 3 }, (_, i) => (
                <div key={i} className="flex items-center justify-between gap-2">
                  <Skeleton className="h-3 w-24" />
                  <Skeleton className="h-3 w-12" />
                </div>
              ))}
            </div>
            <Skeleton className="mt-auto h-3.5 w-32 pt-5" />
          </div>
        </div>
      </div>
    </Shell>
  );
}
