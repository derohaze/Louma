import { createFileRoute } from "@tanstack/react-router";
import { WalletPage } from "@/components/wallet-shell";
import { SettingsContent } from "@/components/wallet-pages";
export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Wallet Settings — WLT" },
      { name: "description", content: "Manage wallet security, privacy, and backup preferences." },
      { property: "og:title", content: "Wallet Settings — WLT" },
      {
        property: "og:description",
        content: "Manage wallet security, privacy, and backup preferences.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: () => (
    <WalletPage title="Settings">
      <SettingsContent />
    </WalletPage>
  ),
});
