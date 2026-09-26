import { createFileRoute } from "@tanstack/react-router";
import { WalletPage } from "@/components/wallet-shell";
import { LeaderboardContent } from "@/components/wallet-pages";
export const Route = createFileRoute("/leaderboard")({
  head: () => ({
    meta: [
      { title: "Wallet Leaderboard — WLT" },
      { name: "description", content: "View opt-in WLT wallet balance and activity rankings." },
      { property: "og:title", content: "Wallet Leaderboard — WLT" },
      {
        property: "og:description",
        content: "View opt-in WLT wallet balance and activity rankings.",
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
