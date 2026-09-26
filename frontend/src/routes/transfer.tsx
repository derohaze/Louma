import { createFileRoute } from "@tanstack/react-router";
import { WalletPage } from "@/components/wallet-shell";
import { TransferContent } from "@/components/wallet-pages";
export const Route = createFileRoute("/transfer")({
  head: () => ({
    meta: [
      { title: "Transfer WLT — Wallet" },
      { name: "description", content: "Send and receive WLT securely using wallet addresses." },
      { property: "og:title", content: "Transfer WLT — Wallet" },
      {
        property: "og:description",
        content: "Send and receive WLT securely using wallet addresses.",
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
