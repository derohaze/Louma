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
import { currency } from "@/shared/lib/wallet";
import { cn } from "@/shared/lib/platform";
import type { TransferFlow } from "@/features/transfer/send/useTransferFlow";

/** Stage three: the server-approved summary plus the credential proof. Nothing moves until here. */
export function TransferStageConfirm({ flow }: { flow: TransferFlow }) {
  const {
    recipient,
    quote,
    verifiedAddress,
    note,
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
          ["Recipient", verifiedAddress],
          ["Network tax (1%)", currency(quote.fee)],
          ["Amount (LMA)", currency(quote.amount)],
          ["Recipient receives", currency(quote.netAmount)],
          ["Balance after", currency(quote.balanceAfter)],
          ...(note.trim() ? ([["Note", note.trim()]] as [string, string][]) : []),
        ].map(([label, value]) => (
          <div
            key={label}
            className="flex items-start justify-between gap-4 border-b px-4 py-3 last:border-0"
          >
            <span className="shrink-0 text-sm text-muted-foreground">{label}</span>
            <span
              className={cn(
                "min-w-0 text-end text-sm font-semibold",
                label === "Recipient" && "break-all",
              )}
            >
              {value}
            </span>
          </div>
        ))}
      </div>
      {recipient.displayName && (
        <p className="text-xs text-muted-foreground">
          Paying the wallet held by {recipient.displayName}. Check both sides of the address before
          sending: a transfer cannot be reversed.
        </p>
      )}
      {needsCredential && (
        <div className="space-y-3 rounded-xl border p-4">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Icon icon={usingCode ? Key01Icon : SquareLock02Icon} size={18} />
            {usingCode ? "Authenticator code" : "Transfer password"}
          </div>
          {passwordSet && authenticatorSet && (
            <div className="flex w-fit gap-1 rounded-full border bg-secondary/60 p-1">
              {(
                [
                  ["password", "Transfer password"],
                  ["code", "Authenticator"],
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
            placeholder={usingCode ? "6-digit code or a recovery code" : "Your transfer password"}
          />
          <p className="text-xs text-muted-foreground">
            {usingCode
              ? "The code proves the transfer with your authenticator; a recovery code works too."
              : "Proved by the API before the ledger moves, never stored by this page."}
          </p>
        </div>
      )}
      {!needsCredential && (
        <p className="text-xs text-muted-foreground">
          This wallet has no transfer password and no authenticator, so it sends as soon as you
          confirm. A credential can be set from the Security section.
        </p>
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
          Back
        </Button>
        <Button disabled={busy !== null} onClick={() => void completeTransfer()}>
          <Icon icon={ArrowUpRight01Icon} size={17} />
          {busy === "send" ? "Sending…" : `Send ${currency(quote.amount)}`}
        </Button>
      </div>
    </div>
  );
}
