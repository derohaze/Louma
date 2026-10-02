import { createFileRoute } from "@tanstack/react-router";
import { WalletPage } from "@/app/shell";
import { TwoFactorPage } from "@/features/security";
import { securityFeature } from "@/shared/lib/security";
import { pageHead } from "@/shared/lib/platform";

const feature = securityFeature("two-factor");

export const Route = createFileRoute("/security/two-factor")({
  head: () => pageHead(feature.title, feature.description),
  component: () => (
    <WalletPage title={feature.title}>
      <TwoFactorPage />
    </WalletPage>
  ),
});
