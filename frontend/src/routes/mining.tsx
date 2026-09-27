import { createFileRoute } from "@tanstack/react-router";
import { WalletPage } from "@/components/wallet-shell";
import { MiningContent } from "@/components/mining-page";
export const Route = createFileRoute("/mining")({
  head: () => ({
    meta: [
      { title: "Mining — WLT" },
      {
        name: "description",
        content: "Monitor your mining farm, hashrate, power draw, and mining rewards.",
      },
      { property: "og:title", content: "Mining — WLT" },
      {
        property: "og:description",
        content: "Monitor your mining farm, hashrate, power draw, and mining rewards.",
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
