import { createFileRoute } from "@tanstack/react-router";
import { WalletPage } from "@/components/wallet-shell";
import { RecipientsContent } from "@/components/wallet-pages";
export const Route = createFileRoute("/transfer/recipients")({
  head: () => ({
    meta: [
      { title: "Recipients" },
      {
        name: "description",
        content: "Saved and recent recipients for one-tap LMA transfers.",
      },
      { property: "og:title", content: "Recipients" },
      {
        property: "og:description",
        content: "Saved and recent recipients for one-tap LMA transfers.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: () => (
    <WalletPage title="Recipients">
      <RecipientsContent />
    </WalletPage>
  ),
});
