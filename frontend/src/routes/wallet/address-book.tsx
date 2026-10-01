import { createFileRoute } from "@tanstack/react-router";
import { WalletPage } from "@/components/wallet-shell";
import { AddressBookContent } from "@/components/wallet-pages";
export const Route = createFileRoute("/wallet/address-book")({
  head: () => ({
    meta: [
      { title: "Address Book" },
      {
        name: "description",
        content: "Saved Louma addresses for one-tap transfers without retyping.",
      },
      { property: "og:title", content: "Address Book" },
      {
        property: "og:description",
        content: "Saved Louma addresses for one-tap transfers without retyping.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: () => (
    <WalletPage title="Address Book">
      <AddressBookContent />
    </WalletPage>
  ),
});
