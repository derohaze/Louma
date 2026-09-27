import { createFileRoute } from "@tanstack/react-router";
import { WalletPage } from "@/components/wallet-shell";
import { TimeAccessContent } from "@/components/security-features";
import { securityFeature } from "@/lib/security-catalog";
import { pageHead } from "@/lib/page-head";

const feature = securityFeature("time-access");

export const Route = createFileRoute("/security/time-access")({
  head: () => pageHead(feature.title, feature.description),
  component: () => (
    <WalletPage title={feature.title}>
      <TimeAccessContent />
    </WalletPage>
  ),
});
