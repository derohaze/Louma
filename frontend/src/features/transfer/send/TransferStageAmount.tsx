import { useState } from "react";
import {
  ArrowLeft01Icon,
  ArrowRight01Icon,
  CheckmarkCircle01Icon,
  FavouriteIcon,
  PercentCircleIcon,
} from "@hugeicons/core-free-icons";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Icon } from "@/shared/ui/page";
import { FormMessage } from "@/shared/ui/panels";
import { LIMITS } from "@/shared/lib/platform";
import { useT } from "@/shared/i18n";
import { isSavedAddress, saveAddress } from "@/shared/lib/wallet";
import { currency } from "@/shared/lib/wallet";
import type { TransferFlow } from "@/features/transfer/send/useTransferFlow";

/** Stage two: the amount, priced by the ledger, against the verified recipient. */
export function TransferStageAmount({ flow }: { flow: TransferFlow }) {
  const t = useT("transfer.send");
  const common = useT("common");
  const {
    userId,
    recipient,
    verifiedAddress,
    amount,
    setAmount,
    amountCheck,
    amountValid,
    tax,
    net,
    decimalAmount,
    balanceMinor,
    busy,
    frozen,
    error,
    setStage,
    setQuote,
    setError,
    setBookTick,
    verifyAmount,
  } = flow;
  // Prefilled from the wallet owner's display name when there is one; the sender can still
  // correct or personalize it before saving — an automatic fragment is only the fallback.
  // (Kept above the early return: hooks cannot sit behind it. This card only mounts at stage
  // two, after the recipient is verified, so the initial value is the verified one.)
  const [label, setLabel] = useState(recipient?.displayName ?? "");
  if (!recipient) return null;
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void verifyAmount();
      }}
      className="space-y-4"
    >
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-success/40 bg-success/10 p-3">
        <Icon icon={CheckmarkCircle01Icon} size={18} className="text-success" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{t("amount.verified")}</p>
          <code className="break-all text-xs">{recipient.address}</code>
          {recipient.displayName && (
            <p className="text-xs text-muted-foreground">
              {t("amount.owner", { name: recipient.displayName })}
            </p>
          )}
        </div>
        <Button
          type="button"
          variant="ghost"
          className="h-8 rounded-full px-3 text-xs font-semibold"
          onClick={() => {
            setStage(1);
            setQuote(null);
            setError("");
          }}
        >
          {t("amount.change")}
        </Button>
        {isSavedAddress(userId, verifiedAddress) ? (
          <span className="inline-flex items-center gap-1 text-xs font-semibold text-primary-soft">
            <Icon icon={FavouriteIcon} size={15} />
            {t("amount.saved")}
          </span>
        ) : (
          <span className="flex w-full min-w-0 flex-wrap items-center gap-2">
            <Input
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              maxLength={LIMITS.maxDisplayNameLength}
              placeholder={t("amount.labelPlaceholder")}
              aria-label={t("amount.labelAria")}
              className="h-8 min-w-0 flex-1 text-xs"
            />
            <Button
              type="button"
              variant="ghost"
              className="h-8 rounded-full px-3 text-xs font-semibold"
              onClick={() => {
                saveAddress(userId, verifiedAddress, label);
                setBookTick((tick) => tick + 1);
              }}
            >
              <Icon icon={FavouriteIcon} size={15} />
              {t("amount.saveLabel")}
            </Button>
          </span>
        )}
      </div>
      <label className="block text-sm font-semibold">
        {t("amount.label")}
        <Input
          autoFocus
          className="mt-2"
          required
          inputMode="decimal"
          autoComplete="off"
          maxLength={LIMITS.maxAmountLength}
          placeholder="0.0000"
          value={amount}
          onChange={(event) => {
            setAmount(event.target.value);
            setQuote(null);
            setError("");
          }}
        />
      </label>
      {amount.trim() && !amountValid && (
        <p className="text-xs text-destructive">{amountCheck.error}</p>
      )}
      {amountValid && (
        <div className="flex items-start gap-2 rounded-xl bg-secondary/60 p-3 text-xs">
          <Icon icon={PercentCircleIcon} size={17} className="mt-0.5 shrink-0" />
          <div>
            <p>{t("amount.tax", { amount: currency(tax) })}</p>
            <p className="mt-1 text-muted-foreground">
              {t("amount.leaves", { sent: currency(decimalAmount), received: currency(net) })}
            </p>
          </div>
        </div>
      )}
      {balanceMinor <= 0 && (
        <p className="text-sm text-muted-foreground">{t("amount.noFunds")}</p>
      )}
      {error && <FormMessage tone="error">{error}</FormMessage>}
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="outline"
          disabled={busy !== null}
          onClick={() => {
            setStage(1);
            setError("");
          }}
        >
          <Icon icon={ArrowLeft01Icon} size={16} />
          {common("actions.back")}
        </Button>
        <Button type="submit" disabled={busy !== null || !amountValid || frozen}>
          {busy === "amount" ? t("amount.checking") : common("actions.continue")}
          <Icon icon={ArrowRight01Icon} size={16} />
        </Button>
      </div>
    </form>
  );
}
