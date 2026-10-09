import { createFileRoute } from "@tanstack/react-router";
import { WalletPage } from "@/app/shell";
import { DeveloperPage } from "@/features/developer/DeveloperPage";
import { pageHead } from "@/shared/lib/platform";
export const Route = createFileRoute("/developer/")({
  head: ({ match }) => pageHead("developer.title", "developer.description", match.context.language),
  component: () => (
    <WalletPage titleKey="developer.title">
      <DeveloperPage />
    </WalletPage>
  ),
});
