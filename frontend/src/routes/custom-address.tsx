import { createFileRoute } from "@tanstack/react-router";
import { WalletPage } from "@/app/shell";
import { CustomAddressPage } from "@/features/wallet";
import { pageHead } from "@/shared/lib/platform";
export const Route = createFileRoute("/custom-address")({
  head: ({ match }) =>
    pageHead(
      "wallet.customAddress.title",
      "wallet.customAddress.description",
      match.context.language,
    ),
  component: () => (
    <WalletPage titleKey="wallet.customAddress.title">
      <CustomAddressPage />
    </WalletPage>
  ),
});
