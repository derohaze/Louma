import { QRCodeSVG } from "qrcode.react";
import { QrCodeIcon } from "@hugeicons/core-free-icons";
import { CopyButton, Icon } from "@/shared/ui/page";
import type { TransferFlow } from "@/features/transfer/send/useTransferFlow";

/** The Receive tab: the address as a browser-generated QR, so it never leaves the page. */
export function TransferReceivePanel({ flow }: { flow: TransferFlow }) {
  const { wallet } = flow;
  return (
    <section className="max-w-3xl rounded-[22px] border bg-card p-5 shadow-sm">
      <div className="flex items-center gap-2 font-semibold">
        <Icon icon={QrCodeIcon} />
        Your receiving address
      </div>
      <div className="mt-5 flex flex-col items-start gap-5 sm:flex-row">
        {/* The QR is generated in the browser, so the address never leaves the page. */}
        <div className="rounded-2xl border bg-white p-4">
          <QRCodeSVG
            value={wallet?.address ?? ""}
            size={168}
            level="M"
            marginSize={1}
            fgColor="#20123A"
            bgColor="#FFFFFF"
            aria-label="Receiving address QR code"
          />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm text-muted-foreground">
            Scan the code, or share the address with the sender to receive LMA.
          </p>
          <div className="mt-3 flex items-center gap-2 rounded-xl bg-secondary p-3">
            <code className="min-w-0 flex-1 break-all">{wallet?.address}</code>
            {wallet?.address && <CopyButton text={wallet.address} />}
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            A 1% network tax applies to every transfer on the network, and it is taken from what the
            sender pays.
          </p>
        </div>
      </div>
    </section>
  );
}
