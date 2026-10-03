import { createFileRoute } from "@tanstack/react-router";
import { WalletPage } from "@/app/shell";
import { TwoFactorPage } from "@/features/security";
import { securityFeature } from "@/shared/lib/security";
import { pageHead } from "@/shared/lib/platform";

const feature = securityFeature("two-factor");

export const Route = createFileRoute("/security/two-factor")({
  head: ({ match }) => pageHead(feature.titleKey, feature.descriptionKey, match.context.language),
  component: () => (
    <WalletPage titleKey={feature.titleKey}>
      <TwoFactorPage />
    </WalletPage>
  ),
});
