import { Link } from "@tanstack/react-router";
import { useRef, useState } from "react";
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
import { useWallet, type Transaction } from "@/hooks/wallet-context";
import { api, messageForError } from "@/lib/api";
import { LIMITS, isTransferTarget, parseAmount, sanitizeText } from "@/lib/validation";
import {
  currency,
  dateText,
  moneyToMinorUnits,
  sumMoney,
  transferNet,
  transferTax,
} from "@/lib/wallet-format";
import { CopyButton, EmptyState, Icon, PageHeader } from "./wallet-shell";
import { FactList, FormMessage, Panel } from "./security-ui";

export function TransferContent() {
  const { wallet, security, refresh, refreshNotifications } = useWallet();
  const [tab, setTab] = useState<"send" | "receive">("send");
  const [address, setAddress] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [transferPassword, setTransferPasswordInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  /**
   * One idempotency key per transfer attempt, kept together with the parameters it was minted for.
   * A retry of the same parameters — including a retry after a response that never arrived, the one
   * case where the wallet may already have been debited — reuses the key, so the backend replays the
   * original transfer instead of moving funds twice. Only a confirmed transfer ends the attempt.
   */
  const attempt = useRef<{ key: string; fingerprint: string } | null>(null);
  /** Mirrors the backend's fingerprint: the same three fields make two attempts the same one. */
  const attemptFingerprint = (recipient: string, amountValue: string, noteValue: string) =>
    JSON.stringify([
      recipient.trim().toLowerCase(),
      amountValue,
      sanitizeText(noteValue, LIMITS.maxNoteLength),
    ]);
  const frozen = security?.wallet.status === "frozen";
  const needsPassword = security?.transferPassword.enabled ?? false;
  const balanceMinor = wallet ? moneyToMinorUnits(wallet.balance) : 0;
  const amountCheck = parseAmount(amount, { maxMinor: balanceMinor });
  const amountValid = amountCheck.ok;
  const decimalAmount = amountCheck.value;
  const tax = amountValid ? transferTax(decimalAmount) : "0.0000";
  const net = amountValid ? transferNet(decimalAmount) : "0.0000";
  /** The address field is checked against the wallet on every keystroke, before the submit. */
  const looksLikeOwnAddress =
    address.trim().length > 0 && address.trim().toLowerCase() === wallet?.address.toLowerCase();

  /** The transfer itself, split out so the confirmation dialog can run the same path. */
  const completeTransfer = async () => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const fingerprint = attemptFingerprint(address, decimalAmount, note);
      const pending =
        attempt.current?.fingerprint === fingerprint
          ? attempt.current
          : { key: crypto.randomUUID(), fingerprint };
      attempt.current = pending;
      await api.post<{ transaction: Transaction }>(
        "/api/v1/transfers",
        {
          recipientAddress: address.trim(),
          amount: decimalAmount,
          note: sanitizeText(note, LIMITS.maxNoteLength),
          ...(transferPassword ? { transferPassword } : {}),
        },
        { idempotencyKey: pending.key },
      );
      // Only a transfer the API confirmed clears the attempt; a failure keeps its key for the retry.
      attempt.current = null;
      setConfirmOpen(false);
      setMessage("Transfer completed.");
      setAddress("");
      setAmount("");
      setNote("");
      setTransferPasswordInput("");
      // This transfer notified both sides: the bell is told before the account read, because that read
      // now rejects when its fetch fails, and a failed one must not withhold the notice behind it.
      refreshNotifications();
      await refresh();
    } catch (cause) {
      setError(messageForError(cause));
    } finally {
      setBusy(false);
    }
  };

  const send = (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    setMessage("");
    const recipient = address.trim();
    if (!isTransferTarget(recipient)) {
      setError("Enter a Louma wallet address (LMA-XXXX-XXXX-XXXX) or a @handle.");
      return;
    }
    if (recipient.toLowerCase() === wallet?.address.toLowerCase()) {
      setError("Use another wallet address.");
      return;
    }
    if (!wallet) {
      setError("The wallet is still loading. Try again in a moment.");
      return;
    }
    if (frozen) {
      setError("The wallet is frozen, so transfers are refused.");
      return;
    }
    if (needsPassword && !transferPassword) {
      setError("Enter your transfer password.");
      return;
    }
    if (!amountValid) {
      setError(amountCheck.error);
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
            {looksLikeOwnAddress && (
              <p className="text-xs text-destructive">This is your own address.</p>
            )}
            <label className="block text-sm font-semibold">
              Amount (LMA)
              <Input
                className="mt-2"
                required
                type="text"
                inputMode="decimal"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                placeholder="0.0000"
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
                    {currency(decimalAmount)} leaves your wallet and {currency(net)} reaches the
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
            <Button type="submit" disabled={busy || balanceMinor <= 0 || frozen}>
              <Icon icon={ArrowUpRight01Icon} size={17} />
              {busy ? "Sending…" : "Send LMA"}
            </Button>
            {frozen && (
              <p className="text-sm text-muted-foreground">
                The wallet is frozen, so transfers are refused.{" "}
                <Link to="/security/freeze" className="font-semibold text-primary-soft">
                  Unfreeze it
                </Link>
                .
              </p>
            )}
            {balanceMinor <= 0 && (
              <p className="text-sm text-muted-foreground">
                No funds available. Share your receiving address to receive LMA first.
              </p>
            )}
            {error && <FormMessage tone="error">{error}</FormMessage>}
            {message && <FormMessage tone="ok">{message}</FormMessage>}
          </form>
          <section className="h-fit rounded-[22px] border bg-card p-5 shadow-sm">
            <p className="text-sm text-muted-foreground">Available balance</p>
            <p className="mt-3 font-display text-2xl font-bold">
              {currency(wallet?.balance ?? "0")}
            </p>
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
            <AlertDialogTitle>Send {currency(decimalAmount || "0")}?</AlertDialogTitle>
            <AlertDialogDescription>
              {currency(decimalAmount || "0")} leaves your wallet for {address.trim()}. The 1%
              network tax is {currency(tax)}, so the recipient receives {currency(net)}.
              {note.trim() ? ` Note: ${note.trim()}.` : ""} Transfers cannot be reversed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {/* The failure is shown where the person is looking: the dialog stays open until the API
              answers, so an error inside it is the only one they would see. */}
          {error && (
            <div className="px-1">
              <FormMessage tone="error">{error}</FormMessage>
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            {/*
             * The click keeps the dialog open: the request is still in flight, and an error has to
             * be shown where the person is looking instead of behind a dialog that closed itself.
             */}
            <AlertDialogAction
              disabled={busy}
              onClick={(event) => {
                event.preventDefault();
                void completeTransfer();
              }}
            >
              {busy ? "Sending…" : "Confirm transfer"}
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
          <p className="mt-4 font-display text-3xl font-bold">{currency(wallet?.balance ?? "0")}</p>
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
            ["Status", wallet?.status === "frozen" ? "Frozen" : "Active"],
            ["Created", wallet?.createdAt ? dateText(wallet.createdAt) : "—"],
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
  const { transactions, nextCursor, loadMore } = useWallet();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "sent" | "received">("all");
  const [page, setPage] = useState(1);
  const [loadingMore, setLoadingMore] = useState(false);
  const pageSize = 8;
  const filtered = transactions.filter(
    (transaction) =>
      (filter === "all" || transaction.direction === filter) &&
      `${transaction.counterpartyAddress} ${transaction.note} ${transaction.transferId}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const shown = filtered.slice((page - 1) * pageSize, page * pageSize);
  const sent = transactions.filter((item) => item.direction === "sent");
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
          ["Loaded transactions", String(transactions.length)],
          ["Sent", String(sent.length)],
          ["Received", String(transactions.length - sent.length)],
          ["Network tax paid", currency(sumMoney(sent.map((item) => item.fee)))],
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
            const isSent = transaction.direction === "sent";
            return (
              <div
                key={transaction.id}
                className="flex flex-wrap items-center gap-3 border-b px-5 py-4 last:border-0"
              >
                <Icon
                  icon={isSent ? ArrowUpRight01Icon : ArrowDownLeft01Icon}
                  className={isSent ? "text-primary-soft" : "text-success"}
                />
                <Link
                  to="/history/$transferId"
                  params={{ transferId: transaction.transferId }}
                  className="min-w-0 flex-1"
                >
                  <p className="break-all text-sm font-semibold">
                    {transaction.counterpartyAddress}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {dateText(transaction.createdAt)}
                    {transaction.note ? ` · ${transaction.note}` : ""}
                  </p>
                </Link>
                {/*
                 * A received transfer credits the net amount: the amount the sender paid includes
                 * the network tax, so showing it here would claim the wallet grew by more than it
                 * did.
                 */}
                <strong className="text-sm">
                  {isSent ? "-" : "+"}
                  {currency(isSent ? transaction.amount : transaction.netAmount)}
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
      {(nextCursor || pages > 1) && (
        <div className="mt-4 flex items-center justify-between gap-3">
          {nextCursor && (
            <Button
              variant="outline"
              disabled={loadingMore}
              onClick={() => {
                setLoadingMore(true);
                void loadMore().finally(() => setLoadingMore(false));
              }}
            >
              {loadingMore ? "Loading…" : "Load older transactions"}
            </Button>
          )}
          {pages > 1 && (
            <div className="flex items-center gap-3">
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
        </div>
      )}
    </>
  );
}

export function CustomAddressContent() {
  const { wallet, refresh } = useWallet();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const next = wallet?.customAddressChangedAt
    ? new Date(new Date(wallet.customAddressChangedAt).getTime() + 30 * 86400000)
    : null;
  const waiting = next && next.getTime() > Date.now();
  /** The handle is what the backend stores; the address shown includes the leading "@". */
  const handle = (wallet?.customAddress ?? "").replace(/^@/, "");
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    setError("");
    try {
      await api.patch("/api/v1/wallet/custom-address", { address: name.trim().toLowerCase() });
      setMessage("Address updated.");
      setName("");
      await refresh();
    } catch (cause) {
      setError(messageForError(cause));
    } finally {
      setBusy(false);
    }
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
          <form onSubmit={(event) => void submit(event)} className="mt-5 space-y-4">
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
            {error && <FormMessage tone="error">{error}</FormMessage>}
            {message && <FormMessage tone="ok">{message}</FormMessage>}
          </form>
        )}
        <div className="mt-5">
          <Panel title="How it works" description="What the custom address changes.">
            <FactList
              items={[
                ["Handle", handle ? `@${handle}` : "Not set"],
                ["Used for", "Receiving LMA as an alternative to the wallet address"],
                ["Changes", "Once every 30 days"],
              ]}
            />
          </Panel>
        </div>
      </section>
    </>
  );
}
