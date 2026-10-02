import { Skeleton } from "@/shared/ui/skeleton";
import { HeaderSkeleton, Shell } from "@/shared/skeletons/shell";

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
