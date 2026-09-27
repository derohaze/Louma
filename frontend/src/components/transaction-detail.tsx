import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { useWallet, type Transaction } from "@/hooks/wallet-context";
import { api, messageForError } from "@/lib/api";
import { currency, dateText, transferNet, transferTax } from "@/lib/wallet-format";
import { CopyButton, EmptyState, PageHeader } from "./wallet-shell";
import { FactList, FormMessage, Panel } from "./security-ui";

/**
 * One transfer in full: what it cost, where it went, and whether it is final. The transfer is taken
 * from the loaded history when it is there, and fetched by its transfer id when it is not (a deep
 * link, or a transfer older than the loaded page).
 */
export function TransactionDetailContent({ transferId }: { transferId: string }) {
  const { transactions } = useWallet();
  const known = transactions.find((item) => item.transferId === transferId);
  const [fetched, setFetched] = useState<Transaction | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(!known);

  useEffect(() => {
    if (known) {
      setLoading(false);
      return;
    }
    let active = true;
    void api
      .get<{ transfer: Transaction }>(`/api/v1/transfers/${encodeURIComponent(transferId)}`)
      .then((response) => {
        if (active) setFetched(response.transfer);
      })
      .catch((cause: unknown) => {
        if (active) setError(messageForError(cause));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [known, transferId]);

  const transaction = known ?? fetched;
  if (loading) {
    return <p className="py-20 text-center text-muted-foreground">Loading transaction…</p>;
  }
  if (!transaction) {
    return (
      <EmptyState
        title="Transaction not found"
        detail={
          error || "This transfer is not part of this wallet's history, or the link is out of date."
        }
        action={
          <Link to="/history">
            <Button variant="outline">All transactions</Button>
          </Link>
        }
      />
    );
  }
  const sent = transaction.direction === "sent";
  // The fee and net amount are recorded by the backend; the local rule is only used when the
  // recorded values are missing (a transfer created before the fee column existed).
  const tax = transaction.fee || transferTax(transaction.amount);
  const net =
    transaction.netAmount || (sent ? transferNet(transaction.amount) : transaction.amount);
  return (
    <>
      <PageHeader
        title={`${sent ? "Sent" : "Received"} ${currency(transaction.amount)}`}
        subtitle={`${transaction.transferId} · ${dateText(transaction.createdAt)}`}
      />
      <div className="grid gap-4 xl:grid-cols-[1.3fr_1fr]">
        <div className="space-y-4">
          <Panel
            title="Breakdown"
            description="The 1% network tax is taken from the amount before the recipient is credited."
          >
            <FactList
              items={[
                [sent ? "Amount debited" : "Amount credited", currency(transaction.amount)],
                [
                  "Network tax (1%)",
                  sent ? currency(tax) : `${currency(tax)} — paid by the sender`,
                ],
                [sent ? "Recipient received" : "Kept by this wallet", currency(net)],
                [
                  "Balance after",
                  transaction.balanceAfter ? currency(transaction.balanceAfter) : "—",
                ],
                ["Status", "Completed"],
                ["Note", transaction.note || "—"],
                [
                  "Transfer ID",
                  <code key="id" className="break-all">
                    {transaction.transferId}
                  </code>,
                ],
                ["Recorded", dateText(transaction.createdAt)],
              ]}
            />
          </Panel>
          <Panel title="Counterparty" description="The wallet on the other side of the transfer.">
            <div className="flex items-center gap-2 rounded-xl bg-secondary p-3">
              <code className="min-w-0 flex-1 break-all text-sm">
                {transaction.counterpartyAddress}
              </code>
              <CopyButton text={transaction.counterpartyAddress} />
            </div>
            <p className="mt-4 text-sm text-muted-foreground">
              {sent
                ? "This is the address the LMA was sent to."
                : "This is the address the LMA was sent from."}
            </p>
            {transaction.correlationId && (
              <div className="mt-4">
                <FormMessage tone="ok">
                  Reference for support: {transaction.correlationId}
                </FormMessage>
              </div>
            )}
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
        </div>
      </div>
    </>
  );
}
