import { ArrowRight01Icon, FavouriteIcon, QrCodeScanIcon } from "@hugeicons/core-free-icons";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Icon } from "@/shared/ui/page";
import { FormMessage } from "@/shared/ui/panels";
import { LIMITS } from "@/shared/lib/platform";
import { QrScanner } from "@/features/transfer/send/TransferQrScanner";
import type { TransferFlow } from "@/features/transfer/send/useTransferFlow";

/** Stage one: the recipient address, checked against the ledger before an amount is asked for. */
export function TransferStageAddress({ flow }: { flow: TransferFlow }) {
  const {
    address,
    busy,
    frozen,
    error,
    hasShortcuts,
    savedShortcuts,
    looksLikeOwnAddress,
    scannerOpen,
    setScannerOpen,
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
          <p className="text-xs font-semibold text-muted-foreground">Saved recipients</p>
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
        Recipient wallet address
        <Input
          autoFocus
          className="mt-2"
          required
          autoComplete="off"
          spellCheck={false}
          maxLength={LIMITS.maxRecipientLength}
          placeholder="LMA-XXXX-XXXX-XXXX or @handle"
          value={address}
          onChange={(event) => changeAddress(event.target.value)}
        />
      </label>
      {looksLikeOwnAddress && <p className="text-xs text-destructive">This is your own address.</p>}
      <p className="text-xs text-muted-foreground">
        Nothing leaves your wallet at this step: the address is checked against the ledger before an
        amount is even asked for.
      </p>
      {error && <FormMessage tone="error">{error}</FormMessage>}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={busy !== null || frozen || !address.trim()}>
          {busy === "address" ? "Checking the address…" : "Continue"}
          <Icon icon={ArrowRight01Icon} size={16} />
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="h-9 rounded-full px-4 text-xs font-semibold"
          onClick={() => setScannerOpen((open) => !open)}
        >
          <Icon icon={QrCodeScanIcon} size={16} />
          {scannerOpen ? "Hide scanner" : "Scan QR"}
        </Button>
      </div>
      {scannerOpen && (
        <QrScanner
          onDetected={(detected) => {
            changeAddress(detected);
            setScannerOpen(false);
          }}
        />
      )}
    </form>
  );
}
