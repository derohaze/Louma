import { createFileRoute } from "@tanstack/react-router";
import { WalletPage } from "@/components/wallet-shell";
import { AutoSignInContent } from "@/components/security-features";
import { securityFeature } from "@/lib/security-catalog";
import { pageHead } from "@/lib/page-head";

const feature = securityFeature("auto-sign-in");

export const Route = createFileRoute("/security/auto-sign-in")({
  head: () => pageHead(feature.title, feature.description),
  component: () => (
    <WalletPage title={feature.title}>
      <AutoSignInContent />
    </WalletPage>
  ),
});
