import { createFileRoute } from "@tanstack/react-router";
import { WalletPage } from "@/app/shell";
import { OverviewContent } from "@/features/overview";
import { pageHead } from "@/shared/lib/platform";
export const Route = createFileRoute("/")({
  head: () => pageHead("overview.title", "overview.description"),
  component: () => (
    <WalletPage titleKey="overview.title">
      <OverviewContent />
    </WalletPage>
  ),
});
