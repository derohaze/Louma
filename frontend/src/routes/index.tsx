import { createFileRoute } from "@tanstack/react-router";
import { WalletPage } from "@/components/wallet-shell";
import { OverviewContent } from "@/components/wallet-overview";
export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Wallet Overview — WLT" },
      {
        name: "description",
        content: "Review your WLT wallet balance, addresses, security, and transaction activity.",
      },
      { property: "og:title", content: "Wallet Overview — WLT" },
      {
        property: "og:description",
        content: "Review your WLT wallet balance, addresses, security, and transaction activity.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: () => (
    <WalletPage title="Overview">
      <OverviewContent />
    </WalletPage>
  ),
});
