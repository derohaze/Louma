import { createFileRoute } from "@tanstack/react-router";
import { WalletPage } from "@/app/shell";
import { MiningPools } from "@/features/mining";
import { pageHead } from "@/shared/lib/platform";
export const Route = createFileRoute("/mining/pools")({
  head: ({ match }) =>
    pageHead("mining.pools.title", "mining.pools.description", match.context.language),
  component: () => (
    <WalletPage titleKey="mining.pools.title">
      <MiningPools />
    </WalletPage>
  ),
});
