import { useEffect, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { NoteEditIcon, PrinterIcon } from "@hugeicons/core-free-icons";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { useWallet, type Transaction } from "@/shared/hooks";
import { api, messageForError } from "@/shared/api";
import { serverStateKeys } from "@/shared/lib/platform";
import { displayNote, loadLocalNote, saveLocalNote } from "@/shared/lib/wallet";
import { currency, transactionDateText, transferNet, transferTax } from "@/shared/lib/wallet";
import { CopyButton, EmptyState, Icon, PageHeader } from "@/shared/ui/page";
import { useT } from "@/shared/i18n";
import { FactList, FormMessage, Panel } from "@/shared/ui/panels";

/**
 * One transfer in full: what it cost, where it went, and whether it is final. The transfer is taken
 * from the loaded history when it is there, and fetched by its transfer id when it is not (a deep
 * link, or a transfer older than the loaded page).
 */
export function TransactionDetailContent({ transferId }: { transferId: string }) {
  const t = useT("transactions.detail");
  const common = useT("common");
  const { transactions, userId } = useWallet();
  const known = transactions.find((item) => item.transferId === transferId);
  const transferQuery = useQuery({
    queryKey: serverStateKeys.transfer(transferId),
    queryFn: () =>
      api.get<{ transfer: Transaction }>(`/api/v1/transfers/${encodeURIComponent(transferId)}`),
    enabled: Boolean(userId && !known),
  });
  const [personalNote, setPersonalNote] = useState("");
  const [noteDraft, setNoteDraft] = useState("");
  const [editingNote, setEditingNote] = useState(false);

  // The personal note is device-local, so it is read here rather than from the transfer record:
  // a note written before this view existed is still on this device and must come back.
  useEffect(() => {
    const saved = loadLocalNote(userId, transferId);
    setPersonalNote(saved);
    setNoteDraft(saved);
    setEditingNote(false);
  }, [userId, transferId]);

  const transaction = known ?? transferQuery.data?.transfer;
  const error = transferQuery.error ? messageForError(transferQuery.error) : "";
  if (!transaction) {
    return (
      <EmptyState
        title={t("notFoundTitle")}
        detail={error || t("notFoundDetail")}
        action={
          <Link to="/transactions">
            <Button variant="outline">{t("allTransactions")}</Button>
          </Link>
        }
      />
    );
  }
  const sent = transaction.direction === "sent";
  const merchantOperation = transaction.type !== "transfer";
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
        [t("breakdown.amountDebited"), currency(transaction.amount)],
        [
          t(merchantOperation ? "merchant.fee" : "breakdown.tax"),
          merchantOperation
            ? t("merchant.feePaidByMerchant", { amount: currency(tax) })
            : currency(tax),
        ],
        [t("breakdown.recipientReceived"), currency(net)],
        // `balanceAfter` is the sender's own balance, so it only means something on this side.
        [
          t("breakdown.balanceAfter"),
          transaction.balanceAfter ? currency(transaction.balanceAfter) : common("state.none"),
        ],
      ]
    : [
        [t("breakdown.amountCredited"), currency(net)],
        [
          t(merchantOperation ? "merchant.fee" : "breakdown.tax"),
          t(merchantOperation ? "merchant.feePaidByMerchant" : "breakdown.taxPaidBySender", {
            amount: currency(tax),
          }),
        ],
        [t("breakdown.senderPaid"), currency(transaction.amount)],
      ];
  return (
    <>
      <PageHeader
        title={t(sent ? "heading.sent" : "heading.received", {
          amount: currency(movedForThisWallet),
        })}
        subtitle={`${transaction.transferId} · ${transactionDateText(transaction.createdAt)}`}
      />
      <div className="grid gap-4 xl:grid-cols-[1.3fr_1fr]">
        <div className="space-y-4">
          <Panel
            delayMs={0}
            title={t("breakdown.title")}
            description={t(
              transaction.type === "merchant_payment"
                ? "merchant.description"
                : transaction.type === "merchant_refund"
                  ? "merchant.refundDescription"
                  : "breakdown.description",
            )}
          >
            <FactList
              items={[
                ...breakdown,
                [t("breakdown.status"), common("state.completed")],
                [t("breakdown.note"), transaction.note || common("state.none")],
                [
                  t(merchantOperation ? "merchant.operationId" : "breakdown.transferId"),
                  <code key="id" className="break-all">
                    {transaction.transferId}
                  </code>,
                ],
                [t("breakdown.recorded"), transactionDateText(transaction.createdAt)],
              ]}
            />
          </Panel>
          <Panel
            delayMs={75}
            title={t("counterparty.title")}
            description={t("counterparty.description")}
          >
            <div className="flex items-center gap-2 rounded-xl bg-secondary p-3">
              <code className="min-w-0 flex-1 break-all text-sm">
                {transaction.counterpartyAddress}
              </code>
              <CopyButton text={transaction.counterpartyAddress} />
            </div>
            <p className="mt-4 text-sm text-muted-foreground">
              {sent ? t("counterparty.sentTo") : t("counterparty.sentFrom")}
            </p>
            {transaction.correlationId && (
              <div className="mt-4">
                <FormMessage tone="ok">
                  {t("counterparty.supportReference", { reference: transaction.correlationId })}
                </FormMessage>
              </div>
            )}
          </Panel>
          <Panel delayMs={150} title={t("notes.title")} description={t("notes.description")}>
            <FactList
              items={[
                [t("notes.onRecord"), transaction.note || common("state.none")],
                [t("notes.personal"), displayNote("", personalNote) || common("state.none")],
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
                  aria-label={t("notes.personalAria")}
                  placeholder={t("notes.personalPlaceholder")}
                  autoComplete="off"
                  maxLength={240}
                  value={noteDraft}
                  onChange={(event) => setNoteDraft(event.target.value)}
                />
                <div className="flex flex-wrap gap-2">
                  <Button type="submit" size="sm" className="rounded-full">
                    {t("notes.save")}
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
                    {common("actions.cancel")}
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
                {personalNote ? t("notes.edit") : t("notes.add")}
              </Button>
            )}
          </Panel>
        </div>
        <div className="space-y-4 no-print">
          <Panel delayMs={225} title={t("next.title")} description={t("next.description")}>
            <div className="flex flex-wrap gap-2">
              <Link to="/transactions">
                <Button variant="outline">{t("allTransactions")}</Button>
              </Link>
              <Link to="/transfer">
                <Button variant="outline">{t("next.newTransfer")}</Button>
              </Link>
              <Button variant="outline" onClick={() => window.print()}>
                <Icon icon={PrinterIcon} size={17} />
                {t("next.print")}
              </Button>
            </div>
          </Panel>
        </div>
      </div>
    </>
  );
}
