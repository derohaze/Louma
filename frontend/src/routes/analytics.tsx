import { createFileRoute } from "@tanstack/react-router";
import { WalletPage } from "@/app/shell";
import { AnalyticsContent } from "@/features/analytics";
import { pageHead } from "@/shared/lib/platform";

export const Route = createFileRoute("/analytics")({
  head: ({ match }) => pageHead("analytics.title", "analytics.description", match.context.language),
  component: () => (
    <WalletPage titleKey="analytics.title">
      <AnalyticsContent />
    </WalletPage>
  ),
});
