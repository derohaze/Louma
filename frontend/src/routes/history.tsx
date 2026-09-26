import { createFileRoute } from "@tanstack/react-router";
import { WalletPage } from "@/components/wallet-shell";
import { HistoryContent } from "@/components/wallet-pages";
export const Route = createFileRoute("/history")({
  head: () => ({
    meta: [
      { title: "Transaction History — WLT" },
      {
        name: "description",
        content: "Search, filter, and export your private WLT transaction history.",
      },
      { property: "og:title", content: "Transaction History — WLT" },
      {
        property: "og:description",
        content: "Search, filter, and export your private WLT transaction history.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: () => (
    <WalletPage title="History">
      <HistoryContent />
    </WalletPage>
  ),
});
