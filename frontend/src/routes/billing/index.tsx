import { createFileRoute } from "@tanstack/react-router";
import { WalletPage } from "@/app/shell";
import { BillingPage } from "@/features/billing";
import { pageHead } from "@/shared/lib/platform";

export const Route = createFileRoute("/billing/")({
  head: ({ match }) => pageHead("billing.title", "billing.description", match.context.language),
  component: () => (
    <WalletPage titleKey="billing.title">
      <BillingPage />
    </WalletPage>
  ),
});
