import { useEffect, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { NoteEditIcon, PrinterIcon } from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useWallet, type Transaction } from "@/hooks/wallet-context";
import { api, messageForError } from "@/lib/api";
import { displayNote, loadLocalNote, saveLocalNote } from "@/lib/address-book";
import { currency, dateText, transferNet, transferTax } from "@/lib/wallet-format";
import { CopyButton, EmptyState, Icon, PageHeader } from "./wallet-shell";
import { TransactionDetailSkeleton } from "./page-skeletons";
import { FactList, FormMessage, Panel } from "./security-ui";

/**
 * One transfer in full: what it cost, where it went, and whether it is final. The transfer is taken
 * from the loaded history when it is there, and fetched by its transfer id when it is not (a deep
 * link, or a transfer older than the loaded page).
 */
export function TransactionDetailContent({ transferId }: { transferId: string }) {
  const { transactions, userId } = useWallet();
  const known = transactions.find((item) => item.transferId === transferId);
  const [fetched, setFetched] = useState<Transaction | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(!known);
  const [personalNote, setPersonalNote] = useState("");
  const [noteDraft, setNoteDraft] = useState("");
  const [editingNote, setEditingNote] = useState(false);

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

  useEffect(() => {
    const saved = loadLocalNote(userId, transferId);
    setPersonalNote(saved);
    setNoteDraft(saved);
    setEditingNote(false);
  }, [userId, transferId]);

  const transaction = known ?? fetched;
  if (loading) {
    return <TransactionDetailSkeleton title="Transaction" />;
  }
  if (!transaction) {
    return (
      <EmptyState
        title="Transaction not found"
        detail={
          error || "This transfer is not part of this wallet's history, or the link is out of date."
        }
        action={
          <Link to="/transactions">
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
  /**
   * The amount debited from the sender and the amount credited to the recipient are different
   * numbers: the network tax sits between them. Each side is shown what moved in its own wallet, so
   * a received transfer is worth its net amount here — the same figure the wallet balance grew by.
   */
  const movedForThisWallet = sent ? transaction.amount : net;
  const breakdown: [string, ReactNode][] = sent
    ? [
        ["Amount debited", currency(transaction.amount)],
        ["Network tax (1%)", currency(tax)],
        ["Recipient received", currency(net)],
        // `balanceAfter` is the sender's own balance, so it only means something on this side.
        ["Balance after", transaction.balanceAfter ? currency(transaction.balanceAfter) : "—"],
      ]
    : [
        ["Amount credited", currency(net)],
        ["Network tax (1%)", `${currency(tax)} — paid by the sender`],
        ["Sender paid", currency(transaction.amount)],
      ];
  return (
    <>
      <PageHeader
        title={`${sent ? "Sent" : "Received"} ${currency(movedForThisWallet)}`}
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
                ...breakdown,
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
          <Panel
            title="Notes"
            description="The record's note was written at send time; yours lives on this device."
          >
            <FactList
              items={[
                ["On record", transaction.note || "—"],
                ["Personal · this device", displayNote("", personalNote) || "—"],
              ]}
            />
            {editingNote ? (
              <form
                className="mt-4 flex flex-col gap-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  saveLocalNote(userId, transferId, noteDraft);
                  setPersonalNote(noteDraft.trim().slice(0, 240));
                  setEditingNote(false);
                }}
              >
                <Input
                  autoFocus
                  aria-label="Personal note"
                  placeholder="e.g. March rent"
                  autoComplete="off"
                  maxLength={240}
                  value={noteDraft}
                  onChange={(event) => setNoteDraft(event.target.value)}
                />
                <div className="flex flex-wrap gap-2">
                  <Button type="submit" size="sm" className="rounded-full">
                    Save note
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="rounded-full"
                    onClick={() => {
                      setNoteDraft(personalNote);
                      setEditingNote(false);
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </form>
            ) : (
              <Button
                variant="outline"
                size="sm"
                className="mt-4 rounded-full"
                onClick={() => setEditingNote(true)}
              >
                <Icon icon={NoteEditIcon} size={16} />
                {personalNote ? "Edit personal note" : "Add personal note"}
              </Button>
            )}
          </Panel>
        </div>
        <div className="space-y-4 no-print">
          <Panel title="What next" description="Where this transfer leads.">
            <div className="flex flex-wrap gap-2">
              <Link to="/transactions">
                <Button variant="outline">All transactions</Button>
              </Link>
              <Link to="/transfer">
                <Button variant="outline">New transfer</Button>
              </Link>
              <Button variant="outline" onClick={() => window.print()}>
                <Icon icon={PrinterIcon} size={17} />
                Print receipt
              </Button>
            </div>
          </Panel>
        </div>
      </div>
    </>
  );
}
