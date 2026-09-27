import { createFileRoute } from "@tanstack/react-router";
import { WalletPage } from "@/components/wallet-shell";
import { SecurityContent } from "@/components/wallet-pages";
export const Route = createFileRoute("/security")({
  head: () => ({
    meta: [
      { title: "Security — WLT" },
      {
        name: "description",
        content: "Review sign-in safety and confirm your wallet backup.",
      },
      { property: "og:title", content: "Security — WLT" },
      {
        property: "og:description",
        content: "Review sign-in safety and confirm your wallet backup.",
      },
      { property: "og:type", content: "website" },
      { property: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: () => (
    <WalletPage title="Security">
      <SecurityContent />
    </WalletPage>
  ),
});
