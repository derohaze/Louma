import { createFileRoute } from "@tanstack/react-router";
import { WalletPage } from "@/components/wallet-shell";
import { SecurityCenterContent } from "@/components/security-center";
import { securityCenter } from "@/lib/security-catalog";
import { pageHead } from "@/lib/page-head";

export const Route = createFileRoute("/security/")({
  head: () => pageHead(securityCenter.title, securityCenter.description),
  component: () => (
    <WalletPage title={securityCenter.title}>
      <SecurityCenterContent />
    </WalletPage>
  ),
});
