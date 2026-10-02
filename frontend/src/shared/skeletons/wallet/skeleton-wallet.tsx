import { Skeleton } from "@/shared/ui/skeleton";
import { HeaderSkeleton, Shell } from "@/shared/skeletons/shell";

/**
 * Mirrors the wallet dashboard: the address strip, the three top metric
 * cards (flow bars, growth, ring), and the breakdown + stacked totals below.
 */
export function WalletSkeleton({ title }: { title: string }) {
  return (
    <Shell title={title}>
      <HeaderSkeleton />
      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-[22px] border bg-card p-4 shadow-sm">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-4 min-w-0 flex-1" />
        <Skeleton className="h-4 w-16" />
        <Skeleton className="h-3 w-28" />
      </div>
      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-[1.35fr_1.1fr_1fr]">
        <div className="rounded-[22px] border bg-card p-5 shadow-sm lg:col-span-2 xl:col-span-1">
          <div className="flex items-start justify-between gap-3">
            <div>
              <Skeleton className="h-5 w-32" />
              <Skeleton className="mt-2 h-3 w-28" />
            </div>
            <Skeleton className="h-6 w-28" />
          </div>
          <Skeleton className="mt-4 h-4 w-48" />
          <Skeleton className="mt-3 h-[110px] w-full rounded-xl bg-secondary" />
        </div>
        <div className="rounded-[22px] border bg-card p-5 shadow-sm">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="mt-4 h-9 w-36" />
          <Skeleton className="mt-4 h-2.5 w-full rounded-full bg-secondary" />
          <Skeleton className="mt-5 h-3 w-3/4" />
        </div>
        <div className="flex flex-col items-center rounded-[22px] border bg-card p-5 shadow-sm">
          <Skeleton className="h-5 w-28" />
          <Skeleton className="mt-3 size-28 rounded-full bg-secondary" />
          <Skeleton className="mt-3 h-3 w-40" />
        </div>
      </div>
      <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_300px]">
        <div className="rounded-[22px] border bg-card p-5 shadow-sm">
          <Skeleton className="h-5 w-36" />
          <Skeleton className="mt-2 h-3 w-48" />
          <div className="mt-5 space-y-4">
            {Array.from({ length: 3 }, (_, i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="h-7 w-24 rounded-full bg-secondary" />
                <Skeleton className="h-3 min-w-0 flex-1" />
                <Skeleton className="h-3 w-11" />
              </div>
            ))}
          </div>
        </div>
        <div className="grid gap-4">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="rounded-[22px] border bg-card p-5 shadow-sm">
              <Skeleton className="h-8 w-24" />
              <Skeleton className="mt-2 h-3 w-32" />
            </div>
          ))}
        </div>
      </div>
    </Shell>
  );
}

export function CustomAddressSkeleton({ title }: { title: string }) {
  return (
    <Shell title={title}>
      <HeaderSkeleton action={false} />
      <div className="max-w-2xl rounded-[22px] border bg-card p-5 shadow-sm">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="mt-2 h-14 w-full rounded-xl" />
        <Skeleton className="mt-5 h-4 w-3/4" />
        <Skeleton className="mt-5 h-10 w-full rounded-xl" />
        <Skeleton className="mt-4 h-10 w-32 rounded-full" />
      </div>
    </Shell>
  );
}
