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
import { isSavedAddress, saveAddress } from "@/shared/lib/wallet";
import { currency } from "@/shared/lib/wallet";
import type { TransferFlow } from "@/features/transfer/send/useTransferFlow";

/** Stage two: the amount, priced by the ledger, against the verified recipient. */
export function TransferStageAmount({ flow }: { flow: TransferFlow }) {
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
    note,
    setNote,
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
          <p className="text-sm font-semibold">Address verified</p>
          <code className="break-all text-xs">{recipient.address}</code>
          {recipient.displayName && (
            <p className="text-xs text-muted-foreground">Wallet owner · {recipient.displayName}</p>
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
          Change
        </Button>
        {isSavedAddress(userId, verifiedAddress) ? (
          <span className="inline-flex items-center gap-1 text-xs font-semibold text-primary-soft">
            <Icon icon={FavouriteIcon} size={15} />
            Saved
          </span>
        ) : (
          <Button
            type="button"
            variant="ghost"
            className="h-8 rounded-full px-3 text-xs font-semibold"
            onClick={() => {
              saveAddress(userId, verifiedAddress, recipient.displayName ?? "");
              setBookTick((tick) => tick + 1);
            }}
          >
            <Icon icon={FavouriteIcon} size={15} />
            Save
          </Button>
        )}
      </div>
      <label className="block text-sm font-semibold">
        Amount (LMA)
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
            <p>
              Network tax (1%): <strong>{currency(tax)}</strong>
            </p>
            <p className="mt-1 text-muted-foreground">
              {currency(decimalAmount)} leaves your wallet and {currency(net)} reaches the
              recipient.
            </p>
          </div>
        </div>
      )}
      {balanceMinor <= 0 && (
        <p className="text-sm text-muted-foreground">
          No funds available. Share your receiving address to receive LMA first.
        </p>
      )}
      <label className="block text-sm font-semibold">
        Note (optional)
        <Input
          className="mt-2"
          autoComplete="off"
          maxLength={LIMITS.maxNoteLength}
          placeholder="What is this transfer for?"
          value={note}
          onChange={(event) => {
            setNote(event.target.value);
            setError("");
          }}
        />
      </label>
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
          Back
        </Button>
        <Button type="submit" disabled={busy !== null || !amountValid || frozen}>
          {busy === "amount" ? "Checking the ledger…" : "Continue"}
          <Icon icon={ArrowRight01Icon} size={16} />
        </Button>
      </div>
    </form>
  );
}
