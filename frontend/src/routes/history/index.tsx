import { createFileRoute } from "@tanstack/react-router";
import { WalletPage } from "@/components/wallet-shell";
import { HistoryContent } from "@/components/wallet-pages";

export const Route = createFileRoute("/history/")({
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
      <HistoryContent />
    </WalletPage>
  ),
});
