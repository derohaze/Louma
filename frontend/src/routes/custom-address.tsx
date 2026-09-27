import { createFileRoute } from "@tanstack/react-router";
import { WalletPage } from "@/components/wallet-shell";
import { CustomAddressContent } from "@/components/wallet-pages";
export const Route = createFileRoute("/custom-address")({
  head: () => ({
    meta: [
      { title: "Custom Wallet Address" },
      { name: "description", content: "Set a memorable custom LMA receiving address." },
      { property: "og:title", content: "Custom Wallet Address" },
      { property: "og:description", content: "Set a memorable custom LMA receiving address." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: () => (
    <WalletPage title="Custom Address">
      <CustomAddressContent />
    </WalletPage>
  ),
});
