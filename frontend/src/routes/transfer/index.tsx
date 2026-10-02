import { createFileRoute } from "@tanstack/react-router";
import { WalletPage } from "@/app/shell";
import { TransferPage } from "@/features/transfer";
export const Route = createFileRoute("/transfer/")({
  head: () => ({
    meta: [
      { title: "Transfer LMA" },
      { name: "description", content: "Send and receive LMA securely using wallet addresses." },
      { property: "og:title", content: "Transfer LMA" },
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
      <TransferPage />
    </WalletPage>
  ),
});
