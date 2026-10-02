import { Skeleton } from "@/shared/ui/skeleton";
import { HeaderSkeleton, Shell } from "@/shared/skeletons/shell";

export function TransferSkeleton({ title }: { title: string }) {
  return (
    <Shell title={title}>
      <HeaderSkeleton action={false} />
      <Skeleton className="mb-5 h-11 w-48 rounded-full" />
      {/* The send flow asks one question at a time, so the placeholder is the stepper plus one field. */}
      <div className="mb-5 flex items-center gap-3">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="flex flex-1 items-center gap-2">
            <Skeleton className="size-7 rounded-full" />
            <Skeleton className="h-3 w-16" />
          </div>
        ))}
      </div>
      <div className="grid gap-4 xl:grid-cols-[1.5fr_1fr]">
        <div className="space-y-4 rounded-[22px] border bg-card p-5 shadow-sm">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-10 w-full rounded-xl" />
          <Skeleton className="h-3 w-3/4" />
          <Skeleton className="h-10 w-32 rounded-full" />
        </div>
        <div className="h-fit space-y-4">
          {Array.from({ length: 2 }, (_, i) => (
            <div key={i} className="rounded-[22px] border bg-card p-5 shadow-sm">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="mt-3 h-8 w-40" />
              <Skeleton className="mt-5 h-3 w-full" />
              <Skeleton className="mt-2 h-3 w-3/4" />
            </div>
          ))}
        </div>
      </div>
    </Shell>
  );
}
