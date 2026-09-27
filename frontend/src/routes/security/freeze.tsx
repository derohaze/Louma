import { createFileRoute } from "@tanstack/react-router";
import { WalletPage } from "@/components/wallet-shell";
import { FreezeWalletContent } from "@/components/security-features";
import { securityFreezeWallet } from "@/lib/security-catalog";
import { pageHead } from "@/lib/page-head";

const page = securityFreezeWallet;

export const Route = createFileRoute("/security/freeze")({
  head: () => pageHead(page.title, page.description),
  component: () => (
    <WalletPage title={page.title}>
      <FreezeWalletContent />
    </WalletPage>
  ),
});
