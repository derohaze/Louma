import { createFileRoute } from "@tanstack/react-router";
import { WalletPage } from "@/app/shell";
import { TransferPasswordPage } from "@/features/security";
import { securityFeature } from "@/shared/lib/security";
import { pageHead } from "@/shared/lib/platform";

const feature = securityFeature("transfer-password");

export const Route = createFileRoute("/security/transfer-password")({
  head: () => pageHead(feature.title, feature.description),
  component: () => (
    <WalletPage title={feature.title}>
      <TransferPasswordPage />
    </WalletPage>
  ),
});
