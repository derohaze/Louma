import {
  ArrowLeft01Icon,
  ArrowUpRight01Icon,
  Key01Icon,
  SquareLock02Icon,
} from "@hugeicons/core-free-icons";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Icon } from "@/shared/ui/page";
import { FormMessage } from "@/shared/ui/panels";
import { LIMITS } from "@/shared/lib/platform";
import { useT } from "@/shared/i18n";
import { currency } from "@/shared/lib/wallet";
import { cn } from "@/shared/lib/platform";
import type { TransferFlow } from "@/features/transfer/send/useTransferFlow";

/** Stage three: the server-approved summary plus the credential proof. Nothing moves until here. */
export function TransferStageConfirm({ flow }: { flow: TransferFlow }) {
  const t = useT("transfer.send");
  const common = useT("common");
  const {
    recipient,
    quote,
    verifiedAddress,
    needsCredential,
    usingCode,
    passwordSet,
    authenticatorSet,
    method,
    setMethod,
    credential,
    setCredential,
    busy,
    error,
    setStage,
    setError,
    completeTransfer,
  } = flow;
  if (!recipient || !quote) return null;
  return (
    <div className="space-y-4">
      <div className="overflow-hidden rounded-xl border">
        {[
          [t("confirm.recipient"), verifiedAddress],
          [t("confirm.tax"), currency(quote.fee)],
          [t("confirm.amount"), currency(quote.amount)],
          [t("confirm.receives"), currency(quote.netAmount)],
          [t("confirm.balanceAfter"), currency(quote.balanceAfter)],
        ].map(([label, value]) => (
          <div
            key={label}
            className="flex items-start justify-between gap-4 border-b px-4 py-3 last:border-0"
          >
            <span className="shrink-0 text-sm text-muted-foreground">{label}</span>
            <span
              className={cn(
                "min-w-0 text-end text-sm font-semibold",
                label === t("confirm.recipient") && "break-all",
              )}
            >
              {value}
            </span>
          </div>
        ))}
      </div>
      {recipient.displayName && (
        <p className="text-xs text-muted-foreground">
          {t("confirm.paying", { name: recipient.displayName })}
        </p>
      )}
      {needsCredential && (
        <div className="space-y-3 rounded-xl border p-4">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Icon icon={usingCode ? Key01Icon : SquareLock02Icon} size={18} />
            {usingCode ? t("confirm.authenticatorCode") : t("confirm.transferPassword")}
          </div>
          {passwordSet && authenticatorSet && (
            <div className="flex w-fit gap-1 rounded-full border bg-secondary/60 p-1">
              {(
                [
                  ["password", t("confirm.methodPassword")],
                  ["code", t("confirm.methodCode")],
                ] as const
              ).map(([value, label]) => (
                <Button
                  key={value}
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setMethod(value);
                    setCredential("");
                    setError("");
                  }}
                  className={cn(
                    "h-8 rounded-full px-4 text-xs font-semibold",
                    method === value
                      ? "bg-card text-foreground shadow-sm"
                      : "text-muted-foreground",
                  )}
                >
                  {label}
                </Button>
              ))}
            </div>
          )}
          <Input
            type={usingCode ? "text" : "password"}
            autoComplete={usingCode ? "one-time-code" : "off"}
            spellCheck={false}
            maxLength={usingCode ? 64 : LIMITS.maxPasswordLength}
            value={credential}
            onChange={(event) => {
              setCredential(event.target.value);
              setError("");
            }}
            placeholder={
              usingCode ? t("confirm.codePlaceholder") : t("confirm.passwordPlaceholder")
            }
          />
          <p className="text-xs text-muted-foreground">
            {usingCode ? t("confirm.codeNote") : t("confirm.passwordNote")}
          </p>
        </div>
      )}
      {!needsCredential && (
        <p className="text-xs text-muted-foreground">{t("confirm.noCredential")}</p>
      )}
      {error && <FormMessage tone="error">{error}</FormMessage>}
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="outline"
          disabled={busy !== null}
          onClick={() => {
            setStage(2);
            setError("");
          }}
        >
          <Icon icon={ArrowLeft01Icon} size={16} />
          {common("actions.back")}
        </Button>
        <Button disabled={busy !== null} onClick={() => void completeTransfer()}>
          <Icon icon={ArrowUpRight01Icon} size={17} />
          {busy === "send"
            ? t("confirm.sending")
            : t("confirm.send", { amount: currency(quote.amount) })}
        </Button>
      </div>
    </div>
  );
}
