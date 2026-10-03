import { createFileRoute } from "@tanstack/react-router";
import { WalletPage } from "@/app/shell";
import { TransactionsPage } from "@/features/transactions";
import { pageHead } from "@/shared/lib/platform";

export const Route = createFileRoute("/transactions/")({
  head: ({ match }) =>
    pageHead("transactions.list.title", "transactions.list.description", match.context.language),
  component: () => (
    <WalletPage titleKey="transactions.list.title">
      <TransactionsPage />
    </WalletPage>
  ),
});
