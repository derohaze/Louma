import { Link } from "@tanstack/react-router";
import { useState } from "react";
import {
  ArrowUpRight01Icon,
  ArrowDownLeft01Icon,
  ArrowRight01Icon,
  Download01Icon,
  QrCodeIcon,
  SecurityCheckIcon,
} from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { useWallet } from "@/hooks/use-wallet";
import { sendDemoTransfer, setDemoCustomAddress, updateDemoWallet } from "@/lib/demo-wallet";
import { exportTransactions } from "@/lib/transaction-statement";
import { currency, dateText } from "@/lib/wallet-format";
import { CopyButton, EmptyState, Icon, PageHeader } from "./wallet-shell";

export function TransferContent() {
  const { wallet, transactions, refresh } = useWallet();
  const [tab, setTab] = useState<"send" | "receive">("send");
  const [address, setAddress] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [rating, setRating] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [lastId, setLastId] = useState<string | null>(null);
  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage("");
    const numeric = Number(amount);
    if (
      !Number.isFinite(numeric) ||
      numeric <= 0 ||
      numeric > Number(wallet?.balance) ||
      !/^\d+(\.\d{1,4})?$/.test(amount)
    ) {
      setMessage("Enter a valid amount within your available balance.");
      return;
    }
    if (address.trim() === wallet?.address) {
      setMessage("Use another wallet address.");
      return;
    }
    setBusy(true);
    const transferId = sendDemoTransfer({
      recipientAddress: address.trim(),
      amount: numeric,
      note: note.trim(),
      rating,
    });
    setBusy(false);
    setLastId(transferId);
    setMessage("Transfer completed.");
    setAddress("");
    setAmount("");
    setNote("");
    setRating(0);
    await refresh();
  };
  return (
    <>
      <PageHeader title="Transfer" subtitle="Send or receive WLT between wallet addresses." />
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
                placeholder="WLT-... or @address"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
              />
            </label>
            <label className="block text-sm font-semibold">
              Amount (WLT)
              <Input
                className="mt-2"
                required
                type="number"
                min="0.0001"
                max={wallet?.balance ?? 0}
                step="0.0001"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
              />
            </label>
            <label className="block text-sm font-semibold">
              Note (optional)
              <Input
                className="mt-2"
                maxLength={240}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="What is this transfer for?"
              />
            </label>
            <div>
              <p className="text-sm font-semibold">Recipient rating (optional)</p>
              <div className="mt-2 flex gap-2">
                {[1, 2, 3, 4, 5].map((n) => (
                  <Button
                    type="button"
                    key={n}
                    size="icon"
                    variant={rating === n ? "default" : "outline"}
                    aria-label={`Rate ${n} out of 5`}
                    onClick={() => setRating(rating === n ? 0 : n)}
                  >
                    {n}
                  </Button>
                ))}
              </div>
            </div>
            <Button type="submit" disabled={busy || !wallet?.balance}>
              <Icon icon={ArrowUpRight01Icon} size={17} />
              {busy ? "Sending…" : "Send WLT"}
            </Button>
            {!wallet?.balance && (
              <p className="text-sm text-muted-foreground">
                No funds available. Share your receiving address to receive WLT first.
              </p>
            )}
            {message && (
              <p role="status" className="text-sm text-muted-foreground">
                {message}
              </p>
            )}
            {lastId && (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  const tx = transactions.find((t) => t.transfer_id === lastId);
                  if (tx) exportTransactions([tx], `transfer-${lastId.slice(0, 8)}`);
                }}
              >
                <Icon icon={Download01Icon} size={17} />
                Download receipt PDF
              </Button>
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
        <section className="max-w-2xl rounded-[22px] border bg-card p-5 shadow-sm">
          <div className="flex items-center gap-2 font-semibold">
            <Icon icon={QrCodeIcon} />
            Your receiving address
          </div>
          <p className="mt-4 text-sm text-muted-foreground">
            Share this address with the sender to receive WLT.
          </p>
          <div className="mt-3 flex items-center gap-2 rounded-xl bg-secondary p-3">
            <code className="min-w-0 flex-1 break-all">{wallet?.address}</code>
            {wallet?.address && <CopyButton text={wallet.address} />}
          </div>
        </section>
      )}
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
          <p className="mt-4 text-xs text-muted-foreground">Only send WLT to this address.</p>
        </section>
      </div>
      <section className="mt-4 rounded-[22px] border bg-card p-5 shadow-sm">
        <h2 className="font-display font-semibold">Wallet details</h2>
        <div className="mt-5 grid gap-4 sm:grid-cols-3">
          {[
            ["Wallet type", wallet?.is_premium ? "Premium" : "Standard"],
            ["Security backup", wallet?.backup_confirmed ? "Confirmed" : "Not confirmed"],
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
    (t) =>
      (filter === "all" || t.direction === filter) &&
      `${t.counterparty_address} ${t.note} ${t.transfer_id}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const shown = filtered.slice((page - 1) * pageSize, page * pageSize);
  return (
    <>
      <PageHeader
        title="History"
        subtitle="Search, filter, and export your transactions."
        action={
          <Button
            variant="outline"
            disabled={!filtered.length}
            onClick={() => exportTransactions(filtered)}
          >
            <Icon icon={Download01Icon} size={17} />
            Export PDF
          </Button>
        }
      />
      <div className="mb-5 flex flex-col gap-3 sm:flex-row">
        <Input
          aria-label="Search transactions"
          placeholder="Search address, note, or transfer ID"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
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
      <div className="mb-4 grid gap-4 sm:grid-cols-3">
        {[
          ["All transactions", transactions.length],
          ["Sent", transactions.filter((t) => t.direction === "sent").length],
          ["Received", transactions.filter((t) => t.direction === "received").length],
        ].map(([label, n]) => (
          <div key={label} className="rounded-2xl border bg-card p-4 shadow-sm">
            <p className="text-sm text-muted-foreground">{label}</p>
            <strong className="mt-3 block font-display text-2xl">{n}</strong>
          </div>
        ))}
      </div>
      <section className="overflow-hidden rounded-[22px] border bg-card shadow-sm">
        <div className="border-b px-5 py-4 font-display font-semibold">Transactions</div>
        {shown.length ? (
          shown.map((t) => (
            <div
              key={t.id}
              className="flex flex-wrap items-center gap-3 border-b px-5 py-4 last:border-0"
            >
              <Icon
                icon={t.direction === "sent" ? ArrowUpRight01Icon : ArrowDownLeft01Icon}
                className={t.direction === "sent" ? "text-primary" : "text-success"}
              />
              <div className="min-w-0 flex-1">
                <p className="break-all text-sm font-semibold">{t.counterparty_address}</p>
                <p className="text-xs text-muted-foreground">
                  {dateText(t.created_at)}
                  {t.note ? ` · ${t.note}` : ""}
                </p>
              </div>
              <strong className="text-sm">
                {t.direction === "sent" ? "-" : "+"}
                {currency(t.amount)}
              </strong>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Download receipt"
                title="Download receipt"
                onClick={() => exportTransactions([t], `transfer-${t.transfer_id.slice(0, 8)}`)}
              >
                <Icon icon={Download01Icon} size={17} />
              </Button>
            </div>
          ))
        ) : (
          <EmptyState
            title={transactions.length ? "No matching transactions" : "No transactions yet"}
            detail={
              transactions.length
                ? "Try another search or filter."
                : "Send or receive WLT to see your history here."
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
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
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
        <p className="mt-5 text-sm">
          Custom addresses are available to Premium wallets. You can change yours once every 30
          days.
        </p>
        {!wallet?.is_premium ? (
          <div className="mt-5 rounded-xl border border-warning bg-warning/10 p-4 text-sm">
            Premium required. Your standard address remains active; upgrade access is not available
            in this wallet yet.
          </div>
        ) : waiting ? (
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
                  onChange={(e) => setName(e.target.value.toLowerCase())}
                  placeholder="your_name"
                  className="border-0 shadow-none"
                />
              </div>
            </label>
            <Button disabled={busy}>{busy ? "Saving…" : "Save address"}</Button>
            {message && (
              <p role="status" className="text-sm text-muted-foreground">
                {message}
              </p>
            )}
          </form>
        )}
      </section>
    </>
  );
}
export function LeaderboardContent() {
  return (
    <>
      <PageHeader title="Leaderboard" subtitle="Balance and activity rankings." />
      <section className="rounded-[22px] border bg-card shadow-sm">
        <div className="border-b px-5 py-4">
          <h2 className="font-display font-semibold">Wallet rankings</h2>
        </div>
        <EmptyState
          title="Rankings are unavailable"
          detail="Wallet balances and activity are private. No public rankings are available until members choose to participate."
        />
      </section>
    </>
  );
}
/** Security and backup have their own page, so Settings only carries wallet preferences. */
export function SecurityContent() {
  const { wallet, refresh } = useWallet();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const confirmBackup = async (value: boolean) => {
    setBusy(true);
    setMessage("");
    updateDemoWallet({ backup_confirmed: value });
    setBusy(false);
    setMessage("Settings saved.");
    await refresh();
  };
  return (
    <>
      <PageHeader title="Security" subtitle="Sign-in safety and wallet backup." />
      <div className="space-y-4">
        <section className="rounded-[22px] border bg-card p-5 shadow-sm">
          <h2 className="flex items-center gap-2 font-display font-semibold">
            <Icon icon={SecurityCheckIcon} />
            Security
          </h2>
          <p className="mt-3 text-sm text-muted-foreground">
            Your wallet is tied to your account. Keep your password private and sign out on shared
            devices.
          </p>
          <p className="mt-4 text-sm font-semibold">
            Backup status: {wallet?.backup_confirmed ? "Confirmed" : "Not confirmed"}
          </p>
        </section>
        <section className="rounded-[22px] border bg-card p-5 shadow-sm">
          <h2 className="font-display font-semibold">Backup</h2>
          <p className="mt-3 text-sm text-muted-foreground">
            Save your receiving address for reference. This is not a private key or recovery phrase.
          </p>
          <div className="mt-3 flex items-center gap-2 rounded-xl bg-secondary p-3">
            <code className="min-w-0 flex-1 break-all text-sm">{wallet?.address}</code>
            {wallet?.address && <CopyButton text={wallet.address} />}
          </div>
          <label className="mt-4 flex items-center gap-3 text-sm">
            <Checkbox
              checked={wallet?.backup_confirmed ?? false}
              disabled={busy}
              onCheckedChange={(checked) => void confirmBackup(checked === true)}
            />
            I saved my receiving address
          </label>
        </section>
        {message && (
          <p role="status" className="text-sm text-muted-foreground">
            {message}
          </p>
        )}
      </div>
    </>
  );
}
export function SettingsContent() {
  const { wallet, refresh } = useWallet();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const change = async (value: boolean) => {
    setBusy(true);
    setMessage("");
    updateDemoWallet({ privacy_mode: value });
    setBusy(false);
    setMessage("Settings saved.");
    await refresh();
  };
  return (
    <>
      <PageHeader title="Settings" subtitle="Wallet preferences." />
      <div className="space-y-4">
        <section className="rounded-[22px] border bg-card p-5 shadow-sm">
          <h2 className="font-display font-semibold">Privacy</h2>
          <label className="mt-4 flex items-center gap-3 text-sm">
            <Checkbox
              checked={wallet?.privacy_mode ?? false}
              disabled={busy}
              onCheckedChange={(checked) => void change(checked === true)}
            />
            Hide balance on this screen
          </label>
          <p className="mt-2 text-xs text-muted-foreground">
            This preference is saved to your account. Public rankings remain unavailable.
          </p>
          <Link
            to="/security"
            className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-primary"
          >
            Security and backup <Icon icon={ArrowRight01Icon} size={16} />
          </Link>
        </section>
        {message && (
          <p role="status" className="text-sm text-muted-foreground">
            {message}
          </p>
        )}
      </div>
    </>
  );
}
