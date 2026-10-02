import { createFileRoute } from "@tanstack/react-router";
import { WalletPage } from "@/app/shell";
import { AnalyticsContent } from "@/features/analytics";
export const Route = createFileRoute("/analytics")({
  head: () => ({
    meta: [
      { title: "Analytics" },
      {
        name: "description",
        content: "Money in versus money out, top counterparties, and mining inside one window.",
      },
      { property: "og:title", content: "Analytics" },
      {
        property: "og:description",
        content: "Money in versus money out, top counterparties, and mining inside one window.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: () => (
    <WalletPage title="Analytics">
      <AnalyticsContent />
    </WalletPage>
  ),
});
