import { Link } from "@tanstack/react-router";
import { Key01Icon, SquareLock02Icon } from "@hugeicons/core-free-icons";
import { Icon, PageHeader } from "@/shared/ui/page";
import { currency } from "@/shared/lib/wallet";
import { SendStepper } from "@/features/transfer/send/TransferQrScanner";
import { TransferStageAddress } from "@/features/transfer/send/TransferStageAddress";
import { TransferStageAmount } from "@/features/transfer/send/TransferStageAmount";
import { TransferStageConfirm } from "@/features/transfer/send/TransferStageConfirm";
import { TransferReceipt } from "@/features/transfer/receive/TransferReceipt";
import { useTransferFlow } from "@/features/transfer/send/useTransferFlow";

/** The Transfer page: Send in three staged steps. */
export function TransferPage() {
  const flow = useTransferFlow();
  const { stage, sent, frozen, wallet, needsCredential, passwordSet, authenticatorSet } = flow;
  return (
    <>
      <PageHeader title="Transfer" subtitle="Send LMA to another wallet address." />
      {!sent && <SendStepper stage={stage} />}
      {frozen && !sent && (
        <p
          role="status"
          className="mb-5 rounded-xl border border-warning bg-warning/10 px-4 py-3 text-sm"
        >
          The wallet is frozen, so every transfer is refused.{" "}
          <Link to="/security/freeze" className="font-semibold text-primary-soft">
            Unfreeze it
          </Link>
          .
        </p>
      )}
      {sent ? (
        <TransferReceipt flow={flow} />
      ) : (
        <div className="grid gap-4 xl:grid-cols-[1.5fr_1fr]">
          <section className="rounded-[22px] border bg-card p-5 shadow-sm">
            {stage === 1 && <TransferStageAddress flow={flow} />}
            {stage === 2 && <TransferStageAmount flow={flow} />}
            {stage === 3 && <TransferStageConfirm flow={flow} />}
          </section>
          <aside className="h-fit space-y-4">
            <section className="rounded-[22px] border bg-card p-5 shadow-sm">
              <p className="text-sm text-muted-foreground">Available balance</p>
              <p className="mt-3 font-display text-2xl font-bold">
                {currency(wallet?.balance ?? "0")}
              </p>
              <p className="mt-5 text-sm text-muted-foreground">
                The 1% network tax is taken from what the sender pays; the recipient receives the
                rest.
              </p>
            </section>
            <section className="rounded-[22px] border bg-card p-5 shadow-sm">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <Icon icon={needsCredential ? Key01Icon : SquareLock02Icon} size={18} />
                {needsCredential ? "A credential is required" : "No credential is set"}
              </div>
              <p className="mt-3 text-sm text-muted-foreground">
                {needsCredential
                  ? `This wallet accepts ${
                      passwordSet && authenticatorSet
                        ? "your transfer password or an authenticator code"
                        : passwordSet
                          ? "your transfer password"
                          : "an authenticator code"
                    } before any LMA leaves it.`
                  : "Without a transfer password or an authenticator, a signed-in session can move funds on its own."}
              </p>
              {!needsCredential && (
                <Link
                  to="/security"
                  className="mt-3 inline-block text-xs font-semibold text-primary-soft"
                >
                  Set up a credential
                </Link>
              )}
              <p className="mt-4 text-sm text-muted-foreground">
                Transfers are final after submission. Nothing moves until the last step.
              </p>
            </section>
          </aside>
        </div>
      )}
    </>
  );
}
