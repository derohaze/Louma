import { createFileRoute } from "@tanstack/react-router";
import { WalletPage } from "@/app/shell";
import { FreezeWalletPage } from "@/features/security";
import { securityFreezeWallet } from "@/shared/lib/security";
import { pageHead } from "@/shared/lib/platform";

const page = securityFreezeWallet;

export const Route = createFileRoute("/security/freeze")({
  head: () => pageHead(page.title, page.description),
  component: () => (
    <WalletPage title={page.title}>
      <FreezeWalletPage />
    </WalletPage>
  ),
});
