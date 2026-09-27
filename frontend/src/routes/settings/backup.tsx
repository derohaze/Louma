import { createFileRoute } from "@tanstack/react-router";
import { WalletPage } from "@/components/wallet-shell";
import { BackupContent } from "@/components/settings-pages";
import { settingsPage } from "@/lib/demo-settings";
import { pageHead } from "@/lib/page-head";

const page = settingsPage("/settings/backup");

export const Route = createFileRoute("/settings/backup")({
  head: () => pageHead(page.title, page.description),
  component: () => (
    <WalletPage title={page.title}>
      <BackupContent />
    </WalletPage>
  ),
});
