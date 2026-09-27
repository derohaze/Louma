import { createFileRoute } from "@tanstack/react-router";
import { WalletPage } from "@/components/wallet-shell";
import { RatingsSettingsContent } from "@/components/ratings-pages";
import { pageHead } from "@/lib/page-head";

export const Route = createFileRoute("/profile/ratings")({
  head: () =>
    pageHead("Ratings", "Choose the ratings you accept and what your public profile publishes."),
  component: () => (
    <WalletPage title="Ratings">
      <RatingsSettingsContent />
    </WalletPage>
  ),
});
