import { createFileRoute } from "@tanstack/react-router";
import { WalletPage } from "@/app/shell";
import { AccountContent } from "@/features/settings";
import { settingsPage } from "@/shared/lib/account";
import { pageHead } from "@/shared/lib/platform";

const page = settingsPage("/settings");

export const Route = createFileRoute("/settings/")({
  head: () => pageHead(page.title, page.description),
  component: () => (
    <WalletPage title={page.title}>
      <AccountContent />
    </WalletPage>
  ),
});
