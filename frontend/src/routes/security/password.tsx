import { createFileRoute } from "@tanstack/react-router";
import { WalletPage } from "@/components/wallet-shell";
import { WalletPasswordContent } from "@/components/security-features";
import { securityWalletPassword } from "@/lib/security-catalog";
import { pageHead } from "@/lib/page-head";

const page = securityWalletPassword;

export const Route = createFileRoute("/security/password")({
  head: () => pageHead(page.title, page.description),
  component: () => (
    <WalletPage title={page.title}>
      <WalletPasswordContent />
    </WalletPage>
  ),
});
