import { Skeleton } from "@/shared/ui/skeleton";
import { HeaderSkeleton, Shell } from "@/shared/skeletons/shell";

export function SettingsSkeleton({ title }: { title: string }) {
  return (
    <Shell title={title}>
      <HeaderSkeleton action={false} />
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-4 rounded-[22px] border bg-card p-5 shadow-sm">
          <div>
            <Skeleton className="h-4 w-28" />
            <Skeleton className="mt-2 h-3 w-64" />
          </div>
          <Skeleton className="h-6 w-11 rounded-full" />
        </div>
        <div className="rounded-[22px] border bg-card p-5 shadow-sm">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="mt-2 h-3 w-56" />
          <div className="mt-4 space-y-3">
            {Array.from({ length: 5 }, (_, i) => (
              <div key={i} className="flex justify-between gap-4">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-4 w-48" />
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-[22px] border bg-card p-5 shadow-sm">
          <Skeleton className="h-5 w-44" />
          <Skeleton className="mt-2 h-3 w-full" />
          <Skeleton className="mt-4 h-10 w-36 rounded-full" />
        </div>
      </div>
    </Shell>
  );
}
