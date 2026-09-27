import { createFileRoute } from "@tanstack/react-router";
import { WalletPage } from "@/components/wallet-shell";
import { TransferApprovalContent } from "@/components/security-features";
import { securityTransferApproval } from "@/lib/security-catalog";
import { pageHead } from "@/lib/page-head";

const page = securityTransferApproval;

export const Route = createFileRoute("/security/transfer-approval")({
  head: () => pageHead(page.title, page.description),
  component: () => (
    <WalletPage title={page.title}>
      <TransferApprovalContent />
    </WalletPage>
  ),
});
