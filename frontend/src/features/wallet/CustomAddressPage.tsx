import { useState } from "react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { CopyButton, PageHeader } from "@/shared/ui/page";
import { FactList, FormMessage, Panel } from "@/shared/ui/panels";
import { useWallet } from "@/shared/hooks";
import { api, messageForError } from "@/shared/api";

/** The Custom Address page: a memorable `@handle` for receiving LMA. */
export function CustomAddressPage() {
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
