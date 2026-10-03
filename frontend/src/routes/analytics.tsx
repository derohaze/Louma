import { createFileRoute } from "@tanstack/react-router";
import { WalletPage } from "@/app/shell";
import { AnalyticsContent } from "@/features/analytics";
import { pageHead } from "@/shared/lib/platform";

export const Route = createFileRoute("/analytics")({
  head: () => pageHead("analytics.title", "analytics.description"),
  component: () => (
    <WalletPage titleKey="analytics.title">
      <AnalyticsContent />
    </WalletPage>
  ),
});
