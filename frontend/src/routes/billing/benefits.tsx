import { createFileRoute } from "@tanstack/react-router";
import { WalletPage } from "@/app/shell";
import { BillingBenefitsPage } from "@/features/billing";
import { pageHead } from "@/shared/lib/platform";

export const Route = createFileRoute("/billing/benefits")({
  head: ({ match }) =>
    pageHead(
      "billing.benefitsPage.title",
      "billing.benefitsPage.description",
      match.context.language,
    ),
  component: () => (
    <WalletPage titleKey="billing.benefitsPage.title">
      <BillingBenefitsPage />
    </WalletPage>
  ),
});
