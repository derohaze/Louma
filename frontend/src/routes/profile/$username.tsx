import { createFileRoute } from "@tanstack/react-router";
import { WalletPage } from "@/components/wallet-shell";
import { PublicProfileContent } from "@/components/ratings-pages";
import { pageHead } from "@/lib/page-head";

export const Route = createFileRoute("/profile/$username")({
  head: () =>
    pageHead("Public Profile", "How another wallet appears to the wallets it trades with."),
  component: PublicProfileRoute,
});

/** Named component: the router renders it, and it reads the handle from the URL. */
function PublicProfileRoute() {
  const { username } = Route.useParams();
  return (
    <WalletPage title="Public Profile">
      <PublicProfileContent username={username} />
    </WalletPage>
  );
}
