import { createFileRoute } from "@tanstack/react-router";
import { WalletPage } from "@/app/shell";
import { TransferPage } from "@/features/transfer";
import { pageHead } from "@/shared/lib/platform";
export const Route = createFileRoute("/transfer/")({
  head: ({ match }) =>
    pageHead("transfer.page.title", "transfer.page.description", match.context.language),
  component: () => (
    <WalletPage titleKey="transfer.page.title">
      <TransferPage />
    </WalletPage>
  ),
});
