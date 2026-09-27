import { createFileRoute } from "@tanstack/react-router";
import { WalletPage } from "@/components/wallet-shell";
import { OverviewContent } from "@/components/wallet-overview";
export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Overview — Louma" },
      {
        name: "description",
        content: "Balance and activity at a glance, with a link into every LMA wallet section.",
      },
      { property: "og:title", content: "Overview — Louma" },
      {
        property: "og:description",
        content: "Balance and activity at a glance, with a link into every LMA wallet section.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: () => (
    <WalletPage title="Overview">
      <OverviewContent />
    </WalletPage>
  ),
});
