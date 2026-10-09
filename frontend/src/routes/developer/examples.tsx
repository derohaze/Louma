import { createFileRoute } from "@tanstack/react-router";
import { WalletPage } from "@/app/shell";
import { DeveloperExamplesPage } from "@/features/developer/DeveloperExamplesPage";
import { pageHead } from "@/shared/lib/platform";
export const Route = createFileRoute("/developer/examples")({
  head: ({ match }) =>
    pageHead(
      "developer.examplesPage.title",
      "developer.examplesPage.description",
      match.context.language,
    ),
  component: () => (
    <WalletPage titleKey="developer.examplesPage.title">
      <DeveloperExamplesPage />
    </WalletPage>
  ),
});
