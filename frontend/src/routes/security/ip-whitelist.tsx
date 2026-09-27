import { createFileRoute } from "@tanstack/react-router";
import { WalletPage } from "@/components/wallet-shell";
import { IpWhitelistContent } from "@/components/security-features";
import { securityFeature } from "@/lib/security-catalog";
import { pageHead } from "@/lib/page-head";

const feature = securityFeature("ip-whitelist");

export const Route = createFileRoute("/security/ip-whitelist")({
  head: () => pageHead(feature.title, feature.description),
  component: () => (
    <WalletPage title={feature.title}>
      <IpWhitelistContent />
    </WalletPage>
  ),
});
