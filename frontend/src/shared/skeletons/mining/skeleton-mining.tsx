import { Skeleton } from "@/shared/ui/skeleton";
import { HeaderSkeleton, Shell } from "@/shared/skeletons/shell";

export function MiningSkeleton({ title }: { title: string }) {
  return (
    <Shell title={title}>
      <HeaderSkeleton />
      <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
        {/* session card: countdown + orb + earned */}
        <div className="rounded-[22px] border bg-card p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <Skeleton className="h-3 w-20" />
              <Skeleton className="mt-2 h-10 w-44" />
              <Skeleton className="mt-2 h-3 w-20" />
            </div>
            <Skeleton className="size-[120px] rounded-full" />
            <div className="text-end">
              <Skeleton className="ms-auto h-3 w-24" />
              <Skeleton className="mt-2 h-8 w-36" />
            </div>
          </div>
          <Skeleton className="mt-6 h-2.5 w-full rounded-full" />
          <div className="mt-2 flex justify-between">
            <Skeleton className="h-3 w-28" />
            <Skeleton className="h-3 w-20" />
          </div>
          <div className="mt-6 space-y-3 border-t pt-5">
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="flex justify-between gap-4">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-4 w-44" />
              </div>
            ))}
          </div>
          <Skeleton className="mt-5 h-10 w-40 rounded-full" />
        </div>
        {/* side column: rate card + activity/info */}
        <div className="grid gap-4">
          <div className="rounded-[22px] border bg-card p-5 shadow-sm">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="mt-3 h-7 w-40" />
            <Skeleton className="mt-3 h-3 w-full" />
          </div>
          <div className="rounded-[22px] border bg-card p-5 shadow-sm">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="mt-2 h-3 w-48" />
            <div className="mt-4 space-y-2.5">
              {Array.from({ length: 4 }, (_, i) => (
                <Skeleton key={i} className="h-3.5 w-full" />
              ))}
            </div>
          </div>
        </div>
      </div>
    </Shell>
  );
}
