import { Skeleton } from "@/shared/ui/skeleton";
import { HeaderSkeleton, Shell } from "@/shared/skeletons/shell";

export function AddressBookSkeleton({ title }: { title: string }) {
  return (
    <Shell title={title}>
      <HeaderSkeleton action={false} />
      <div className="rounded-[22px] border bg-card p-5 shadow-sm">
        <Skeleton className="h-5 w-36" />
        <Skeleton className="mt-2 h-3 w-64" />
        <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
          <Skeleton className="h-10 rounded-xl" />
          <Skeleton className="h-10 rounded-xl" />
          <Skeleton className="h-10 w-24 rounded-full" />
        </div>
        <div className="mt-4">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="flex items-center gap-3 border-b px-1 py-3 last:border-0">
              <Skeleton className="size-6 rounded-full" />
              <div className="min-w-0 flex-1">
                <Skeleton className="h-4 w-1/3" />
                <Skeleton className="mt-2 h-3 w-2/3" />
              </div>
              <Skeleton className="h-8 w-20 rounded-full" />
            </div>
          ))}
        </div>
      </div>
    </Shell>
  );
}

export function RecipientsSkeleton({ title }: { title: string }) {
  return (
    <Shell title={title}>
      <HeaderSkeleton action={false} />
      <div className="mb-4 flex gap-2 overflow-hidden">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-8 w-32 shrink-0 rounded-full" />
        ))}
      </div>
      <div className="rounded-[22px] border bg-card p-5 shadow-sm">
        <Skeleton className="h-5 w-40" />
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="flex items-center gap-3 border-b px-1 py-3 last:border-0">
            <Skeleton className="size-6 rounded-full" />
            <div className="min-w-0 flex-1">
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="mt-2 h-3 w-1/4" />
            </div>
            <Skeleton className="h-8 w-20 rounded-full" />
          </div>
        ))}
      </div>
    </Shell>
  );
}
