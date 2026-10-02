import { createFileRoute } from "@tanstack/react-router";
import { WalletPage } from "@/app/shell";
import { MiningHistorySection } from "@/features/mining";
export const Route = createFileRoute("/mining/history")({
  head: () => ({
    meta: [
      { title: "Mining History" },
      {
        name: "description",
        content: "Every past mining cycle with its rate, earnings, and collected rewards.",
      },
      { property: "og:title", content: "Mining History" },
      {
        property: "og:description",
        content: "Every past mining cycle with its rate, earnings, and collected rewards.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: () => (
    <WalletPage title="Mining History">
      <MiningHistorySection />
    </WalletPage>
  ),
});
