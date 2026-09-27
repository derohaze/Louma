import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import {
  ArrowDownLeft01Icon,
  ArrowUpRight01Icon,
  PercentCircleIcon,
  QrCodeIcon,
} from "@hugeicons/core-free-icons";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useWallet } from "@/hooks/use-wallet";
import { readSecurity, transferBlockedReason } from "@/lib/demo-security";
import { LIMITS, parseAmount, sanitizeText } from "@/lib/validation";
import { lookupAddress, sendDemoTransfer, setDemoCustomAddress } from "@/lib/demo-wallet";
import { currency, dateText, transferNet, transferTax } from "@/lib/wallet-format";
import { CopyButton, EmptyState, Icon, PageHeader } from "./wallet-shell";
import { FactList, FormMessage, Panel, PreviewNote } from "./security-ui";

export function TransferContent() {
  const { wallet, refresh } = useWallet();
  const [tab, setTab] = useState<"send" | "receive">("send");
  const [address, setAddress] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [transferPassword, setTransferPasswordInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  // Read on render rather than on mount so a security change made on another page applies to the
  // next transfer.
  const [security] = useState(readSecurity);
  /** The transfer password is asked for on every transfer while its protection is on. */
  const needsPassword = security.enabled["transfer-password"];
  const recipient = address.trim() ? lookupAddress(address) : null;
  /** The balance is the cap, so an amount over it is rejected here instead of at the store. */
  const amountCheck = parseAmount(amount, { max: Number(wallet?.balance ?? LIMITS.maxAmount) });
  const amountValid = amountCheck.ok;
  const numericAmount = amountCheck.value;
  const tax = amountValid ? transferTax(numericAmount) : 0;
  const net = amountValid ? transferNet(numericAmount) : 0;
  /** The transfer itself, split out so the confirmation dialog can run the same path. */
  const completeTransfer = async () => {
    setBusy(true);
    sendDemoTransfer({
      recipientAddress: address.trim(),
      amount: numericAmount,
      note: sanitizeText(note, LIMITS.maxNoteLength),
    });
    setBusy(false);
    setConfirmOpen(false);
    setMessage("Transfer completed.");
    setAddress("");
    setAmount("");
    setNote("");
    setTransferPasswordInput("");
    await refresh();
  };
  const send = async (event: React.FormEvent) => {
    event.preventDefault();
    setMessage("");
    if (!recipient || recipient.status === "invalid") {
      setMessage(recipient?.detail ?? "Enter a wallet address or a @handle.");
      return;
    }
    if (recipient.status === "own") {
      setMessage("Use another wallet address.");
      return;
    }
    if (!amountValid) {
      setMessage(amountCheck.error);
      return;
    }
    // Every switch on the Security pages is enforced here, in one place.
    const blocked = transferBlockedReason(readSecurity(), { transferPassword });
    if (blocked) {
      setMessage(blocked);
      return;
    }
    setConfirmOpen(true);
  };
  return (
    <>
      <PageHeader title="Transfer" subtitle="Send or receive LMA between wallet addresses." />
      <div className="mb-5 flex w-fit gap-1 rounded-full border bg-secondary/60 p-1">
        {(["send", "receive"] as const).map((item) => (
          <Button
            key={item}
            variant="ghost"
            onClick={() => setTab(item)}
            className={`h-9 rounded-full px-5 text-xs font-semibold ${tab === item ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"}`}
          >
            {item === "send" ? "Send" : "Receive"}
          </Button>
        ))}
      </div>
      {tab === "send" ? (
        <div className="grid gap-4 xl:grid-cols-[1.5fr_1fr]">
          <form onSubmit={send} className="space-y-5 rounded-[22px] border bg-card p-5 shadow-sm">
            <label className="block text-sm font-semibold">
              Recipient wallet address
              <Input
                className="mt-2"
                required
                placeholder="LMA-... or @address"
                value={address}
                onChange={(event) => setAddress(event.target.value)}
              />
            </label>
            {recipient && (
              <p
                className={`flex items-start gap-2 text-xs ${
                  recipient.status === "known"
                    ? "text-muted-foreground"
                    : recipient.status === "unknown"
                      ? "text-[#9A6B12]"
                      : "text-destructive"
                }`}
              >
                {recipient.detail}
              </p>
            )}
            <label className="block text-sm font-semibold">
              Amount (LMA)
              <Input
                className="mt-2"
                required
                type="number"
                min="0.0001"
                max={wallet?.balance ?? 0}
                step="0.0001"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                placeholder="0.00"
              />
            </label>
            {amountValid && (
              <div className="flex items-start gap-2 rounded-xl bg-secondary/60 p-3 text-xs">
                <Icon icon={PercentCircleIcon} size={17} className="mt-0.5 shrink-0" />
                <div>
                  <p>
                    Network tax (1%): <strong>{currency(tax)}</strong>
                  </p>
                  <p className="mt-1 text-muted-foreground">
                    {currency(numericAmount)} leaves your wallet and {currency(net)} reaches the
                    recipient.
                  </p>
                </div>
              </div>
            )}
            {needsPassword && (
              <label className="block text-sm font-semibold">
                Transfer password
                <Input
                  className="mt-2"
                  type="password"
                  autoComplete="off"
                  maxLength={LIMITS.maxPasswordLength}
                  value={transferPassword}
                  onChange={(event) => setTransferPasswordInput(event.target.value)}
                  placeholder="Required by your security settings"
                />
              </label>
            )}
            <label className="block text-sm font-semibold">
              Note (optional)
              <Input
                className="mt-2"
                maxLength={LIMITS.maxNoteLength}
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="What is this transfer for?"
              />
            </label>
            <Button type="submit" disabled={busy || !wallet?.balance || security.frozen}>
              <Icon icon={ArrowUpRight01Icon} size={17} />
              {busy ? "Sending…" : "Send LMA"}
            </Button>
            {security.frozen && (
              <p className="text-sm text-muted-foreground">
                The wallet is frozen, so transfers are refused.{" "}
                <Link to="/security/freeze" className="font-semibold text-primary">
                  Unfreeze it
                </Link>
                .
              </p>
            )}
            {!wallet?.balance && (
              <p className="text-sm text-muted-foreground">
                No funds available. Share your receiving address to receive LMA first.
              </p>
            )}
            {message && (
              <p role="status" className="text-sm text-muted-foreground">
                {message}
              </p>
            )}
          </form>
          <section className="h-fit rounded-[22px] border bg-card p-5 shadow-sm">
            <p className="text-sm text-muted-foreground">Available balance</p>
            <p className="mt-3 font-display text-2xl font-bold">{currency(wallet?.balance ?? 0)}</p>
            <p className="mt-5 text-sm text-muted-foreground">
              Transfers are final after submission. Check the address before sending.
            </p>
          </section>
        </div>
      ) : (
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
                A 1% network tax applies to every transfer on the network, and it is taken from what
                the sender pays.
              </p>
            </div>
          </div>
        </section>
      )}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Send {currency(numericAmount || 0)}?</AlertDialogTitle>
            <AlertDialogDescription>
              {currency(numericAmount || 0)} leaves your wallet for {address.trim()}
              {recipient?.status === "unknown" ? ", which you have never transacted with" : ""}. The
              1% network tax is {currency(tax)}, so the recipient receives {currency(net)}.
              {note.trim() ? ` Note: ${note.trim()}.` : ""} Transfers cannot be reversed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={busy} onClick={() => void completeTransfer()}>
              Confirm transfer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export function WalletContent() {
  const { wallet, transactions } = useWallet();
  return (
    <>
      <PageHeader
        title="Wallet"
        subtitle="Your wallet balance and receiving address."
        action={
          <Link to="/transfer">
            <Button>
              <Icon icon={ArrowUpRight01Icon} size={17} />
              Transfer
            </Button>
          </Link>
        }
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <section className="rounded-[22px] border bg-card p-5 shadow-sm">
          <p className="text-sm text-muted-foreground">Available balance</p>
          <p className="mt-4 font-display text-3xl font-bold">{currency(wallet?.balance ?? 0)}</p>
          <p className="mt-4 text-xs text-muted-foreground">
            {transactions.length} recorded transactions
          </p>
        </section>
        <section className="rounded-[22px] border bg-card p-5 shadow-sm">
          <p className="text-sm font-semibold">Primary address</p>
          <div className="mt-4 flex items-center gap-2 rounded-xl bg-secondary p-3">
            <code className="min-w-0 flex-1 break-all text-sm">{wallet?.address}</code>
            {wallet?.address && <CopyButton text={wallet.address} />}
          </div>
          <p className="mt-4 text-xs text-muted-foreground">Only send LMA to this address.</p>
        </section>
      </div>
      <section className="mt-4 rounded-[22px] border bg-card p-5 shadow-sm">
        <h2 className="font-display font-semibold">Wallet details</h2>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          {[
            ["Receiving address", wallet?.address ?? "—"],
            ["Created", wallet?.created_at ? dateText(wallet.created_at) : "—"],
          ].map(([label, value]) => (
            <div key={label}>
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className="mt-2 text-sm font-semibold">{value}</p>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

export function HistoryContent() {
  const { transactions } = useWallet();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "sent" | "received">("all");
  const [page, setPage] = useState(1);
  const pageSize = 8;
  const filtered = transactions.filter(
    (transaction) =>
      (filter === "all" || transaction.direction === filter) &&
      `${transaction.counterparty_address} ${transaction.note} ${transaction.transfer_id}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const shown = filtered.slice((page - 1) * pageSize, page * pageSize);
  return (
    <>
      <PageHeader title="Transactions" subtitle="Search and filter your transactions." />
      <div className="mb-5 flex flex-col gap-3 sm:flex-row">
        <Input
          aria-label="Search transactions"
          placeholder="Search address, note, or transfer ID"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setPage(1);
          }}
          className="sm:max-w-xs"
        />
        <div className="flex w-fit gap-1 rounded-full border bg-secondary/60 p-1">
          {(["all", "sent", "received"] as const).map((item) => (
            <Button
              key={item}
              variant="ghost"
              onClick={() => {
                setFilter(item);
                setPage(1);
              }}
              className={`h-8 rounded-full px-4 text-xs font-semibold ${filter === item ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"}`}
            >
              {item.charAt(0).toUpperCase() + item.slice(1)}
            </Button>
          ))}
        </div>
      </div>
      <div className="mb-4 grid gap-4 sm:grid-cols-4">
        {[
          ["All transactions", transactions.length],
          ["Sent", transactions.filter((item) => item.direction === "sent").length],
          ["Received", transactions.filter((item) => item.direction === "received").length],
          [
            "Network tax paid",
            currency(
              transactions
                .filter((item) => item.direction === "sent")
                .reduce((total, item) => total + transferTax(item.amount), 0),
            ),
          ],
        ].map(([label, value]) => (
          <div key={label} className="rounded-2xl border bg-card p-4 shadow-sm">
            <p className="text-sm text-muted-foreground">{label}</p>
            <strong className="mt-3 block font-display text-2xl">{value}</strong>
          </div>
        ))}
      </div>
      <section className="overflow-hidden rounded-[22px] border bg-card shadow-sm">
        <div className="border-b px-5 py-4 font-display font-semibold">Transactions</div>
        {shown.length ? (
          shown.map((transaction) => {
            const sent = transaction.direction === "sent";
            return (
              <div
                key={transaction.id}
                className="flex flex-wrap items-center gap-3 border-b px-5 py-4 last:border-0"
              >
                <Icon
                  icon={sent ? ArrowUpRight01Icon : ArrowDownLeft01Icon}
                  className={sent ? "text-primary" : "text-success"}
                />
                <Link
                  to="/history/$transferId"
                  params={{ transferId: transaction.transfer_id }}
                  className="min-w-0 flex-1"
                >
                  <p className="break-all text-sm font-semibold">
                    {transaction.counterparty_address}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {dateText(transaction.created_at)}
                    {transaction.note ? ` · ${transaction.note}` : ""}
                  </p>
                </Link>
                <strong className="text-sm">
                  {sent ? "-" : "+"}
                  {currency(transaction.amount)}
                </strong>
              </div>
            );
          })
        ) : (
          <EmptyState
            title={transactions.length ? "No matching transactions" : "No transactions yet"}
            detail={
              transactions.length
                ? "Try another search or filter."
                : "Send or receive LMA to see your transactions here."
            }
            action={
              transactions.length ? (
                <Button
                  variant="outline"
                  onClick={() => {
                    setQuery("");
                    setFilter("all");
                  }}
                >
                  Clear filters
                </Button>
              ) : (
                <Link to="/transfer">
                  <Button>Transfer</Button>
                </Link>
              )
            }
          />
        )}
      </section>
      {pages > 1 && (
        <div className="mt-4 flex items-center justify-end gap-3">
          <Button variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            Previous
          </Button>
          <span className="text-sm">
            {page} / {pages}
          </span>
          <Button variant="outline" disabled={page >= pages} onClick={() => setPage(page + 1)}>
            Next
          </Button>
        </div>
      )}
      <div className="mt-4">
        <FactList items={[["Tap a row", "Opens the full transfer detail"]]} />
      </div>
    </>
  );
}

export function CustomAddressContent() {
  const { wallet, refresh } = useWallet();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const next = wallet?.custom_address_changed_at
    ? new Date(new Date(wallet.custom_address_changed_at).getTime() + 30 * 86400000)
    : null;
  const waiting = next && next.getTime() > Date.now();
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    setDemoCustomAddress(`@${name.trim().toLowerCase()}`);
    setBusy(false);
    setMessage("Address updated.");
    setName("");
    await refresh();
  };
  return (
    <>
      <PageHeader
        title="Custom Address"
        subtitle="Set a memorable receiving address for your wallet."
      />
      <section className="max-w-2xl rounded-[22px] border bg-card p-5 shadow-sm">
        <p className="text-sm text-muted-foreground">Current address</p>
        <div className="mt-2 flex items-center gap-2 rounded-xl bg-secondary p-3">
          <code className="min-w-0 flex-1 break-all">{wallet?.address}</code>
          {wallet?.address && <CopyButton text={wallet.address} />}
        </div>
        <p className="mt-5 text-sm">You can change your custom address once every 30 days.</p>
        {waiting ? (
          <p className="mt-5 rounded-xl border bg-secondary p-4 text-sm">
            Next change available on {next.toLocaleDateString()}.
          </p>
        ) : (
          <form onSubmit={submit} className="mt-5 space-y-4">
            <label className="block text-sm font-semibold">
              New address
              <div className="mt-2 flex items-center gap-1 rounded-md border px-3">
                <span>@</span>
                <Input
                  required
                  minLength={4}
                  maxLength={24}
                  pattern="[a-z0-9_]{4,24}"
                  value={name}
                  onChange={(event) => setName(event.target.value.toLowerCase())}
                  placeholder="your_name"
                  className="border-0 shadow-none"
                />
              </div>
            </label>
            <Button disabled={busy}>{busy ? "Saving…" : "Save address"}</Button>
            {message && <FormMessage tone="ok">{message}</FormMessage>}
          </form>
        )}
        <div className="mt-5">
          <PreviewNote>
            Preview build: a custom address is stored for this session only, and it becomes your
            public handle while it is set.
          </PreviewNote>
        </div>
      </section>
    </>
  );
}
