import { createFileRoute } from "@tanstack/react-router";
import { WalletPage } from "@/components/wallet-shell";
import { AccountContent } from "@/components/settings-pages";
import { settingsPage } from "@/lib/settings-pages";
import { pageHead } from "@/lib/page-head";

const page = settingsPage("/settings");

export const Route = createFileRoute("/settings/")({
  head: () => pageHead(page.title, page.description),
  component: () => (
    <WalletPage title={page.title}>
      <AccountContent />
    </WalletPage>
  ),
});
