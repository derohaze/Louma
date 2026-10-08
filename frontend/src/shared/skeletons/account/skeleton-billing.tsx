import { Skeleton } from "@/shared/ui/skeleton";
import { HeaderSkeleton, Shell } from "@/shared/skeletons/shell";

export function BillingSkeleton({ title }: { title: string }) {
  return (
    <Shell title={title}>
      <HeaderSkeleton action={false} />
      <div className="max-w-4xl space-y-5">
        <div className="rounded-[22px] border bg-card p-6 shadow-sm">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="mt-2 h-4 w-64 max-w-full" />
          <Skeleton className="mt-6 h-14 w-full rounded-xl" />
          <div className="mt-6 grid gap-5 sm:grid-cols-2">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-[22px] border bg-card p-6 shadow-sm">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="mt-6 h-24 w-full" />
          </div>
          <div className="rounded-[22px] border bg-card p-6 shadow-sm">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="mt-6 h-24 w-full" />
          </div>
        </div>
      </div>
    </Shell>
  );
}
