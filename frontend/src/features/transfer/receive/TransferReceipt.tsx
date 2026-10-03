import { Link } from "@tanstack/react-router";
import { ArrowUpRight01Icon, CheckmarkCircle01Icon } from "@hugeicons/core-free-icons";
import { Button } from "@/shared/ui/button";
import { CopyButton, Icon } from "@/shared/ui/page";
import { useT } from "@/shared/i18n";
import { currency } from "@/shared/lib/wallet";
import type { TransferFlow } from "@/features/transfer/send/useTransferFlow";

/** The confirmed transfer: what left, what arrived, and where both sides record it. */
export function TransferReceipt({ flow }: { flow: TransferFlow }) {
  const t = useT("transfer.receipt");
  const { sent, startOver } = flow;
  if (!sent) return null;
  return (
    <section className="max-w-2xl rounded-[22px] border bg-card p-6 shadow-sm">
      <span className="grid size-11 place-items-center rounded-full bg-success/10 text-success">
        <Icon icon={CheckmarkCircle01Icon} size={24} />
      </span>
      <h2 className="mt-4 font-display text-xl font-semibold">{t("sentTitle")}</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        {t("summary", {
          amount: currency(sent.amount),
          received: currency(sent.netAmount),
          address: sent.counterpartyAddress,
          tax: currency(sent.fee),
        })}
      </p>
      <div className="mt-5 rounded-xl bg-secondary p-3">
        <p className="text-xs text-muted-foreground">{t("transferId")}</p>
        <div className="mt-1 flex items-center gap-2">
          <code className="min-w-0 flex-1 break-all text-xs">{sent.transferId}</code>
          <CopyButton text={sent.transferId} />
        </div>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">{t("recorded")}</p>
      <div className="mt-5 flex flex-wrap gap-3">
        <Link to="/transactions/$transferId" params={{ transferId: sent.transferId }}>
          <Button variant="outline">{t("view")}</Button>
        </Link>
        <Button onClick={startOver}>
          <Icon icon={ArrowUpRight01Icon} size={17} />
          {t("newTransfer")}
        </Button>
      </div>
    </section>
  );
}
