import { ArrowRight01Icon, FavouriteIcon } from "@hugeicons/core-free-icons";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Icon } from "@/shared/ui/page";
import { FormMessage } from "@/shared/ui/panels";
import { LIMITS } from "@/shared/lib/platform";
import { useT } from "@/shared/i18n";
import type { TransferFlow } from "@/features/transfer/send/useTransferFlow";

/** Stage one: the recipient address, checked against the ledger before an amount is asked for. */
export function TransferStageAddress({ flow }: { flow: TransferFlow }) {
  const t = useT("transfer.send");
  const common = useT("common");
  const {
    address,
    busy,
    frozen,
    error,
    hasShortcuts,
    savedShortcuts,
    looksLikeOwnAddress,
    changeAddress,
    verifyAddress,
  } = flow;
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void verifyAddress();
      }}
      className="space-y-4"
    >
      {hasShortcuts && (
        <div>
          <p className="text-xs font-semibold text-muted-foreground">
            {t("address.savedRecipients")}
          </p>
          <div className="mt-2 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {savedShortcuts.map((entry) => (
              <button
                key={entry.address}
                type="button"
                onClick={() => changeAddress(entry.address)}
                title={entry.address}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-primary/30 bg-primary/5 px-3 py-1.5 text-xs font-semibold"
              >
                <Icon icon={FavouriteIcon} size={14} className="text-primary-soft" />
                {entry.label}
              </button>
            ))}
          </div>
        </div>
      )}
      <label className="block text-sm font-semibold">
        {t("address.label")}
        <Input
          autoFocus
          className="mt-2"
          required
          autoComplete="off"
          spellCheck={false}
          maxLength={LIMITS.maxRecipientLength}
          placeholder={t("address.placeholder")}
          value={address}
          onChange={(event) => changeAddress(event.target.value)}
        />
      </label>
      {looksLikeOwnAddress && <p className="text-xs text-destructive">{t("address.own")}</p>}
      <p className="text-xs text-muted-foreground">{t("address.note")}</p>
      {error && <FormMessage tone="error">{error}</FormMessage>}
      <Button type="submit" disabled={busy !== null || frozen || !address.trim()}>
        {busy === "address" ? t("address.checking") : common("actions.continue")}
        <Icon icon={ArrowRight01Icon} size={16} />
      </Button>
    </form>
  );
}
