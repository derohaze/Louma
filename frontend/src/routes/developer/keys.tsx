import { createFileRoute } from "@tanstack/react-router";
import { WalletPage } from "@/app/shell";
import { DeveloperKeysPage } from "@/features/developer/DeveloperKeysPage";
import { pageHead } from "@/shared/lib/platform";
export const Route = createFileRoute("/developer/keys")({
  head: ({ match }) =>
    pageHead("developer.keysPage.title", "developer.keysPage.description", match.context.language),
  component: () => (
    <WalletPage titleKey="developer.keysPage.title">
      <DeveloperKeysPage />
    </WalletPage>
  ),
});
