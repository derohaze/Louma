import { Skeleton } from "@/components/ui/skeleton";

/**
 * Per-page loading skeletons, one shape per page layout.
 *
 * The wallet shell gates every page on the same account load, so the skeleton shown during that
 * wait has to match the page behind it — otherwise the layout jumps when the data lands. Each
 * skeleton below mirrors its page's real structure (same grids, same card rhythm, same rounded
 * corners), using the theme-aware `Skeleton` primitive so it reads in light and dark mode.
 *
 * How to add a new page (future-proofing):
 * 1. Export a `<YourPage>Skeleton` from this file that mirrors the new page's layout.
 * 2. Add one entry to `skeletonsByTitle` keyed by the `title` passed to `<WalletPage>`.
 * That's it — the shell picks it automatically via `skeletonForTitle()`, and unknown titles
 * fall back to `GenericPageSkeleton`, so a new page can never render without a skeleton.
 */

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div aria-busy="true">
      <p role="status" className="sr-only">
        Loading {title}…
      </p>
      {children}
    </div>
  );
}

function HeaderSkeleton({ action = true }: { action?: boolean }) {
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

export function MiningSkeleton({ title }: { title: string }) {
  return (
    <Shell title={title}>
      <HeaderSkeleton />
      <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
        {/* session card: countdown + orb + earned */}
        <div className="rounded-[22px] border bg-card p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <Skeleton className="h-3 w-20" />
              <Skeleton className="mt-2 h-10 w-44" />
              <Skeleton className="mt-2 h-3 w-20" />
            </div>
            <Skeleton className="size-[120px] rounded-full" />
            <div className="text-end">
              <Skeleton className="ms-auto h-3 w-24" />
              <Skeleton className="mt-2 h-8 w-36" />
            </div>
          </div>
          <Skeleton className="mt-6 h-2.5 w-full rounded-full" />
          <div className="mt-2 flex justify-between">
            <Skeleton className="h-3 w-28" />
            <Skeleton className="h-3 w-20" />
          </div>
          <div className="mt-6 space-y-3 border-t pt-5">
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="flex justify-between gap-4">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-4 w-44" />
              </div>
            ))}
          </div>
          <Skeleton className="mt-5 h-10 w-40 rounded-full" />
        </div>
        {/* side column: rate card + activity/info */}
        <div className="grid gap-4">
          <div className="rounded-[22px] border bg-card p-5 shadow-sm">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="mt-3 h-7 w-40" />
            <Skeleton className="mt-3 h-3 w-full" />
          </div>
          <div className="rounded-[22px] border bg-card p-5 shadow-sm">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="mt-2 h-3 w-48" />
            <div className="mt-4 space-y-2.5">
              {Array.from({ length: 4 }, (_, i) => (
                <Skeleton key={i} className="h-3.5 w-full" />
              ))}
            </div>
          </div>
        </div>
      </div>
    </Shell>
  );
}

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

export function WalletSkeleton({ title }: { title: string }) {
  return (
    <Shell title={title}>
      <HeaderSkeleton />
      <div className="grid gap-4 sm:grid-cols-2">
        {Array.from({ length: 2 }, (_, i) => (
          <div key={i} className="rounded-[22px] border bg-card p-5 shadow-sm">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="mt-4 h-9 w-48" />
            <Skeleton className="mt-4 h-3 w-40" />
          </div>
        ))}
      </div>
      <div className="mt-4 rounded-[22px] border bg-card p-5 shadow-sm">
        <Skeleton className="h-5 w-32" />
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i}>
              <Skeleton className="h-3 w-28" />
              <Skeleton className="mt-2 h-4 w-48" />
            </div>
          ))}
        </div>
      </div>
    </Shell>
  );
}

export function HistorySkeleton({ title }: { title: string }) {
  return (
    <Shell title={title}>
      <HeaderSkeleton action={false} />
      <div className="mb-5 flex flex-col gap-3 sm:flex-row">
        <Skeleton className="h-10 w-full rounded-xl sm:max-w-xs" />
        <Skeleton className="h-10 w-52 rounded-full" />
      </div>
      <div className="mb-4 grid gap-4 sm:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="rounded-2xl border bg-card p-4 shadow-sm">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="mt-3 h-8 w-20" />
          </div>
        ))}
      </div>
      <div className="overflow-hidden rounded-[22px] border bg-card shadow-sm">
        <div className="border-b px-5 py-4">
          <Skeleton className="h-5 w-32" />
        </div>
        {Array.from({ length: 6 }, (_, i) => (
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

export function MiningHistorySkeleton({ title }: { title: string }) {
  return (
    <Shell title={title}>
      <HeaderSkeleton action={false} />
      <div className="grid gap-4 sm:grid-cols-3">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="rounded-2xl border bg-card p-4 shadow-sm">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="mt-3 h-8 w-28" />
          </div>
        ))}
      </div>
      <div className="mt-4 overflow-hidden rounded-[22px] border bg-card shadow-sm">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="flex items-center gap-3 border-b px-5 py-4 last:border-0">
            <Skeleton className="h-5 w-24 rounded-full" />
            <div className="min-w-0 flex-1">
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="mt-2 h-3 w-1/2" />
            </div>
            <Skeleton className="h-4 w-20" />
          </div>
        ))}
      </div>
    </Shell>
  );
}

