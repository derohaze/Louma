import { createFileRoute } from "@tanstack/react-router";
import { WalletPage } from "@/app/shell";
import { MiningPage } from "@/features/mining";
import { pageHead } from "@/shared/lib/platform";
export const Route = createFileRoute("/mining/")({
  head: () => pageHead("mining.page.title", "mining.page.description"),
  component: () => (
    <WalletPage titleKey="mining.page.title">
      <MiningPage />
    </WalletPage>
  ),
});
