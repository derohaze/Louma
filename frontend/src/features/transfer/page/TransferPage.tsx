import { Link } from "@tanstack/react-router";
import { Key01Icon, SquareLock02Icon } from "@hugeicons/core-free-icons";
import { Icon, PageHeader, revealDelay } from "@/shared/ui/page";
import { useT } from "@/shared/i18n";
import { currency } from "@/shared/lib/wallet";
import { SendStepper } from "@/features/transfer/send/TransferQrScanner";
import { TransferStageAddress } from "@/features/transfer/send/TransferStageAddress";
import { TransferStageAmount } from "@/features/transfer/send/TransferStageAmount";
import { TransferStageConfirm } from "@/features/transfer/send/TransferStageConfirm";
import { TransferReceipt } from "@/features/transfer/receive/TransferReceipt";
import { useTransferFlow } from "@/features/transfer/send/useTransferFlow";

/** The Transfer page: Send in three staged steps. */
export function TransferPage() {
  const t = useT("transfer.page");
  const flow = useTransferFlow();
  const { stage, sent, frozen, wallet, needsCredential, passwordSet, authenticatorSet } = flow;
  return (
    <>
      <PageHeader title={t("title")} subtitle={t("description")} />
      {!sent && (
        <div className="page-enter">
          <SendStepper stage={stage} />
        </div>
      )}
      {frozen && !sent && (
        <p
          role="status"
          className="mb-5 rounded-xl border border-warning bg-warning/10 px-4 py-3 text-sm"
        >
          {t("frozenNotice")}{" "}
          <Link to="/security/freeze" className="font-semibold text-primary-soft">
            {t("unfreeze")}
          </Link>
          .
        </p>
      )}
      {sent ? (
        <div key="receipt" className="stage-enter">
          <TransferReceipt flow={flow} />
        </div>
      ) : (
        <div className="grid gap-4 xl:grid-cols-[1.5fr_1fr]">
          <section
            key={stage}
            style={revealDelay(0)}
            className="stage-enter rounded-[22px] border bg-card p-5 shadow-sm"
          >
            {stage === 1 && <TransferStageAddress flow={flow} />}
            {stage === 2 && <TransferStageAmount flow={flow} />}
            {stage === 3 && <TransferStageConfirm flow={flow} />}
          </section>
          <aside className="h-fit space-y-4">
            <section
              style={revealDelay(1)}
              className="card-enter rounded-[22px] border bg-card p-5 shadow-sm"
            >
              <p className="text-sm text-muted-foreground">{t("availableBalance")}</p>
              <p className="mt-3 font-display text-2xl font-bold">
                {currency(wallet?.balance ?? "0")}
              </p>
              <p className="mt-5 text-sm text-muted-foreground">{t("taxNote")}</p>
            </section>
            <section
              style={revealDelay(2)}
              className="card-enter rounded-[22px] border bg-card p-5 shadow-sm"
            >
              <div className="flex items-center gap-2 text-sm font-semibold">
                <Icon icon={needsCredential ? Key01Icon : SquareLock02Icon} size={18} />
                {needsCredential ? t("credential.required") : t("credential.none")}
              </div>
              <p className="mt-3 text-sm text-muted-foreground">
                {needsCredential
                  ? t("credential.accepts", {
                      methods:
                        passwordSet && authenticatorSet
                          ? t("credential.methodsBoth")
                          : passwordSet
                            ? t("credential.methodsPassword")
                            : t("credential.methodsCode"),
                    })
                  : t("credential.without")}
              </p>
              {!needsCredential && (
                <Link
                  to="/security"
                  className="mt-3 inline-block text-xs font-semibold text-primary-soft"
                >
                  {t("credential.setUp")}
                </Link>
              )}
              <p className="mt-4 text-sm text-muted-foreground">{t("credential.final")}</p>
            </section>
          </aside>
        </div>
      )}
    </>
  );
}
