import { createFileRoute } from "@tanstack/react-router";
import { WalletPage } from "@/app/shell";
import { TransactionDetailContent } from "@/features/transactions";
import { pageHead } from "@/shared/lib/platform";

export const Route = createFileRoute("/transactions/$transferId")({
  head: () => pageHead("Transaction", "One transfer with its amount, tax, status, and receipt."),
  component: TransactionRoute,
});

/** Named component: the router renders it, and it reads the transfer id from the URL. */
function TransactionRoute() {
  const { transferId } = Route.useParams();
  return (
    <WalletPage title="Transaction">
      <TransactionDetailContent transferId={transferId} />
    </WalletPage>
  );
}
