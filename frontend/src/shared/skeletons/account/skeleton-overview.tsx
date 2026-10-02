import { Skeleton } from "@/shared/ui/skeleton";
import { HeaderSkeleton, Shell } from "@/shared/skeletons/shell";

export function OverviewSkeleton({ title }: { title: string }) {
  return (
    <Shell title={title}>
      <HeaderSkeleton />
      {/* hero balance card */}
      <div className="rounded-[28px] border bg-card p-6 sm:p-8">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Skeleton className="h-6 w-36 rounded-full" />
              <Skeleton className="size-8 rounded-full" />
            </div>
            <Skeleton className="mt-3 h-12 w-64" />
            <Skeleton className="mt-2 h-4 w-48" />
            <Skeleton className="mt-4 h-10 w-full max-w-md rounded-xl" />
          </div>
          <Skeleton className="hidden size-36 rounded-full sm:block" />
        </div>
        <div className="mt-6 flex flex-wrap gap-2 border-t pt-5">
          <Skeleton className="h-10 w-28 rounded-full" />
          <Skeleton className="h-10 w-28 rounded-full" />
          <Skeleton className="h-10 w-32 rounded-full" />
        </div>
      </div>
      {/* 3 metric cards */}
      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="min-h-28 rounded-2xl border bg-card p-4 shadow-sm">
            <div className="flex items-center gap-2">
              <Skeleton className="size-5 rounded-md" />
              <Skeleton className="h-4 w-28" />
            </div>
            <Skeleton className="mt-5 h-8 w-32" />
            <Skeleton className="mt-2 h-3 w-40" />
          </div>
        ))}
      </div>
      {/* chart */}
      <div className="mt-4 rounded-[22px] border bg-card shadow-sm">
        <div className="border-b px-5 py-4">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="mt-2 h-3 w-24" />
        </div>
        <Skeleton className="m-5 h-64 rounded-2xl" />
      </div>
      {/* recent transactions */}
      <div className="mt-4 overflow-hidden rounded-[22px] border bg-card shadow-sm">
        <div className="flex items-center justify-between border-b px-5 py-4">
          <Skeleton className="h-5 w-44" />
          <Skeleton className="h-4 w-16" />
        </div>
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="flex items-center gap-3 border-b px-5 py-4 last:border-0">
            <Skeleton className="size-6 rounded-full" />
            <div className="min-w-0 flex-1">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="mt-2 h-3 w-1/3" />
            </div>
            <Skeleton className="h-4 w-20" />
          </div>
        ))}
      </div>
    </Shell>
  );
}
