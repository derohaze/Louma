import { createFileRoute } from "@tanstack/react-router";
import { WalletPage } from "@/app/shell";
import { TransactionsPage } from "@/features/transactions";

export const Route = createFileRoute("/transactions/")({
  head: () => ({
    meta: [
      { title: "Transactions" },
      {
        name: "description",
        content: "Search, filter, and export your private LMA transactions.",
      },
      { property: "og:title", content: "Transactions" },
      {
        property: "og:description",
        content: "Search, filter, and export your private LMA transactions.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: () => (
    <WalletPage title="Transactions">
      <TransactionsPage />
    </WalletPage>
  ),
});
