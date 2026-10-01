import { createFileRoute } from "@tanstack/react-router";
import { WalletPage } from "@/components/wallet-shell";
import { WalletContent } from "@/components/wallet-pages";
export const Route = createFileRoute("/wallet")({
  head: () => ({
    meta: [
      { title: "My Wallet" },
      { name: "description", content: "View your LMA balance and primary receiving address." },
      { property: "og:title", content: "My Wallet" },
      {
        property: "og:description",
        content: "View your LMA balance and primary receiving address.",
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
