import { createFileRoute } from "@tanstack/react-router";
import { WalletPage } from "@/app/shell";
import { MiningPools } from "@/features/mining";
export const Route = createFileRoute("/mining/pools")({
  head: () => ({
    meta: [
      { title: "Mining Pools" },
      {
        name: "description",
        content: "Join one of the two system mining pools before starting a cycle.",
      },
      { property: "og:title", content: "Mining Pools" },
      {
        property: "og:description",
        content: "Join one of the two system mining pools before starting a cycle.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: () => (
    <WalletPage title="Mining Pools">
      <MiningPools />
    </WalletPage>
  ),
});
