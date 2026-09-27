import { createFileRoute } from "@tanstack/react-router";
import { WalletPage } from "@/components/wallet-shell";
import { LeaderboardContent } from "@/components/leaderboard-page";
export const Route = createFileRoute("/leaderboard")({
  head: () => ({
    meta: [
      { title: "Wallet Leaderboard" },
      {
        name: "description",
        content: "Compare wallet balances, transfers, and mining rewards on the Louma leaderboard.",
      },
      { property: "og:title", content: "Wallet Leaderboard" },
      {
        property: "og:description",
        content: "Compare wallet balances, transfers, and mining rewards on the Louma leaderboard.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: () => (
    <WalletPage title="Leaderboard">
      <LeaderboardContent />
    </WalletPage>
  ),
});
