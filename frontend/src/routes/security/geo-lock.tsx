import { createFileRoute } from "@tanstack/react-router";
import { WalletPage } from "@/components/wallet-shell";
import { GeoLockContent } from "@/components/security-features";
import { securityFeature } from "@/lib/security-catalog";
import { pageHead } from "@/lib/page-head";

const feature = securityFeature("geo-lock");

export const Route = createFileRoute("/security/geo-lock")({
  head: () => pageHead(feature.title, feature.description),
  component: () => (
    <WalletPage title={feature.title}>
      <GeoLockContent />
    </WalletPage>
  ),
});
