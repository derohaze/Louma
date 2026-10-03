import { createFileRoute } from "@tanstack/react-router";
import { WalletPage } from "@/app/shell";
import { RecipientsPage } from "@/features/transfer";
import { pageHead } from "@/shared/lib/platform";
export const Route = createFileRoute("/transfer/recipients")({
  head: ({ match }) =>
    pageHead(
      "transfer.recipients.title",
      "transfer.recipients.description",
      match.context.language,
    ),
  component: () => (
    <WalletPage titleKey="transfer.recipients.title">
      <RecipientsPage />
    </WalletPage>
  ),
});
