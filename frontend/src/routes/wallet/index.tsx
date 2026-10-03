import { createFileRoute } from "@tanstack/react-router";
import { WalletPage } from "@/app/shell";
import { WalletContent } from "@/features/wallet";
import { pageHead } from "@/shared/lib/platform";
export const Route = createFileRoute("/wallet/")({
  head: () => pageHead("wallet.page.title", "wallet.page.description"),
  component: () => (
    <WalletPage titleKey="wallet.page.title">
      <WalletContent />
    </WalletPage>
  ),
});
