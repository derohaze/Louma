import { createFileRoute } from "@tanstack/react-router";
import { WalletPage } from "@/components/wallet-shell";
import { PrivacyContent } from "@/components/settings-pages";
import { settingsPage } from "@/lib/demo-settings";
import { pageHead } from "@/lib/page-head";

const page = settingsPage("/settings/privacy");

export const Route = createFileRoute("/settings/privacy")({
  head: () => pageHead(page.title, page.description),
  component: () => (
    <WalletPage title={page.title}>
      <PrivacyContent />
    </WalletPage>
  ),
});
