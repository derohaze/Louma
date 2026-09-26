import { createFileRoute } from "@tanstack/react-router";
import { WalletPage } from "@/components/wallet-shell";
import { WalletContent } from "@/components/wallet-pages";
export const Route = createFileRoute("/wallet")({
  head: () => ({
    meta: [
      { title: "My Wallet — WLT" },
      { name: "description", content: "View your WLT balance and primary receiving address." },
      { property: "og:title", content: "My Wallet — WLT" },
      {
        property: "og:description",
        content: "View your WLT balance and primary receiving address.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: () => (
    <WalletPage title="Wallet">
      <WalletContent />
    </WalletPage>
  ),
});
