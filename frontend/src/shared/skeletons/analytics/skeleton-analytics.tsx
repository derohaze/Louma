import { Skeleton } from "@/shared/ui/skeleton";
import { HeaderSkeleton, Shell } from "@/shared/skeletons/shell";

/**
 * The analytics skeleton mirrors the real page: the chart card with its
 * range pills, the four total cards, and the two breakdown cards below.
 */
export function AnalyticsSkeleton({ title }: { title: string }) {
  return (
    <Shell title={title}>
      <HeaderSkeleton />
      <div className="grid gap-4">
        <div className="rounded-[22px] border bg-card p-6 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <Skeleton className="h-6 w-20 rounded-full" />
              <Skeleton className="mt-2 h-3 w-48" />
            </div>
            <Skeleton className="h-9 w-44 rounded-full bg-secondary" />
          </div>
          <Skeleton className="mt-6 h-[250px] w-full rounded-xl bg-secondary" />
          <div className="mt-2 flex justify-between">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-3 w-10" />
            ))}
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="rounded-[22px] border bg-card p-5 shadow-sm">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="mt-3 h-7 w-28" />
              <Skeleton className="mt-2.5 h-3 w-32" />
            </div>
          ))}
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="overflow-hidden rounded-[22px] border bg-card shadow-sm">
            <div className="p-5 pb-2">
              <Skeleton className="h-5 w-44" />
              <Skeleton className="mt-2 h-3 w-36" />
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
          <div className="rounded-[22px] border bg-card p-5 shadow-sm">
            <Skeleton className="h-5 w-52" />
            <Skeleton className="mt-2 h-3 w-64" />
            <Skeleton className="mt-6 h-2.5 w-full rounded-full bg-secondary" />
            <Skeleton className="mt-5 h-2.5 w-full rounded-full bg-secondary" />
          </div>
        </div>
      </div>
    </Shell>
  );
}
