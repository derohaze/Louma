import { Skeleton } from "@/shared/ui/skeleton";
import { HeaderSkeleton, Shell } from "@/shared/skeletons/shell";

export function NotificationsSkeleton({ title }: { title: string }) {
  return (
    <Shell title={title}>
      <HeaderSkeleton />
      <div className="overflow-hidden rounded-[22px] border bg-card shadow-sm">
        <div className="flex items-center justify-between gap-3 border-b px-5 py-4">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-6 w-20 rounded-full" />
        </div>
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="flex items-start gap-3 border-b px-5 py-4 last:border-0">
            <Skeleton className="size-11 shrink-0 rounded-xl" />
            <div className="min-w-0 flex-1">
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="mt-2 h-3 w-3/4" />
              <Skeleton className="mt-2 h-3 w-24" />
            </div>
          </div>
        ))}
      </div>
    </Shell>
  );
}
