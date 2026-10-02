import { Skeleton } from "@/shared/ui/skeleton";
import { HeaderSkeleton, Shell } from "@/shared/skeletons/shell";

export function ProfileSkeleton({ title }: { title: string }) {
  return (
    <Shell title={title}>
      <HeaderSkeleton />
      <div className="space-y-4">
        <div className="rounded-[22px] border bg-card p-5 shadow-sm">
          <div className="flex flex-wrap items-center gap-4">
            <Skeleton className="size-16 rounded-2xl" />
            <div className="min-w-0">
              <Skeleton className="h-6 w-44" />
              <Skeleton className="mt-2 h-4 w-64" />
            </div>
          </div>
          <div className="mt-5 grid max-w-xl gap-4 sm:grid-cols-2">
            <div>
              <Skeleton className="h-4 w-28" />
              <Skeleton className="mt-2 h-10 w-full rounded-xl" />
            </div>
            <div>
              <Skeleton className="h-4 w-28" />
              <Skeleton className="mt-2 h-10 w-full rounded-xl" />
            </div>
            <Skeleton className="h-10 w-32 rounded-full sm:col-span-2" />
          </div>
        </div>
        <div className="grid gap-4 xl:grid-cols-[1.2fr_1fr]">
          {Array.from({ length: 2 }, (_, i) => (
            <div key={i} className="rounded-[22px] border bg-card p-5 shadow-sm">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="mt-2 h-3 w-56" />
              <div className="mt-4 space-y-3">
                {Array.from({ length: 4 }, (_, j) => (
                  <div key={j} className="flex justify-between gap-4">
                    <Skeleton className="h-4 w-28" />
                    <Skeleton className="h-4 w-36" />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </Shell>
  );
}
