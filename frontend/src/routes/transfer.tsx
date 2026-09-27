import { createFileRoute } from "@tanstack/react-router";
import { WalletPage } from "@/components/wallet-shell";
import { TransferContent } from "@/components/wallet-pages";
export const Route = createFileRoute("/transfer")({
  head: () => ({
    meta: [
      { title: "Transfer LMA — Louma" },
      { name: "description", content: "Send and receive LMA securely using wallet addresses." },
      { property: "og:title", content: "Transfer LMA — Louma" },
      {
        property: "og:description",
        content: "Send and receive LMA securely using wallet addresses.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: () => (
    <WalletPage title="Transfer">
      <TransferContent />
    </WalletPage>
  ),
});
