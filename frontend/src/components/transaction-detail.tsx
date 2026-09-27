import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { useWallet } from "@/hooks/use-wallet";
import { lookupAddress, transactionStatus } from "@/lib/demo-wallet";
import { currency, dateText, transferNet, transferTax } from "@/lib/wallet-format";
import { CopyButton, EmptyState, PageHeader } from "./wallet-shell";
import { FactList, Panel, PreviewNote, StatusPill } from "./security-ui";

/**
 * One transfer in full: what it cost, where it went, and whether it is final. The transaction is read
 * from the wallet context rather than a route loader, so a new transfer is on the page without a
 * reload.
 */
export function TransactionDetailContent({ transferId }: { transferId: string }) {
  const { transactions } = useWallet();
  const transaction = transactions.find((item) => item.transfer_id === transferId);
  if (!transaction) {
    return (
      <EmptyState
        title="Transaction not found"
        detail="This transfer is not part of this wallet's history, or the link is out of date."
        action={
          <Link to="/history">
            <Button variant="outline">All transactions</Button>
          </Link>
        }
      />
    );
  }
  const sent = transaction.direction === "sent";
  const tax = transferTax(transaction.amount);
  const net = sent ? transferNet(transaction.amount) : transaction.amount;
  const status = transactionStatus(transaction);
  const book = lookupAddress(transaction.counterparty_address);
  return (
    <>
      <PageHeader
        title={`${sent ? "Sent" : "Received"} ${currency(transaction.amount)}`}
        subtitle={`${transaction.transfer_id} · ${dateText(transaction.created_at)}`}
      />
      <div className="grid gap-4 xl:grid-cols-[1.3fr_1fr]">
        <div className="space-y-4">
          <Panel
            title="Breakdown"
            description="The 1% network tax is taken from the amount before the recipient is credited."
            action={<StatusPill enabled={status === "Final"} on="Final" off={status} />}
          >
            <FactList
              items={[
                [sent ? "Amount debited" : "Amount credited", currency(transaction.amount)],
                [
                  "Network tax (1%)",
                  sent ? currency(tax) : `${currency(tax)} — paid by the sender`,
                ],
                [sent ? "Recipient received" : "Kept by this wallet", currency(net)],
                ["Note", transaction.note || "—"],
                [
                  "Transfer ID",
                  <code key="id" className="break-all">
                    {transaction.transfer_id}
                  </code>,
                ],
                ["Recorded", dateText(transaction.created_at)],
              ]}
            />
          </Panel>
          <Panel title="Counterparty" description="Who is on the other side of the transfer.">
            <div className="flex items-center gap-2 rounded-xl bg-secondary p-3">
              <code className="min-w-0 flex-1 break-all text-sm">
                {transaction.counterparty_address}
              </code>
              <CopyButton text={transaction.counterparty_address} />
            </div>
            <p className="mt-4 text-sm">
              {book.status === "unknown"
                ? "This address was not in your address book when the transfer was sent."
                : book.detail}
            </p>
          </Panel>
        </div>
        <div className="space-y-4">
          <Panel title="What next" description="Where this transfer leads.">
            <div className="flex flex-wrap gap-2">
              <Link to="/history">
                <Button variant="outline">All transactions</Button>
              </Link>
              <Link to="/transfer">
                <Button variant="outline">New transfer</Button>
              </Link>
            </div>
          </Panel>
          <PreviewNote>
            Preview build: the status is derived from the transfer date, and the tax is the flat 1%
            that applies to every wallet.
          </PreviewNote>
        </div>
      </div>
    </>
  );
}
