import { createFileRoute } from "@tanstack/react-router";
import { WalletPage } from "@/components/wallet-shell";
import { TransferPasswordContent } from "@/components/security-features";
import { securityFeature } from "@/lib/security-catalog";
import { pageHead } from "@/lib/page-head";

const feature = securityFeature("transfer-password");

export const Route = createFileRoute("/security/transfer-password")({
  head: () => pageHead(feature.title, feature.description),
  component: () => (
    <WalletPage title={feature.title}>
      <TransferPasswordContent />
    </WalletPage>
  ),
});