export function TransactionDetailSkeleton({ title }: { title: string }) {
  return (
    <Shell title={title}>
      <HeaderSkeleton action={false} />
      <div className="rounded-[22px] border bg-card p-5 shadow-sm">
        <Skeleton className="h-5 w-40" />
        <div className="mt-5 space-y-3">
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="flex justify-between gap-4">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-4 w-48" />
            </div>
          ))}
        </div>
      </div>
    </Shell>
  );
}

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

/**
 * Registry: two keys, in priority order.
 *
 * 1. `skeletonsByPath` — exact route path (e.g. "/mining"). This is the primary key: the shell
 *    resolves by `location.pathname`, so renaming a page's `title` can never break its skeleton.
 * 2. `skeletonsByTitle` — fallback for callers that only know the title (kept for compatibility).
 *
 * Prefix rules below cover dynamic routes (`/transactions/<id>`) AND future sub-pages: a new page
 * under `/security/*` or `/settings/*` automatically inherits its section's skeleton shape with
 * no change needed. A brand-new top-level path that matches nothing falls back to
 * `GenericPageSkeleton` + a dev-time `console.warn`, so it is loud, never silent — and
 * `bun run check:skeletons` fails until the new path is registered here.
 *
 * Adding a page checklist:
 * 1. Export a `<YourPage>Skeleton` below that mirrors the new page's layout.
 * 2. Add its route path to `skeletonsByPath`.
 * 3. Run `bun run check:skeletons` — it verifies every dashboard route and nav entry resolves.
 */
const skeletonsByPath: Record<string, (props: { title: string }) => React.ReactNode> = {
  "/": OverviewSkeleton,
  "/wallet": WalletSkeleton,
  "/wallet/address-book": AddressBookSkeleton,
  "/custom-address": CustomAddressSkeleton,
  "/transfer": TransferSkeleton,
  "/transfer/recipients": RecipientsSkeleton,
  "/mining": MiningSkeleton,
  "/mining/history": MiningHistorySkeleton,
  "/transactions": HistorySkeleton,
  "/profile": ProfileSkeleton,
  "/security": SecurityCenterSkeleton,
  "/security/two-factor": SecurityDetailSkeleton,
  "/security/transfer-password": SecurityDetailSkeleton,
  "/security/freeze": SecurityDetailSkeleton,
  "/security/devices": SecurityDetailSkeleton,
  "/settings": SettingsSkeleton,
};

/** Section-level shapes inherited by dynamic routes and future sub-pages. */
const skeletonPrefixes: Array<{
  prefix: string;
  skeleton: (props: { title: string }) => React.ReactNode;
}> = [
  { prefix: "/transactions/", skeleton: TransactionDetailSkeleton },
  { prefix: "/security/", skeleton: SecurityDetailSkeleton },
  { prefix: "/settings/", skeleton: SettingsSkeleton },
  { prefix: "/profile/", skeleton: ProfileSkeleton },
];

const skeletonsByTitle: Record<string, (props: { title: string }) => React.ReactNode> = {
  overview: OverviewSkeleton,
  mining: MiningSkeleton,
  "mining history": MiningHistorySkeleton,
  transfer: TransferSkeleton,
  recipients: RecipientsSkeleton,
  wallet: WalletSkeleton,
  "address book": AddressBookSkeleton,
  transactions: HistorySkeleton,
  transaction: TransactionDetailSkeleton,
  "custom address": CustomAddressSkeleton,
  profile: ProfileSkeleton,
  "account management": SettingsSkeleton,
  settings: SettingsSkeleton,
  "security center": SecurityCenterSkeleton,
  "freeze wallet": SecurityDetailSkeleton,
  "devices & sessions": SecurityDetailSkeleton,
  "two-factor authentication": SecurityDetailSkeleton,
  "transfer password": SecurityDetailSkeleton,
};

export function skeletonForTitle(title: string): (props: { title: string }) => React.ReactNode {
  return skeletonsByTitle[title.trim().toLowerCase()] ?? GenericPageSkeleton;
}

/** Normalize `/profile/` → `/profile`, `/` stays `/`. */
function normalizePath(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith("/")) return pathname.slice(0, -1);
  return pathname || "/";
}

/**
 * Primary resolver used by the shell: exact path → longest section prefix → title → generic.
 * The generic fallback warns in dev so an unregistered page is impossible to miss, and
 * `bun run check:skeletons` turns that warning into a hard failure before it ships.
 */
export function skeletonForPath(
  pathname: string,
  title: string,
): (props: { title: string }) => React.ReactNode {
  const path = normalizePath(pathname);
  const exact = skeletonsByPath[path];
  if (exact) return exact;
  const prefixed = skeletonPrefixes
    .filter(({ prefix }) => path.startsWith(prefix))
    .sort((a, b) => b.prefix.length - a.prefix.length)[0];
  if (prefixed) return prefixed.skeleton;
  const byTitle = skeletonsByTitle[title.trim().toLowerCase()];
  if (byTitle) return byTitle;
  if (typeof process !== "undefined" && process.env?.["NODE_ENV"] !== "production") {
    console.warn(
      `[skeleton] No skeleton registered for path "${path}" (title "${title}"). ` +
        `Add it to skeletonsByPath in page-skeletons.tsx — showing the generic fallback.`,
    );
  }
  return GenericPageSkeleton;
}
