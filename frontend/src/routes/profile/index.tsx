import { createFileRoute } from "@tanstack/react-router";
import { WalletPage } from "@/app/shell";
import { ProfileContent } from "@/features/profile";
import { pageHead } from "@/shared/lib/platform";

export const Route = createFileRoute("/profile/")({
  head: ({ match }) => pageHead("profile.title", "profile.description", match.context.language),
  component: () => (
    <WalletPage titleKey="profile.title">
      <ProfileContent />
    </WalletPage>
  ),
});
