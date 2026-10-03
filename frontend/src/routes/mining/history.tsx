import { createFileRoute } from "@tanstack/react-router";
import { WalletPage } from "@/app/shell";
import { MiningHistorySection } from "@/features/mining";
import { pageHead } from "@/shared/lib/platform";
export const Route = createFileRoute("/mining/history")({
  head: () => pageHead("mining.history.title", "mining.history.description"),
  component: () => (
    <WalletPage titleKey="mining.history.title">
      <MiningHistorySection />
    </WalletPage>
  ),
});
