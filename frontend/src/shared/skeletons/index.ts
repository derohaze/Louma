/**
 * Per-page loading skeletons, one shape per page layout.
 *
 * The wallet shell gates every page on the same account load, so the skeleton shown during that
 * wait has to match the page behind it — otherwise the layout jumps when the data lands. Each
 * skeleton mirrors its page's real structure (same grids, same card rhythm, same rounded
 * corners), using the theme-aware `Skeleton` primitive so it reads in light and dark mode.
 *
 * How to add a new page (future-proofing):
 * 1. Export a `<YourPage>Skeleton` from a `skeleton-*` file in this folder that mirrors the new
 *    page's layout, and re-export it below.
 * 2. Add one entry to `skeletonsByPath` keyed by the route path.
 * That's it — the shell picks it automatically via `skeletonForPath()`, and unknown paths
 * fall back to `GenericPageSkeleton`, so a new page can never render without a skeleton.
 */
export { GenericPageSkeleton, HeaderSkeleton, Shell } from "./shell/skeleton-shell";
export { OverviewSkeleton } from "./account/skeleton-overview";
export { AnalyticsSkeleton } from "./analytics/skeleton-analytics";
export { MiningSkeleton } from "./mining/skeleton-mining";
export { TransferSkeleton } from "./transfer/skeleton-transfer";
export { WalletSkeleton } from "./wallet/skeleton-wallet";
export { HistorySkeleton } from "./transactions/skeleton-transactions";
export { MiningHistorySkeleton } from "./mining/skeleton-mining-history";
export { RecipientsSkeleton } from "./transfer/skeleton-recipients";
export { TransactionDetailSkeleton } from "./transactions/skeleton-transaction-detail";
export { CustomAddressSkeleton } from "./wallet/skeleton-custom-address";
export { NotificationsSkeleton } from "./notifications/skeleton-notifications";
export { ProfileSkeleton } from "./account/skeleton-profile";
export { SettingsSkeleton } from "./account/skeleton-settings";
export { SecurityCenterSkeleton, SecurityDetailSkeleton } from "./account/skeleton-security";

import { GenericPageSkeleton } from "./shell/skeleton-shell";
import { OverviewSkeleton } from "./account/skeleton-overview";
import { AnalyticsSkeleton } from "./analytics/skeleton-analytics";
import { MiningSkeleton } from "./mining/skeleton-mining";
import { TransferSkeleton } from "./transfer/skeleton-transfer";
import { WalletSkeleton } from "./wallet/skeleton-wallet";
import { HistorySkeleton } from "./transactions/skeleton-transactions";
import { MiningHistorySkeleton } from "./mining/skeleton-mining-history";
import { RecipientsSkeleton } from "./transfer/skeleton-recipients";
import { TransactionDetailSkeleton } from "./transactions/skeleton-transaction-detail";
import { CustomAddressSkeleton } from "./wallet/skeleton-custom-address";
import { NotificationsSkeleton } from "./notifications/skeleton-notifications";
import { ProfileSkeleton } from "./account/skeleton-profile";
import { SettingsSkeleton } from "./account/skeleton-settings";
import { SecurityCenterSkeleton, SecurityDetailSkeleton } from "./account/skeleton-security";

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
 * 1. Export a `<YourPage>Skeleton` in this folder that mirrors the new page's layout.
 * 2. Add its route path to `skeletonsByPath`.
 * 3. Run `bun run check:skeletons` — it verifies every dashboard route and nav entry resolves.
 */
const skeletonsByPath: Record<string, (props: { title: string }) => React.ReactNode> = {
  "/": OverviewSkeleton,
  "/analytics": AnalyticsSkeleton,
  "/wallet": WalletSkeleton,
  "/custom-address": CustomAddressSkeleton,
  "/transfer": TransferSkeleton,
  "/transfer/recipients": RecipientsSkeleton,
  "/mining": MiningSkeleton,
  "/mining/pools": MiningHistorySkeleton,
  "/mining/history": MiningHistorySkeleton,
  "/transactions": HistorySkeleton,
  "/notifications": NotificationsSkeleton,
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
  home: OverviewSkeleton,
  overview: OverviewSkeleton,
  analytics: AnalyticsSkeleton,
  mining: MiningSkeleton,
  "mining pools": MiningHistorySkeleton,
  "mining history": MiningHistorySkeleton,
  transfer: TransferSkeleton,
  recipients: RecipientsSkeleton,
  wallet: WalletSkeleton,
  notifications: NotificationsSkeleton,
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
        `Add it to skeletonsByPath in shared/skeletons — showing the generic fallback.`,
    );
  }
  return GenericPageSkeleton;
}
