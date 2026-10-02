import { Skeleton } from "@/shared/ui/skeleton";

export function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div aria-busy="true">
      <p role="status" className="sr-only">
        Loading {title}…
      </p>
      {children}
    </div>
  );
}

export function HeaderSkeleton({ action = true }: { action?: boolean }) {
  return (
    <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <Skeleton className="h-7 w-44" />
        <Skeleton className="mt-3 h-4 w-64" />
      </div>
      {action && <Skeleton className="h-10 w-36 rounded-full" />}
    </div>
  );
}

export function GenericPageSkeleton({ title }: { title: string }) {
  return (
    <Shell title={title}>
      <HeaderSkeleton />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-28 rounded-2xl" />
        ))}
      </div>
      <Skeleton className="mt-4 h-72 rounded-[22px]" />
    </Shell>
  );
}
