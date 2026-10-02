import { Skeleton } from "@/shared/ui/skeleton";
import { HeaderSkeleton, Shell } from "@/shared/skeletons/shell";

export function SecurityCenterSkeleton({ title }: { title: string }) {
  return (
    <Shell title={title}>
      <HeaderSkeleton action={false} />
      <div className="grid gap-4 xl:grid-cols-[1fr_1.3fr]">
        <div className="rounded-[22px] border bg-card p-5 shadow-sm">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="mt-4 h-10 w-32" />
          <Skeleton className="mt-4 h-2 w-full rounded-full" />
          <Skeleton className="mt-3 h-3 w-full" />
        </div>
        <div className="rounded-[22px] border bg-card p-5 shadow-sm">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="mt-2 h-3 w-56" />
          <Skeleton className="mt-4 h-4 w-full" />
        </div>
      </div>
      {Array.from({ length: 2 }, (_, s) => (
        <div key={s} className="mt-4 overflow-hidden rounded-[22px] border bg-card shadow-sm">
          <div className="border-b px-5 py-4">
            <Skeleton className="h-5 w-36" />
            <Skeleton className="mt-2 h-3 w-64" />
          </div>
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="flex items-center gap-3 border-b px-5 py-4 last:border-0">
              <Skeleton className="size-10 rounded-xl" />
              <div className="min-w-0 flex-1">
                <Skeleton className="h-4 w-48" />
                <Skeleton className="mt-2 h-3 w-64" />
              </div>
              <Skeleton className="h-6 w-16 rounded-full" />
            </div>
          ))}
        </div>
      ))}
    </Shell>
  );
}

export function SecurityDetailSkeleton({ title }: { title: string }) {
  return (
    <Shell title={title}>
      <HeaderSkeleton action={false} />
      <div className="max-w-2xl space-y-4">
        <div className="rounded-[22px] border bg-card p-5 shadow-sm">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="mt-2 h-3 w-full" />
          <Skeleton className="mt-5 h-10 w-full rounded-xl" />
          <Skeleton className="mt-3 h-10 w-full rounded-xl" />
          <Skeleton className="mt-4 h-10 w-32 rounded-full" />
        </div>
        <div className="rounded-[22px] border bg-card p-5 shadow-sm">
          <Skeleton className="h-5 w-32" />
          <div className="mt-4 space-y-3">
            {Array.from({ length: 3 }, (_, i) => (
              <div key={i} className="flex justify-between gap-4">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-4 w-40" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </Shell>
  );
}
