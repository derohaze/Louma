import { createFileRoute } from "@tanstack/react-router";
import { WalletPage } from "@/app/shell";
import { ProfileContent } from "@/features/profile";

export const Route = createFileRoute("/profile/")({
  head: () => ({
    meta: [
      { title: "Profile" },
      {
        name: "description",
        content: "Your wallet account details, activity summary, and protection status.",
      },
      { property: "og:title", content: "Profile" },
      {
        property: "og:description",
        content: "Your wallet account details, activity summary, and protection status.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: () => (
    <WalletPage title="Profile">
      <ProfileContent />
    </WalletPage>
  ),
});
