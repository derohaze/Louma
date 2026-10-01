import { createFileRoute } from "@tanstack/react-router";
import { WalletPage } from "@/components/wallet-shell";
import { MiningContent } from "@/components/mining-page";
export const Route = createFileRoute("/mining/")({
  head: () => ({
    meta: [
      { title: "Mining" },
      {
        name: "description",
        content: "Mine LMA in a 24-hour cycle at a rate assigned to your account by the server.",
      },
      { property: "og:title", content: "Mining" },
      {
        property: "og:description",
        content: "Mine LMA in a 24-hour cycle at a rate assigned to your account by the server.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: () => (
    <WalletPage title="Mining">
      <MiningContent />
    </WalletPage>
  ),
});
