import { createFileRoute } from "@tanstack/react-router";
import { WalletPage } from "@/app/shell";
import { OverviewContent } from "@/features/overview";
import { pageHead } from "@/shared/lib/platform";
export const Route = createFileRoute("/")({
  head: ({ match }) => pageHead("overview.title", "overview.description", match.context.language),
  component: () => (
    <WalletPage titleKey="overview.title">
      <OverviewContent />
    </WalletPage>
  ),
});
