import { createFileRoute } from "@tanstack/react-router";
import { WalletPage } from "@/app/shell";
import { DeveloperTestPage } from "@/features/developer/DeveloperTestPage";
import { pageHead } from "@/shared/lib/platform";
export const Route = createFileRoute("/developer/test")({
  head: ({ match }) =>
    pageHead("developer.testPage.title", "developer.testPage.description", match.context.language),
  component: () => (
    <WalletPage titleKey="developer.testPage.title">
      <DeveloperTestPage />
    </WalletPage>
  ),
});
