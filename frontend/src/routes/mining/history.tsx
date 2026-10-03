import { createFileRoute } from "@tanstack/react-router";
import { WalletPage } from "@/app/shell";
import { MiningHistorySection } from "@/features/mining";
import { pageHead } from "@/shared/lib/platform";
export const Route = createFileRoute("/mining/history")({
  head: ({ match }) =>
    pageHead("mining.history.title", "mining.history.description", match.context.language),
  component: () => (
    <WalletPage titleKey="mining.history.title">
      <MiningHistorySection />
    </WalletPage>
  ),
});
